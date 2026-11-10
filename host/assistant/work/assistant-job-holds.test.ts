import { describe, expect, it } from "vitest";
import type { AssistantSnapshot } from "../../../src/shared/model/host-contracts/assistant";
import {
  withJobHolds,
  assistantJobHolds,
  assistantJobNotificationBody,
} from "./assistant-job-holds";

const job = (id: string, status: string, kind?: string) => ({ id, status, kind });
function input(over: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  return {
    jobs: [job("q", "queued"), job("r", "running"), job("quick", "queued", "quick")],
    profile: {
      enabled: true,
      setupComplete: true,
      autonomy: "jobs",
      execution: { model: "m" },
      ...profile,
    },
    usage: { mode: "run" },
    paused: false,
    workHoursActive: true,
    emergencyStop: false,
    canCreateGoal: true,
    ...over,
  } as unknown as Parameters<typeof assistantJobHolds>[0];
}

describe("assistantJobHolds", () => {
  it("returns nothing when queued jobs can start", () => {
    expect(assistantJobHolds(input())).toEqual({});
  });
  it.each([
    ["disabled", {}, { enabled: false }],
    ["disabled", {}, { setupComplete: false }],
    ["paused", { paused: true }, {}],
    ["paused", { emergencyStop: true }, {}],
    ["budget", { usage: { mode: "report" } }, {}],
    ["budget", { usage: { mode: "paused" } }, {}],
    ["report", {}, { autonomy: "report" }],
    ["hours", { workHoursActive: false }, {}],
    ["noExecution", {}, { execution: null }],
    ["noExecution", { canCreateGoal: false }, {}],
  ])("holds queued project jobs as %s", (reason, over, profile) => {
    expect(assistantJobHolds(input(over, profile))).toEqual({ q: reason });
  });
});

describe("assistantJobNotificationBody", () => {
  it("says why a job is waiting or stalled", () => {
    expect(assistantJobNotificationBody("waiting", "", "planApproval", 15)).toBe(
      "Plan approval needed.",
    );
    expect(assistantJobNotificationBody("waiting", "boom", "error", 15)).toBe(
      "Stopped with an error: boom",
    );
    expect(assistantJobNotificationBody("waiting", "Q?", "owner", 15)).toBe("Needs your input. Q?");
    expect(assistantJobNotificationBody("stalled", "last", undefined, 15)).toBe(
      "No output for 15 minutes. last",
    );
    expect(assistantJobNotificationBody("waiting", "", undefined, 15)).toBe("Job is waiting.");
    expect(assistantJobNotificationBody("done", "ok", undefined, 15)).toBe(
      "ok No verification was recorded.",
    );
  });
});

describe("assistantJobHolds model holds", () => {
  const modelHolds = { q: { held: "limits" as const } };
  it("reports limits and noModel before noExecution", () => {
    expect(assistantJobHolds(input({ modelHolds }, { execution: null }))).toEqual({ q: "limits" });
    expect(assistantJobHolds(input({ modelHolds: { q: { held: "noRow" } } }))).toEqual({
      q: "noModel",
    });
  });
  it("yields to the earlier gates", () => {
    expect(assistantJobHolds(input({ modelHolds, workHoursActive: false }))).toEqual({
      q: "hours",
    });
    expect(assistantJobHolds(input({ modelHolds, paused: true }))).toEqual({ q: "paused" });
  });
});

describe("withJobHolds", () => {
  const stalled = { id: "n", kind: "job.stalled", title: "t", body: "b", createdAt: 1 };
  const base = {
    ...input(),
    notifications: [stalled, { ...stalled, id: "m", kind: "job.done" }],
  } as unknown as AssistantSnapshot;
  const gate = { emergencyStop: false, canCreateGoal: true };
  it("always adds holds and keeps stalled notifications", () => {
    const next = withJobHolds(
      { ...base, usage: { mode: "report" } } as unknown as AssistantSnapshot,
      gate,
    );
    expect(next.notifications).toHaveLength(2);
    expect(next.jobHolds).toEqual({ q: "budget" });
  });
});
