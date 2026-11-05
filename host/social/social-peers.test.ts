import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { SocialService, type SocialPrincipal } from "./social";
import { SocialPeers } from "./social-peers";
import { SocialPeerUnavailable } from "./social-peer-errors";
import type { SocialCredential } from "./social-credentials";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type {
  SocialAccount,
  SocialCampaign,
  SocialJob,
} from "../../src/features/social/model/social";
import type { SocialAdapters } from "../../src/integrations/social/adapter";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const owner: SocialPrincipal = {
  kind: "owner",
  actorId: "native-owner",
  provider: "owner",
};
async function pair() {
  const registry = new Map<string, SocialPeers>();
  const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const peer = registry.get(new URL(String(raw)).origin)!;
    const token = String((init?.headers as Record<string, string>).Authorization).slice(7);
    const identity = await peer.authenticated(token);
    if (!identity) return Response.json({ error: "revoked" }, { status: 401 });
    const call = JSON.parse(String(init?.body));
    if (call.environmentId !== (await peer.status()).environmentId)
      return Response.json({ error: "wrong host" }, { status: 403 });
    try {
      return Response.json({
        result: await peer.peerRpc(identity, call.method, call.params),
      });
    } catch {
      return Response.json({ error: "denied" }, { status: 403 });
    }
  }) as unknown as typeof fetch;
  const host = async (name: string) => {
    const path = mkdtempSync(join(tmpdir(), `social-peer-${name}-`));
    const store = new HostStore(join(path, "host.db"));
    const project = await store.addProject(path, name);
    const device = await store.issueDevice("Native");
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
    cleanup.push(async () => {
      await social.dispose();
      await store.close();
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
  return { source: await host("windows"), authority: await host("mac"), fetcher };
}
describe("Tek merkezi host'a güvenilir session erişimi", () => {
  it("iki host aynı kampanyayı paylaşır; kimlik source host'tan doğrulanır ve ACL merkezi uygulanır", async () => {
    const { source, authority } = await pair();
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
    const principal = (await authority.social.principalForToken(grant!.token))!;
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
    await source.store.revokeDevice(source.device.id);
    await expect(authority.social.call(principal, "accounts.list", {})).rejects.toThrow(
      "unavailable",
    );
  });
  it("kaynak session proje değişimi veya eşleme dışı kimlik iddiası merkezi grant alamaz", async () => {
    const { source, authority } = await pair();
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
    })) as {
      token: string;
    };
    const principal = (await authority.social.principalForToken(grant.token))!;
    source.sessions.delete(id);
    await expect(authority.social.call(principal, "accounts.list", {})).rejects.toThrow(
      "unavailable",
    );
    expect(await authority.social.call(owner, "jobs.status", {})).toEqual([] as SocialJob[]);
  });
});

it("loads durable peer identities without a lifetime Map and re-verifies source before reuse", async () => {
  const { source, authority } = await pair();
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
  const id = `${source.store.environmentId}/${sourceId}`;
  expect((await authority.social.sessionIdentity(id)).projectId).toBe(authority.project.id);
  expect("identities" in authority.peers).toBe(false);
  const persisted = await authority.store.db
    .prepare("SELECT value FROM social_peer_identities WHERE id=?")
    .get(id);
  expect(persisted).toBeDefined();
  source.sessions.delete(sourceId);
  const denial = await authority.social.sessionIdentity(id).catch((error: unknown) => error);
  expect(denial).toBeInstanceOf(Error);
  expect(denial).not.toBeInstanceOf(SocialPeerUnavailable);
  expect((denial as Error).message).toContain("verification denied");
  // Retained evidence never becomes successful authority when fresh lookup fails.
  expect(
    await authority.store.db.prepare("SELECT value FROM social_peer_identities WHERE id=?").get(id),
  ).toEqual(persisted);
});

