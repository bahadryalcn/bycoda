import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_DEFAULTS,
  parseAgentDefaults,
  parseHostSettings,
} from "../../src/features/tasks/model/hostSettings";
import {
  createDefaultsAutoArchive,
  shouldAutoArchive,
  type ArchiveCandidate,
} from "./auto-archive";
import { agentDefaultsCapabilities } from "./archive-capability";

const now = 2_000_000_000_000;
const candidate: ArchiveCandidate = {
  running: false,
  archived: false,
  pinned: false,
  draft: false,
  needsInput: false,
  queued: false,
  lastActivityAt: now - 8 * 86_400_000,
  merged: true,
};
describe("agent defaults", () => {
  it("keeps old settings clients compatible and preserves unrelated defaults", () => {
    const current = {
      maxRunningTasks: 2,
      dailyAgentMinutes: 0,
      agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, resumeAtReset: false },
    };
    expect(parseHostSettings({ maxRunningTasks: 3 }, current).agentDefaults?.resumeAtReset).toBe(
      false,
    );
    expect(
      parseAgentDefaults({ streamingTextMode: "adaptive" }, current.agentDefaults),
    ).toMatchObject({ resumeAtReset: false, streamingTextMode: "adaptive" });
  });
  it("keeps usage limit failover off until the owner picks a target", () => {
    expect(DEFAULT_AGENT_DEFAULTS.usageLimitFailover).toBe("off");
    expect(parseAgentDefaults({ usageLimitFailover: "order" }).usageLimitFailover).toBe("order");
  });
  it.each([
    { resumeAtReset: "true" },
    { keepAwakeHoldAfter: 0 },
    { archiveInactiveDays: -1 },
    { archiveInactiveDays: 1.5 },
    { version: Infinity },
    { schemaVersion: 2 },
    { streamingTextMode: "fast" },
    { usageLimitFailover: "pool" },
  ])("rejects invalid patch %j", (patch) => {
    expect(() => parseAgentDefaults(patch)).toThrow();
  });
});
describe("automatic archive selection", () => {
  it("defaults off, allows either merged PR or inactivity", () => {
    expect(shouldAutoArchive(candidate, DEFAULT_AGENT_DEFAULTS, now)).toBe(false);
    expect(
      shouldAutoArchive(candidate, { ...DEFAULT_AGENT_DEFAULTS, archiveMergedSessions: true }, now),
    ).toBe(true);
    expect(
      shouldAutoArchive(
        { ...candidate, merged: false },
        { ...DEFAULT_AGENT_DEFAULTS, archiveInactiveDays: 7 },
        now,
      ),
    ).toBe(true);
    expect(
      shouldAutoArchive(
        { ...candidate, lastActivityAt: now, merged: false },
        { ...DEFAULT_AGENT_DEFAULTS, archiveInactiveDays: 7 },
        now,
      ),
    ).toBe(false);
  });
  it.each(["running", "archived", "pinned", "draft", "needsInput", "queued"] as const)(
    "protects %s even after merge",
    (key) => {
      expect(
        shouldAutoArchive(
          { ...candidate, [key]: true },
          { ...DEFAULT_AGENT_DEFAULTS, archiveMergedSessions: true, archiveInactiveDays: 7 },
          now,
        ),
      ).toBe(false);
    },
  );
  it("protects unknown disconnected-client drafts", () => {
    expect(
      shouldAutoArchive(
        { ...candidate, draft: undefined },
        { ...DEFAULT_AGENT_DEFAULTS, archiveMergedSessions: true, archiveInactiveDays: 7 },
        now,
      ),
    ).toBe(false);
  });
  it.each([NaN, Infinity, 0, now + 1])(
    "rejects unknown/future inactivity timestamp %s",
    (lastActivityAt) => {
      expect(
        shouldAutoArchive(
          { ...candidate, lastActivityAt },
          { ...DEFAULT_AGENT_DEFAULTS, archiveInactiveDays: 7 },
          now,
        ),
      ).toBe(false);
    },
  );
});
describe("archive capability gating", () => {
  it("advertises archive separately and never without draft authority", () => {
    expect(agentDefaultsCapabilities(false)).toEqual(["host.settings.behavior.v1"]);
    expect(agentDefaultsCapabilities()).toEqual([
      "host.settings.behavior.v1",
      "host.settings.autoArchive.v1",
    ]);
    expect(agentDefaultsCapabilities(true)).toEqual([
      "host.settings.behavior.v1",
      "host.settings.autoArchive.v1",
    ]);
  });
  it("does nothing without a client draft authority port", async () => {
    const limits = {
      settings: async () => ({
        agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, archiveMergedSessions: true },
      }),
    };
    const engine = {
      store: {
        projects: async () => {
          throw new Error("must not scan");
        },
      },
    };
    const archive = createDefaultsAutoArchive({
      engine: engine as never,
      limits: limits as never,
      queued: async () => false,
      running: async () => false,
    });
    expect(await archive.tick()).toBe(0);
  });
});

