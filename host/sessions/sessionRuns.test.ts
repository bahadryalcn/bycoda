import { expect, it } from "vitest";
import type { HostStore } from "../store";
import { sessionRunState } from "./sessionRuns";
import { isSessionRunActivity } from "./session-run-activity";

it("never treats polls, metadata writes or another run's activity as observed output", async () => {
  const record = {
    status: "running",
    runId: "current",
    updatedAt: 999_999,
    session: { blocks: [] },
    runActivity: undefined as { runId: string; lastActivityAt: number } | undefined,
  };
  const store = { session: async () => record } as unknown as HostStore;
  const run = { sessionId: "s", runId: "current", startedAt: 100 };
  for (const activity of [
    undefined,
    { runId: "old", lastActivityAt: 200 },
    { runId: "current", lastActivityAt: 99 },
    { runId: "current", lastActivityAt: 1001 },
    { runId: "current", lastActivityAt: NaN },
  ]) {
    record.runActivity = activity;
    expect(await sessionRunState(store, run, 0, 1000)).toEqual({
      state: "running",
      needsInput: false,
    });
  }
  record.runActivity = { runId: "current", lastActivityAt: 200 };
  expect(await sessionRunState(store, run, 0, 1000)).toMatchObject({ lastActivityAt: 200 });
});
it("counts actual repeated output but excludes telemetry and periodic background snapshots", () => {
  expect(
    isSessionRunActivity({ type: "tool.updated", callId: "shell", detail: "still working" }, false),
  ).toBe(true);
  expect(isSessionRunActivity({ type: "message.delta", text: "same" }, false)).toBe(true);
  expect(isSessionRunActivity({ type: "message.delta", text: "" }, false)).toBe(false);
  expect(isSessionRunActivity({ type: "context", used: 1000 }, true)).toBe(false);
  expect(isSessionRunActivity({ type: "background.updated", tasks: ["shell"] }, true)).toBe(false);
  expect(isSessionRunActivity({ type: "status", text: "working" }, true)).toBe(false);
  expect(
    isSessionRunActivity({ type: "tool.updated", callId: "shell", status: "running" }, false),
  ).toBe(false);
});
