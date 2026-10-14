import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { SocialService, type SocialPrincipal } from "./social";
import { SocialPeers } from "./social-peers";
import type { SocialCredential } from "./social-credentials";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { SocialAccount, SocialCampaign, SocialJob } from "../src/features/social/model/social";
import type { SocialAdapters } from "../src/integrations/social/adapter";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);
const owner: SocialPrincipal = {
  kind: "owner",
  actorId: "native-owner",
  provider: "owner",
};
function pair() {
  const registry = new Map<string, SocialPeers>();
  const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const peer = registry.get(new URL(String(raw)).origin)!;
    const token = String((init?.headers as Record<string, string>).Authorization).slice(7);
    const identity = peer.authenticated(token);
    if (!identity) return Response.json({ error: "revoked" }, { status: 401 });
    const call = JSON.parse(String(init?.body));
    if (call.environmentId !== peer.status().environmentId)
      return Response.json({ error: "wrong host" }, { status: 403 });
    try {
      return Response.json({
        result: await peer.peerRpc(identity, call.method, call.params),
      });
    } catch {
      return Response.json({ error: "denied" }, { status: 403 });
    }
  }) as unknown as typeof fetch;
  const host = (name: string) => {
    const path = mkdtempSync(join(tmpdir(), `social-peer-${name}-`));
    const store = new HostStore(join(path, "host.db"));
    const project = store.addProject(path, name);
    const device = store.issueDevice("Native");
    const deviceHash = createHash("sha256").update(device.token).digest("hex");
    const tokens = new Map<string, SocialCredential>();
    const vault = {
      get: async (id: string) => tokens.get(id),
      set: async (id: string, value: SocialCredential) => {
        tokens.set(id, value);
      },
      delete: async (id: string) => {
        tokens.delete(id);
      },
    };
    const sessions = new Map<string, HostSession>();
    const send = vi.fn(async () => ({ platformId: "platform-post" }));
    const adapter = { send, poll: vi.fn(async () => ({ events: [] })) };
    const social = new SocialService(
      store,
      vault,
      Object.fromEntries(
        ["x", "instagram", "facebook", "linkedin"].map((key) => [key, adapter]),
      ) as SocialAdapters,
      path,
      (id) => {
        const session = sessions.get(id);
        if (!session) throw new Error("Unknown source session");
        return session;
      },
    );
    const peers = new SocialPeers(social, vault, fetcher);
    const endpoint = `https://${name}.test`;
    registry.set(endpoint, peers);
    cleanup.push(() => {
      social.stop();
      store.close();
      rmSync(path, { recursive: true, force: true });
    });
    return {
      store,
      project,
      device,
      deviceHash,
      sessions,
      social,
      peers,
      endpoint,
      send,
    };
  };
  return { source: host("windows"), authority: host("mac"), fetcher };
}
describe("Tek merkezi host'a güvenilir session erişimi", () => {
  it("iki host aynı kampanyayı paylaşır; kimlik source host'tan doğrulanır ve ACL merkezi uygulanır", async () => {
    const { source, authority } = pair();
    const sourceId = crypto.randomUUID();
    source.sessions.set(sourceId, {
      projectId: source.project.id,
      session: { id: sourceId, harness: "claude" },
    } as HostSession);
    const enrollment = await source.peers.enroll(authority.store.environmentId, source.deviceHash);
    const mapping = { [source.project.id]: authority.project.id };
    await authority.peers.register(
      { ...enrollment, endpoint: source.endpoint, mapping },
      authority.deviceHash,
    );
    await source.peers.useAuthority({
      environmentId: authority.store.environmentId,
      endpoint: authority.endpoint,
      mapping,
    });
    const account = (await authority.social.call(owner, "accounts.create", {
      platform: "x",
      name: "Shared",
      accountType: "member",
      projectIds: [authority.project.id],
    })) as SocialAccount;
    const campaign = (await authority.social.call(owner, "campaigns.create", {
      name: "One queue",
      projectIds: [authority.project.id],
      variants: [
        {
          accountId: account.id,
          text: "Public information",
          media: [],
          factIds: [],
        },
      ],
    })) as SocialCampaign;
    const grant = await source.social.remoteAccess!(sourceId);
    expect(grant?.endpoint).toBe(authority.endpoint);
    const principal = authority.social.principalForToken(grant!.token)!;
    expect(principal).toMatchObject({
      provider: "claude",
      projectId: authority.project.id,
      sessionId: `${source.store.environmentId}/${sourceId}`,
    });
    expect(
      await authority.social.call(principal, "campaigns.status", {
        id: campaign.id,
      }),
    ).toMatchObject({ campaign: { id: campaign.id } });
    await authority.social.call(owner, "accounts.grants", {
      accountId: account.id,
      projectId: authority.project.id,
      permissions: [],
    });
    await expect(
      authority.social.call(principal, "campaigns.status", { id: campaign.id }),
    ).rejects.toThrow("permission");
    await expect(
      source.social.call(owner, "execution.enable", {
        confirm: "ENABLE_EXTERNAL_SENDS",
      }),
    ).rejects.toThrow("delegates");
    await expect(
      source.peers.peerRpc(authority.store.environmentId, "social.request", {
        action: "accounts.list",
      }),
    ).rejects.toThrow("cannot access");
    source.store.revokeDevice(source.device.id);
    await expect(authority.social.call(principal, "accounts.list", {})).rejects.toThrow(
      "unavailable",
    );
  });
  it("kaynak session proje değişimi veya eşleme dışı kimlik iddiası merkezi grant alamaz", async () => {
    const { source, authority } = pair();
    const enrollment = await source.peers.enroll(authority.store.environmentId, source.deviceHash);
    await expect(
      authority.peers.register(
        {
          ...enrollment,
          endpoint: source.endpoint,
          mapping: { fake: authority.project.id },
        },
        authority.deviceHash,
      ),
    ).rejects.toThrow("not verified");
    await authority.peers.register(
      {
        ...enrollment,
        endpoint: source.endpoint,
        mapping: { [source.project.id]: authority.project.id },
      },
      authority.deviceHash,
    );
    await expect(
      authority.peers.peerRpc(source.store.environmentId, "social.peer.grant", {
        sessionId: "fake",
        provider: "owner",
        projectId: authority.project.id,
      }),
    ).rejects.toThrow("unavailable");
    const id = crypto.randomUUID();
    source.sessions.set(id, {
      projectId: source.project.id,
      session: { id, harness: "codex" },
    } as HostSession);
    const grant = (await authority.peers.peerRpc(source.store.environmentId, "social.peer.grant", {
      sessionId: id,
    })) as { token: string };
    const principal = authority.social.principalForToken(grant.token)!;
    source.sessions.delete(id);
    await expect(authority.social.call(principal, "accounts.list", {})).rejects.toThrow(
      "unavailable",
    );
    expect(await authority.social.call(owner, "jobs.status", {})).toEqual([] as SocialJob[]);
  });
});