describe("automatic archive pass budget", () => {
  const day = 86_400_000;
  const settings = { ...DEFAULT_AGENT_DEFAULTS, archiveInactiveDays: 7 };
  type Fake = { id: string; project: string; updatedAt: number; extra?: Record<string, unknown> };
  function fixture(
    fakes: Fake[],
    options: {
      hang?: string;
      draft?: (id: string) => boolean | undefined;
      budget?: { deadlineMs?: number; passDeadlineMs?: number };
    } = {},
  ) {
    const archived = new Set<string>();
    const loaded: string[] = [];
    const deviceReads: string[] = [];
    const draftDevices: (string[] | undefined)[] = [];
    const projects = [...new Set(fakes.map((fake) => fake.project))];
    const engine = {
      store: {
        projects: async () => projects.map((id) => ({ id })),
        summaries: async (projectId: string) =>
          fakes
            .filter((fake) => fake.project === projectId)
            .map((fake) => ({
              id: fake.id,
              status: "idle",
              updatedAt: fake.updatedAt,
              archived: archived.has(fake.id),
              ...fake.extra,
            })),
        session: async (id: string) => {
          loaded.push(id);
          if (id === options.hang) await new Promise(() => {});
          const fake = fakes.find((item) => item.id === id)!;
          return {
            status: "idle",
            archived: false,
            updatedAt: fake.updatedAt,
            session: { blocks: [], busy: false },
          };
        },
        updateSession: async (id: string) => void archived.add(id),
      },
      sessionStoreWrite: (_id: string, work: () => Promise<void>) => work(),
    };
    const archive = createDefaultsAutoArchive({
      engine: engine as never,
      limits: { settings: async () => ({ agentDefaults: settings }) } as never,
      queued: async () => false,
      running: async () => false,
      draftDevices: async () => {
        deviceReads.push("read");
        return ["phone"];
      },
      hasUnsentDraft: async (id, _window, devices) => {
        draftDevices.push(devices);
        return options.draft ? options.draft(id) : false;
      },
      now: () => now,
      ...options.budget,
    });
    return { archive, archived, loaded, deviceReads, draftDevices };
  }
  const old = now - 30 * day;

  it("loads no transcript for recent, pinned or unresolved summaries", async () => {
    const run = fixture([
      { id: "recent", project: "p", updatedAt: now - 2 * day },
      { id: "pinned", project: "p", updatedAt: old, extra: { pinned: true } },
      { id: "asking", project: "p", updatedAt: old, extra: { needsInput: true } },
      { id: "drafting", project: "p", updatedAt: old, extra: { draft: true } },
      { id: "stale", project: "p", updatedAt: old },
    ]);
    expect(await run.archive.tick()).toBe(1);
    expect(run.loaded).toEqual(["stale"]);
    expect([...run.archived]).toEqual(["stale"]);
  });

  it("reads the paired devices once per pass and keeps unsent-draft protection", async () => {
    const run = fixture(
      [
        { id: "a", project: "p", updatedAt: old },
        { id: "b", project: "p", updatedAt: old },
        { id: "c", project: "q", updatedAt: old },
      ],
      { draft: (id) => (id === "b" ? true : id === "c" ? undefined : false) },
    );
    expect(await run.archive.tick()).toBe(1);
    expect(run.deviceReads).toHaveLength(1);
    expect(run.draftDevices).toEqual([["phone"], ["phone"], ["phone"]]);
    expect([...run.archived]).toEqual(["a"]);
  });

  it("gives a hung session its own deadline instead of starving later projects", async () => {
    const run = fixture(
      [
        { id: "hung", project: "p", updatedAt: old },
        { id: "later", project: "q", updatedAt: old },
      ],
      { hang: "hung", budget: { deadlineMs: 20, passDeadlineMs: 5_000 } },
    );
    await expect(run.archive.tick()).rejects.toThrow(/timed out/);
    expect([...run.archived]).toEqual(["later"]);
  });

  it("resumes after the last reached session when the pass budget runs out", async () => {
    const run = fixture(
      ["a", "b", "c"].map((id, index) => ({ id, project: `p${index}`, updatedAt: old })),
      { budget: { passDeadlineMs: 0 } },
    );
    expect(await run.archive.tick()).toBe(1);
    expect(await run.archive.tick()).toBe(1);
    expect(await run.archive.tick()).toBe(1);
    expect([...run.archived]).toEqual(["a", "b", "c"]);
  });
});