async function queuedPeerJob() {
  const f = await pair();
  const sourceId = crypto.randomUUID();
  f.source.sessions.set(sourceId, {
    projectId: f.source.project.id,
    session: { id: sourceId, harness: "claude" },
  } as HostSession);
  const enrollment = await f.source.peers.enroll(
    f.authority.store.environmentId,
    f.source.deviceHash,
  );
  const mapping = { [f.source.project.id]: f.authority.project.id };
  await f.authority.peers.register(
    { ...enrollment, endpoint: f.source.endpoint, mapping },
    f.authority.deviceHash,
  );
  await f.source.peers.useAuthority({
    environmentId: f.authority.store.environmentId,
    endpoint: f.authority.endpoint,
    mapping,
  });
  const grant = await f.source.social.remoteAccess!(sourceId);
  const principal = (await f.authority.social.principalForToken(grant!.token))!;
  const account = (await f.authority.social.call(owner, "accounts.create", {
    platform: "x",
    name: "Account",
    accountType: "member",
    projectIds: [f.authority.project.id],
  })) as SocialAccount;
  await f.authority.social.connectAccount(
    account.id,
    {
      platformId: "account",
      name: "Account",
      scopes: ["tweet.read", "tweet.write", "users.read"],
      accessApproved: true,
    },
    { accessToken: "test-token" },
  );
  await f.authority.social.call(owner, "accounts.grants", {
    accountId: account.id,
    projectId: f.authority.project.id,
    permissions: ["read", "draft", "publish"],
  });
  const campaign = (await f.authority.social.call(owner, "campaigns.create", {
    name: "Campaign",
    projectIds: [f.authority.project.id],
    variants: [
      {
        accountId: account.id,
        text: "hello",
        media: [],
        factIds: [],
        scheduledAt: Date.now() + 600_000,
      },
    ],
  })) as SocialCampaign;
  await f.authority.social.call(owner, "campaigns.approve", { id: campaign.id });
  const [job] = (await f.authority.social.call(principal, "campaigns.schedule", {
    id: campaign.id,
  })) as SocialJob[];
  await f.authority.social.call(owner, "execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
  const execute = () =>
    (f.authority.social as unknown as { execute(id: string): Promise<boolean> }).execute(job.id);
  const read = () =>
    f.authority.social.call(owner, "jobs.status", { id: job.id }) as Promise<SocialJob>;
  return { ...f, sourceId, job, execute, read };
}

it("retries an unavailable peer with the same job and offers it once after wake", async () => {
  const f = await queuedPeerJob();
  const originalFetch = vi.mocked(f.fetcher).getMockImplementation()!;
  vi.mocked(f.fetcher)
    .mockImplementationOnce(originalFetch)
    .mockRejectedValueOnce(new TypeError("offline"));
  await f.execute();
  expect(await f.read()).toMatchObject({
    id: f.job.id,
    operationId: f.job.operationId,
    status: "queued",
  });
  expect(f.authority.send).not.toHaveBeenCalled();
  await f.execute();
  expect(await f.read()).toMatchObject({ id: f.job.id, status: "succeeded" });
  expect(f.authority.send).toHaveBeenCalledTimes(1);
});

it("denies a changed peer identity before offer", async () => {
  const f = await queuedPeerJob();
  f.source.sessions.set(f.sourceId, {
    projectId: f.source.project.id,
    session: { id: f.sourceId, harness: "codex" },
  } as HostSession);
  await f.execute();
  expect(await f.read()).toMatchObject({ status: "cancelled" });
  expect(f.authority.send).not.toHaveBeenCalled();
});

it("holds an unavailable peer after offer for review", async () => {
  const f = await queuedPeerJob();
  (
    f.authority.send as unknown as {
      mockImplementation(fn: (...args: any[]) => Promise<never>): void;
    }
  ).mockImplementation(async (...args) => {
    vi.mocked(f.fetcher).mockRejectedValueOnce(new TypeError("offline"));
    await args[5]();
    throw new Error("unexpected");
  });
  await f.execute();
  expect(await f.read()).toMatchObject({ status: "review" });
  await f.execute();
  expect(f.authority.send).toHaveBeenCalledTimes(1);
});
