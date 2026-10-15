import { createHash, randomBytes } from "node:crypto";
import type { HostSession } from "../src/features/connections/model/protocol";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";
import type { SocialCredentialStore } from "./social-credentials";
import type { SocialService } from "./social";

type Peer = {
  environmentId: string;
  endpoint: string;
  mapping: Record<string, string>;
};
type Identity = {
  sessionId: string;
  projectId: string;
  provider: HostSession["session"]["harness"];
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function endpoint(value: unknown): string {
  const url = new URL(String(value));
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("Use an HTTPS peer endpoint or a local loopback endpoint.");
  return url.origin;
}
/** A peer credential can only attest its own sessions and request scoped tool grants.
 * It cannot read social data or administer either host. Native pairing transfers it
 * directly between the two hosts; neither renderer nor model ever receives it. */
export class SocialPeers {
  private readonly identities = new Map<string, HostSession>();
  constructor(
    private readonly service: SocialService,
    private readonly vault: SocialCredentialStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    service.store.db.exec(
      "CREATE TABLE IF NOT EXISTS social_peers (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS social_peer_tokens (hash TEXT PRIMARY KEY,peer_id TEXT NOT NULL,device_hash TEXT NOT NULL)",
    );
    service.setPeerResolver(
      (id) => this.identities.get(id),
      (id) => this.verify(id),
    );
    service.remoteAccess = (id) => this.access(id);
    service.isDelegated = () => !!this.get("authority");
  }
  private get(id: string): Peer | undefined {
    const row = this.service.store.db.prepare("SELECT value FROM social_peers WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as Peer) : undefined;
  }
  private save(id: string, peer: Peer) {
    this.service.store.db
      .prepare(
        "INSERT INTO social_peers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(peer));
  }
  status() {
    const authority = this.get("authority");
    return {
      environmentId: this.service.store.environmentId,
      authority: authority
        ? { environmentId: authority.environmentId, mapping: authority.mapping }
        : null,
      projects: this.service.store.projects().map(({ id, name }) => ({ id, name })),
    };
  }
  async enroll(targetId: string, deviceHash: string) {
    if (!targetId || targetId === this.service.store.environmentId || targetId.length > 200)
      throw new Error("Invalid social authority.");
    const token = randomBytes(32).toString("base64url");
    this.service.store.db.prepare("DELETE FROM social_peer_tokens WHERE peer_id=?").run(targetId);
    this.service.store.db
      .prepare("INSERT INTO social_peer_tokens VALUES (?,?,?)")
      .run(hash(token), targetId, deviceHash);
    await this.vault.set(`social-peer:${targetId}`, { accessToken: token });
    return { token, environmentId: this.service.store.environmentId };
  }
  authenticated(token: string): string | undefined {
    const row = this.service.store.db
      .prepare("SELECT peer_id,device_hash FROM social_peer_tokens WHERE hash=?")
      .get(hash(token));
    if (
      !row ||
      !this.service.store.db.prepare("SELECT id FROM devices WHERE hash=?").get(row.device_hash!)
    )
      return undefined;
    return String(row.peer_id);
  }
  private async rpc<T>(peer: Peer, method: string, params: Record<string, unknown>): Promise<T> {
    const credential = await this.vault.get(`social-peer:${peer.environmentId}`);
    if (!credential) throw new Error("Social peer credential unavailable; reconnect authority.");
    const response = await this.fetcher(`${endpoint(peer.endpoint)}/rpc`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: HOST_PROTOCOL_VERSION,
        environmentId: peer.environmentId,
        method,
        params,
      }),
    });
    const result = (await response.json()) as { result?: T; error?: string };
    if (!response.ok || result.error || result.result === undefined)
      throw new Error("Social authority session verification failed. Reconnect the trusted peer.");
    return result.result;
  }
  async register(input: Record<string, unknown>, deviceHash: string) {
    const environmentId = String(input.environmentId ?? "");
    if (
      !environmentId ||
      environmentId === this.service.store.environmentId ||
      environmentId.length > 200 ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(input.token))
    )
      throw new Error("Invalid trusted peer enrollment.");
    const mapping = input.mapping as Record<string, string>;
    if (
      !mapping ||
      typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      Object.keys(mapping).length > 1000 ||
      !Object.keys(mapping).length
    )
      throw new Error("Choose explicit source-to-authority project mappings.");
    const peer: Peer = {
      environmentId,
      endpoint: endpoint(input.endpoint),
      mapping,
    };
    // A failed check leaves no trusted inbound grant. The encrypted token can be
    // replaced by a subsequent pairing without modifying account credentials.
    await this.vault.set(`social-peer:${environmentId}`, {
      accessToken: String(input.token),
    });
    const source = await this.rpc<{
      projects: { id: string }[];
      authority: unknown;
    }>(peer, "social.peer.status", {});
    if (
      source.authority &&
      (source.authority as { environmentId?: string }).environmentId !==
        this.service.store.environmentId
    )
      throw new Error("Peer chains are not supported. Choose one direct central authority.");
    for (const [from, to] of Object.entries(mapping)) {
      if (!source.projects.some((project) => project.id === from) || typeof to !== "string")
        throw new Error("Source project identity was not verified.");
      this.service.store.project(to);
    }
    this.save(environmentId, peer);
    this.service.store.db
      .prepare("DELETE FROM social_peer_tokens WHERE peer_id=?")
      .run(environmentId);
    this.service.store.db
      .prepare("INSERT INTO social_peer_tokens VALUES (?,?,?)")
      .run(hash(String(input.token)), environmentId, deviceHash);
    return { connected: true, environmentId, mapping };
  }
  async useAuthority(input: Record<string, unknown>) {
    const targetId = String(input.environmentId ?? "");
    const peer: Peer = {
      environmentId: targetId,
      endpoint: endpoint(input.endpoint),
      mapping: input.mapping as Record<string, string>,
    };
    const target = await this.rpc<{
      environmentId: string;
      authority: unknown;
    }>(peer, "social.peer.status", {});
    if (target.environmentId !== targetId) throw new Error("Social authority identity changed.");
    if (target.authority)
      throw new Error("Peer chains are not supported. Choose one direct central authority.");
    this.service.suspendLocalExecution();
    this.save("authority", peer);
    return this.status();
  }
  resetAuthority() {
    this.service.suspendLocalExecution();
    const authority = this.get("authority");
    if (authority)
      this.service.store.db
        .prepare("DELETE FROM social_peer_tokens WHERE peer_id=?")
        .run(authority.environmentId);
    this.service.store.db.prepare("DELETE FROM social_peers WHERE id='authority'").run();
    return this.status();
  }
  async peerRpc(peerId: string, method: string, params: Record<string, unknown>) {
    if (method === "social.peer.status") return this.status();
    if (method === "social.peer.identity") {
      const session = this.service.sessionIdentity(String(params.sessionId ?? ""));
      if (session.session.id.includes("/"))
        throw new Error("Indirect peer sessions are not allowed.");
      return {
        sessionId: session.session.id,
        projectId: session.projectId,
        provider: session.session.harness,
      } satisfies Identity;
    }
    if (method === "social.peer.grant") {
      if (this.get("authority")) throw new Error("Only the central authority issues peer grants.");
      const peer = this.get(peerId);
      if (!peer) throw new Error("Peer project mapping is not registered.");
      const id = `${peerId}/${String(params.sessionId ?? "")}`;
      await this.verify(id);
      return {
        ...this.service.issueSessionGrant(id),
        environmentId: this.service.store.environmentId,
      };
    }
    throw new Error("Peer credentials cannot access this operation.");
  }
  private async verify(id: string) {
    if (!id.includes("/")) return;
    const split = id.indexOf("/");
    const peerId = id.slice(0, split);
    const sessionId = id.slice(split + 1);
    const peer = this.get(peerId);
    if (!peer || this.get("authority")) {
      this.identities.delete(id);
      throw new Error("Social peer was removed or is no longer an authority.");
    }
    try {
      const credential = await this.vault.get(`social-peer:${peerId}`);
      if (!credential || this.authenticated(credential.accessToken) !== peerId)
        throw new Error("Peer owner device was revoked.");
      const identity = await this.rpc<Identity>(peer, "social.peer.identity", {
        sessionId,
      });
      const projectId = peer.mapping[identity.projectId];
      if (identity.sessionId !== sessionId || !projectId || typeof identity.provider !== "string")
        throw new Error("Source session/project identity changed.");
      this.service.store.project(projectId);
      this.identities.set(id, {
        projectId,
        session: { id, harness: identity.provider },
      } as HostSession);
    } catch {
      this.identities.delete(id);
      throw new Error(
        "Trusted source session is unavailable or unmapped. Social access is denied.",
      );
    }
  }
  private async access(sessionId: string) {
    const authority = this.get("authority");
    if (!authority) return undefined;
    // Verify locally before requesting a central grant; tools cannot choose a
    // different session identity by passing JSON fields.
    this.service.sessionIdentity(sessionId);
    const grant = await this.rpc<{
      token: string;
      expiresAt: number;
      environmentId: string;
    }>(authority, "social.peer.grant", { sessionId });
    return { ...grant, endpoint: authority.endpoint };
  }
}
