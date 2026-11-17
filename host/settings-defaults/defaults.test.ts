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
  it.each([
    { resumeAtReset: "true" },
    { keepAwakeHoldAfter: 0 },
    { archiveInactiveDays: -1 },
    { archiveInactiveDays: 1.5 },
    { version: Infinity },
    { schemaVersion: 2 },
    { streamingTextMode: "fast" },
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
