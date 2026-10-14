import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import {
  liveAgentsEqual,
  sessionSummariesEqual,
  stringArraysEqual,
  worktreeTabStatsEqual,
} from "./sidebarEquality";

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    cwd: "/p",
    harness: "claude",
    model: "m",
    runtimeMode: "default",
    title: "t",
    createdAt: 10,
    updatedAt: 20,
    ...over,
  } as SessionSummary;
}

function agent(over: Partial<LiveAgent> = {}): LiveAgent {
  return {
    id: "a",
    cwd: "/p",
    title: "t",
    harness: "claude",
    activity: "Working",
    startedAt: 1,
    needsApproval: false,
    done: false,
    ...over,
  } as LiveAgent;
}

describe("sessionSummariesEqual", () => {
  it("is true for equal content in fresh objects", () => {
    const a = [summary({ linkedWorkItem: { kind: "pr" } as never })];
    const b = [summary({ linkedWorkItem: { kind: "pr" } as never })];
    expect(sessionSummariesEqual(a, b)).toBe(true);
  });

  it.each<[string, Partial<SessionSummary>]>([
    ["id", { id: "s2" }],
    ["cwd", { cwd: "/q" }],
    ["harness", { harness: "codex" }],
    ["model", { model: "n" }],
    ["title", { title: "u" }],
    ["branch", { branch: "x" }],
    ["repo", { repo: "r" }],
    ["worktreeCwd", { worktreeCwd: "/w" }],
    ["additions", { additions: 3 }],
    ["pinned", { pinned: true }],
    ["draft", { draft: true }],
    ["archived", { archived: true }],
    ["automationId", { automationId: "au" }],
    ["updatedAt", { updatedAt: 99 }],
    ["linkedWorkItem", { linkedWorkItem: { kind: "issue" } as never }],
    ["orchestration", { orchestration: { status: "running", live: true, tasks: [] } as never }],
  ])("is false when %s differs", (_name, over) => {
    expect(sessionSummariesEqual([summary()], [summary(over)])).toBe(false);
  });

  it("is false for different lengths or order", () => {
    expect(sessionSummariesEqual([summary()], [])).toBe(false);
    const x = summary({ id: "x" });
    const y = summary({ id: "y" });
    expect(sessionSummariesEqual([x, y], [y, x])).toBe(false);
  });

  it("compares the Date.now() stamp on live-synthesised rows by the minute", () => {
    const live = (updatedAt: number) => summary({ createdAt: 0, updatedAt });
    expect(sessionSummariesEqual([live(1)], [live(2)])).toBe(true);
    expect(sessionSummariesEqual([live(1)], [live(60_001)])).toBe(false);
    expect(sessionSummariesEqual([summary({ updatedAt: 1 })], [summary({ updatedAt: 2 })])).toBe(
      false,
    );
  });
});

describe("liveAgentsEqual", () => {
  it("is true for equal content", () => {
    expect(liveAgentsEqual([agent()], [agent()])).toBe(true);
  });

  it.each<[string, Partial<LiveAgent>]>([
    ["id", { id: "b" }],
    ["cwd", { cwd: "/q" }],
    ["title", { title: "u" }],
    ["harness", { harness: "codex" }],
    ["activity", { activity: "Reading" }],
    ["startedAt", { startedAt: 2 }],
    ["durationMs", { durationMs: 5 }],
    ["needsApproval", { needsApproval: true }],
    ["done", { done: true }],
  ])("is false when %s differs", (_name, over) => {
    expect(liveAgentsEqual([agent()], [agent(over)])).toBe(false);
  });

  it("is false for different lengths", () => {
    expect(liveAgentsEqual([agent()], [])).toBe(false);
  });
});

describe("worktreeTabStatsEqual", () => {
  const map = (entries: [string, { tabs: number; busy: boolean }][]) => new Map(entries);

  it("is true for equal content", () => {
    expect(
      worktreeTabStatsEqual(
        map([["a", { tabs: 1, busy: false }]]),
        map([["a", { tabs: 1, busy: false }]]),
      ),
    ).toBe(true);
  });

  it("is false when tabs, busy, key or size differ", () => {
    const base = map([["a", { tabs: 1, busy: false }]]);
    const differs = (other: ReturnType<typeof map>) => worktreeTabStatsEqual(base, other);
    expect(differs(map([["a", { tabs: 2, busy: false }]]))).toBe(false);
    expect(differs(map([["a", { tabs: 1, busy: true }]]))).toBe(false);
    expect(differs(map([["b", { tabs: 1, busy: false }]]))).toBe(false);
    expect(differs(map([]))).toBe(false);
  });
});

describe("stringArraysEqual", () => {
  it("compares by value and order", () => {
    expect(stringArraysEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(stringArraysEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(stringArraysEqual(["a"], [])).toBe(false);
  });
});
