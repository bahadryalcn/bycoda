import { afterEach, expect, it, vi } from "vitest";
import type { HostModelCatalog } from "../../src/features/connections/model/protocol";
import { RESUME_PROMPT } from "../../src/features/sessions/model/userPromptText";
import type { ModelRoutingService } from "../domains/model-routing/ports";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostLimits } from "../limits";
import type { HostProviderAccountCatalog } from "../providers/provider-accounts";
import type { UsageLimitsReport } from "../usage/limits-report";
import { createUsageLimitFailover, type UsageLimitFailoverPorts } from "./usage-limit-failover";

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const account = (id: string, kind?: "personal" | "work") => ({
  id,
  label: id === "default" ? "Host default" : `Account ${id}`,
  color: "#000000",
  ...(kind ? { kind } : {}),
});
const accounts: HostProviderAccountCatalog = {
  codex: [account("default"), account("work")],
};
const reading = (leftPercent: number) => ({
  usedPercent: 100 - leftPercent,
  leftPercent,
  regainPercent: 100 - leftPercent,
  windowMinutes: 300,
  resetsAt: null,
  timeLeftPercent: null,
  pace: null,
});
const report = (left: Record<string, number>): UsageLimitsReport => ({
  environmentId: "test",
  sampledAt: 0,
  source: "host-provider-api",
  providers: [
    {
      provider: "codex",
      cards: [
        {
          key: "session",
          kind: "session",
          model: null,
          best: reading(100),
          accounts: Object.entries(left).map(([id, percent]) => ({
            ...account(id),
            reading: reading(percent),
          })),
        },
      ],
      accounts: Object.keys(left).map((id) => ({
        ...account(id),
        status: "ok" as const,
        error: null,
        resetCredits: null,
      })),
    },
  ],
});
const catalog = {
  models: {
    codex: [{ id: "codex:test", harness: "codex", name: "Test", settings: [] }],
    claude: [{ id: "claude:next", harness: "claude", name: "Next", settings: [] }],
  },
  errors: {},
} as unknown as HostModelCatalog;
const noRouting = {
  get: async () => ({ entries: [] }),
  status: async () => [],
  resolve: async () => ({ ok: false, reason: "notConfigured", skipped: [] }),
} as unknown as ModelRoutingService;

/** A chat on account `work` whose first turn just stopped at a usage limit. */
async function limitedChat(
  mode: "off" | "account" | "order",
  overrides: Partial<UsageLimitFailoverPorts> = {},
) {
  const fixture = await setup();
  const { engine, store, id, turns, waitForTurnStart } = fixture;
  const stored = await store.session(id);
  await store.save(
    {
      ...stored,
      revision: stored.revision + 1,
      session: { ...stored.session, providerAccountId: "work" },
    },
    { type: "test.account" },
  );
  await new HostLimits(store).save({
    agentDefaults: { usageLimitFailover: mode },
    expectedAgentDefaultsVersion: 0,
  });
  const receipt = await engine.command({
    type: "send",
    commandId: "first",
    sessionId: id,
    text: "Work",
    resumeAtReset: false,
  });
  await waitForTurnStart();
  turns[0]!.input.onEvent({ type: "usage.limited", resetsAt: Date.now() + 3_600_000 });
  turns[0]!.finish();
  await engine.waitForRun(id, receipt.runId);
  const failover = createUsageLimitFailover({
    engine,
    withWriters: (_id, run) => run(),
    workRecords: async () => [],
    accounts: async () => accounts,
    limits: async () => report({ default: 40, work: 0 }),
    models: async () => catalog,
    routing: () => noRouting,
    ...overrides,
  });
  return { ...fixture, failover };
}

const notes = (blocks: { role: string; text?: string }[]) =>
  blocks.filter((block) => block.role === "system").map((block) => block.text);

it("moves to another account with quota and resumes there once", async () => {
  const { failover, store, id, turns, waitForTurnStart, provider } = await limitedChat("account");

  await failover.settled(id, {});
  await waitForTurnStart(2);

  expect(provider.send).toHaveBeenCalledTimes(2);
  expect(turns[1]!.input.text).toContain(RESUME_PROMPT);
  const { session } = await store.session(id);
  expect(session.providerAccountId).toBeUndefined();
  expect(session.usageLimit).toBeUndefined();
  expect(notes(session.blocks)).toContain(
    "Usage limit reached. Continuing on Host default · Test.",
  );
  turns[1]!.finish();
});

