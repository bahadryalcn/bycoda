import { vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { SocialService, type SocialPrincipal } from "./social";
import type { SocialAdapter, SocialAdapters } from "../../src/integrations/social/adapter";
import { platformRequirements } from "../../src/integrations/social/capabilities";
import type { SocialCredential, SocialCredentialStore } from "./social-credentials";
import type {
  SocialAccount,
  SocialCampaign,
  SocialPublishingPlan,
  SocialSnapshot,
  SocialThread,
} from "../../src/features/social/model/social";
import { REMOTE_PROVIDERS } from "../../src/features/connections/model/protocol";
import { SOCIAL_ACCOUNT_TYPES, SOCIAL_PLATFORMS } from "../../src/features/social/model/social";

// Shared Social Host test fixture. Tests register cleanups here and run them from afterEach.

export const cleanups: (() => void | Promise<void>)[] = [];
export async function runCleanups() {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

export const owner: SocialPrincipal = {
  kind: "owner",
  actorId: "owner-device",
  provider: "owner",
};

export async function fixture(
  generateText?: import("./social-generation").SocialTextGenerator,
  browserAdapter?: SocialAdapter,
) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-social-"));
  const database = join(directory, "host.db");
  let store = new HostStore(database);
  const a = await store.addProject(directory, "A");
  mkdirSync(join(directory, "b"));
  const b = await store.addProject(join(directory, "b"), "B");
  const provider = {
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  let engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])),
  );
  const tokens = new Map<string, SocialCredential>();
  const credentials: SocialCredentialStore = {
    get: vi.fn(async (id) => tokens.get(id)),
    set: vi.fn(async (id, value) => {
      tokens.set(id, value);
    }),
    delete: vi.fn(async (id) => {
      tokens.delete(id);
    }),
  };
  const send = vi.fn<SocialAdapter["send"]>(async (_account, job) => ({
    platformId: `post-${job.id}`,
    url: `https://example.com/${job.id}`,
  }));
  const poll = vi.fn<SocialAdapter["poll"]>(async () => ({ events: [] }));
  // Test fixture: every platform gets the same send/poll mocks, and only those two methods exist.
  const adapters = Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => [platform, { send, poll }]),
  ) as unknown as SocialAdapters;
  const clock = { value: Date.parse("2026-10-10T09:00:00Z") };
  let social = new SocialService(
    store,
    credentials,
    adapters,
    directory,
    undefined,
    () => clock.value,
    generateText,
    browserAdapter,
  );
  cleanups.push(async () => {
    await social.dispose();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async <T>(
    action: string,
    input: Record<string, unknown> = {},
    p = owner,
    requestId?: string,
  ) => (await social.call(p, action, input, requestId)) as Promise<T>;
  const session = async (
    projectId = a.id,
    harness: (typeof REMOTE_PROVIDERS)[number] = "codex",
  ) => {
    const result = await engine.command({
      type: "create",
      commandId: crypto.randomUUID(),
      projectId,
      harness,
      model: `${harness}:test`,
      runtimeMode: "supervised",
    });
    const grant = await social.issueSessionGrant(result.sessionId);
    return {
      id: result.sessionId,
      token: grant.token,
      principal: (await social.principalForToken(grant.token))!,
    };
  };
  const account = async (
    platform: SocialAccount["platform"] = "x",
    projectIds = [a.id],
    name = "Account",
  ) => {
    const created = await call<SocialAccount>("accounts.create", {
      platform,
      name,
      accountType: SOCIAL_ACCOUNT_TYPES[platform][0],
      projectIds,
    });
    const scopes = [
      ...new Set(
        Object.values(platformRequirements(platform, created.accountType)).flatMap(
          (item) => item.scopes,
        ),
      ),
    ];
    await social.connectAccount(
      created.id,
      {
        platformId: platform === "snapchat" ? created.id : `${platform}-${created.id}`,
        name,
        scopes,
        accessApproved: true,
      },
      {
        accessToken: "synthetic-private-token",
        expiresAt: clock.value + 3600000,
      },
    );
    for (const projectId of projectIds)
      await call("accounts.grants", {
        accountId: created.id,
        projectId,
        permissions: ["read", "draft", "publish", "reply", "message", "comment"],
      });
    return created;
  };
  const campaign = async (accounts: SocialAccount[], projectIds = [a.id]) => {
    const result = await call<SocialCampaign>("campaigns.create", {
      name: "Announcement",
      projectIds,
      variants: accounts.map((account) => ({
        accountId: account.id,
        text: "Public owner-authored announcement.",
        scheduledAt: clock.value,
        media: [],
        factIds: [],
      })),
    });
    await call("campaigns.approve", { id: result.id });
    return result;
  };
  const thread = async (
    account: SocialAccount,
    eventId = "event-1",
    text = "hello",
    kind: "message" | "comment" = "message",
  ) => {
    await social.ingest(account.id, [
      {
        eventId,
        threadId: "conversation-1",
        contactId: "recipient-1",
        contactName: "Recipient",
        kind,
        text,
        at: clock.value,
        replyUntil: clock.value + 3600000,
      },
    ]);
    return (await call<SocialThread[]>("inbox.list"))[0];
  };
  const enable = async () => await call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
  return {
    directory,
    database,
    a,
    b,
    get engine() {
      return engine;
    },
    credentials,
    tokens,
    clock,
    adapters,
    send,
    poll,
    call,
    session,
    account,
    approveDraft: async (id: string) =>
      await call("drafts.approve", {
        id,
        reviewedDraft: (await social.snapshot(owner)).drafts.find((draft) => draft.id === id),
      }),
    campaign,
    thread,
    enable,
    get social() {
      return social;
    },
    get store() {
      return store;
    },
    restart: async () => {
      await social.stop();
      await engine.close();
      await store.close();
      store = new HostStore(database);
      engine = new HostEngine(
        store,
        Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])),
      );
      social = new SocialService(
        store,
        credentials,
        adapters,
        directory,
        undefined,
        () => clock.value,
        generateText,
        browserAdapter,
      );
      const initialTick = vi.spyOn(social, "tick");
      try {
        await social.start();
        await Promise.all(initialTick.mock.results.map((result) => result.value));
      } finally {
        initialTick.mockRestore();
      }
    },
  };
}