it("follows the model order across providers and skips the limited account", async () => {
  const resolve = vi.fn<ModelRoutingService["resolve"]>(async (input) => {
    const candidates = [
      { harness: "codex" as const, model: "codex:test", providerAccountId: "work" },
      { harness: "claude" as const, model: "claude:next" },
    ];
    const target = candidates.find((entry) => input.eligible?.({ ...entry, modelSettings: {} }));
    return target
      ? {
          ok: true,
          target: { ...target, modelSettings: {} },
          source: { kind: "order", entryId: target.model },
          skipped: [],
        }
      : { ok: false, reason: "noEligibleEntry", skipped: [] };
  });
  const routing = { ...noRouting, resolve };
  const { failover, store, id, turns, waitForTurnStart } = await limitedChat("order", {
    routing: () => routing,
  });

  await failover.settled(id, {});
  await waitForTurnStart(2);

  const { session } = await store.session(id);
  expect(session.harness).toBe("claude");
  expect(session.model).toBe("claude:next");
  expect(resolve.mock.calls[0]![0].cwd).toBeTruthy();
  turns[1]!.finish();
});

it("says why and keeps waiting when no account has quota", async () => {
  const { failover, store, id, provider } = await limitedChat("account", {
    limits: async () => report({ default: 0, work: 0 }),
  });

  await failover.settled(id, {});

  expect(provider.send).toHaveBeenCalledTimes(1);
  const { session } = await store.session(id);
  expect(session.providerAccountId).toBe("work");
  expect(session.usageLimit).toBeDefined();
  expect(notes(session.blocks)).toContain(
    "No other account has quota left. Waiting for the usage limit to reset.",
  );
});

it("treats an unreadable quota as no headroom", async () => {
  const { failover, store, id, provider } = await limitedChat("account", {
    limits: async () => {
      throw new Error("offline");
    },
  });

  await failover.settled(id, {});

  expect(provider.send).toHaveBeenCalledTimes(1);
  expect((await store.session(id)).session.providerAccountId).toBe("work");
});

it("never moves to an account of the project's other scope", async () => {
  const scoped: HostProviderAccountCatalog = {
    codex: [account("default", "personal"), account("work", "work")],
  };
  const fixture = await limitedChat("account", {
    accounts: async () => scoped,
    routing: () => ({
      ...noRouting,
      get: async () => {
        const project = await fixture.store.project(
          (await fixture.store.session(fixture.id)).projectId,
        );
        const { modelRoutingProjectKey } = await import("../../src/shared/model/modelRoutingPools");
        return {
          entries: [],
          projectKinds: { [modelRoutingProjectKey(project.cwd)]: "work" },
        } as never;
      },
    }),
  });

  await fixture.failover.settled(fixture.id, {});

  expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  expect((await fixture.store.session(fixture.id)).session.providerAccountId).toBe("work");
});

it.each([
  ["the setting is off", "off", {}],
  ["the owner stopped the turn", "account", { cancelled: true }],
  ["the Host stopped the turn", "account", { interrupted: true }],
] as const)("does nothing when %s", async (_name, mode, outcome) => {
  const { failover, store, id, provider } = await limitedChat(mode);

  await failover.settled(id, outcome);

  expect(provider.send).toHaveBeenCalledTimes(1);
  const { session } = await store.session(id);
  expect(session.providerAccountId).toBe("work");
  expect(session.usageLimit).toBeDefined();
});

it("leaves a session named by a task or other work to its owner", async () => {
  const fixture = await limitedChat("account", {
    workRecords: async (id) => [{ id: "task", verification: { review: { sessionId: id } } }],
  });

  await fixture.failover.settled(fixture.id, {});

  expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  expect((await fixture.store.session(fixture.id)).session.providerAccountId).toBe("work");
});

it("leaves a Native conversation the desktop app still owns to the desktop", async () => {
  const fixture = await limitedChat("account");
  const stored = await fixture.store.session(fixture.id);
  await fixture.store.save(
    { ...stored, revision: stored.revision + 1, desktop: { updatedAt: 1_000 } },
    { type: "test.adopted" },
  );

  await fixture.failover.settled(fixture.id, {});

  expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  expect((await fixture.store.session(fixture.id)).session.providerAccountId).toBe("work");
});

it("keeps the owner's answer when the limit changed during the quota read", async () => {
  const holder: { dismiss?: () => Promise<unknown> } = {};
  const fixture = await limitedChat("account", {
    limits: async () => {
      await holder.dismiss?.();
      return report({ default: 40, work: 0 });
    },
  });
  holder.dismiss = () =>
    fixture.engine.command({
      type: "usageLimit",
      commandId: "dismiss",
      sessionId: fixture.id,
      action: "dismiss",
    });

  await fixture.failover.settled(fixture.id, {});

  expect(fixture.provider.send).toHaveBeenCalledTimes(1);
  expect((await fixture.store.session(fixture.id)).session.providerAccountId).toBe("work");
});