export const createPlan = async (
  s: Awaited<ReturnType<typeof fixture>>,
  account: SocialAccount,
  campaigns: SocialCampaign[],
  schedule = {},
) => {
  // Recurring tests need a durable synthetic connection, including account metadata.
  // Other fixtures retain their one-hour expiry for authorization coverage.
  const connected = (await s.call<SocialSnapshot>("snapshot")).accounts.find(
    (item) => item.id === account.id,
  )!;
  await s.social.connectAccount(
    account.id,
    {
      platformId: connected.platformId,
      name: connected.name,
      scopes: connected.scopes,
      accessApproved: connected.accessApproved,
      connection: connected.connection,
    },
    { accessToken: s.tokens.get(account.id)!.accessToken },
  );
  return await s.call<SocialPublishingPlan>("publishing-plans.create", {
    name: "Daily announcements",
    accountId: account.id,
    projectId: s.a.id,
    campaignIds: campaigns.map((campaign) => campaign.id),
    schedule: {
      timeZone: "Europe/Istanbul",
      startTime: "09:00",
      endTime: "18:00",
      minIntervalMinutes: 120,
      maxIntervalMinutes: 120,
      ...schedule,
    },
  });
};
export const activate = async (
  s: Awaited<ReturnType<typeof fixture>>,
  plan: SocialPublishingPlan,
) =>
  await s.call<SocialPublishingPlan>("publishing-plans.activate", {
    id: plan.id,
    revision: plan.revision,
    confirm: "ACTIVATE_PUBLISHING_PLAN",
  });
