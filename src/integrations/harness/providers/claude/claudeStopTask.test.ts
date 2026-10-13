import { describe, expect, it } from "vitest";
import {
  agentFallbackCallId,
  resolveStopTargets,
  settledTaskStatus,
  type StopTaskState,
} from "./claudeStopTask";

function state(patch: Partial<StopTaskState> = {}): StopTaskState {
  return {
    agentTasks: new Map(),
    backgroundTasks: new Map(),
    backgroundRows: new Map(),
    ...patch,
  };
}

describe("resolveStopTargets", () => {
  const running = state({
    agentTasks: new Map([
      ["t-agent", { toolUseId: "toolu_agent", description: "Review" }],
      ["t-early", { description: "Early agent" }],
    ]),
    backgroundTasks: new Map([
      ["t-agent", { toolUseId: "toolu_agent" }],
      ["t-early", {}],
      ["t-shell", { toolUseId: "toolu_bash" }],
      ["t-monitor", {}],
    ]),
    backgroundRows: new Map([
      ["t-shell", "background:t-shell"],
      ["t-monitor", "background:t-monitor"],
    ]),
  });

  it("finds a subagent by its Agent call", () => {
    expect(resolveStopTargets(running, "toolu_agent")).toEqual([
      { taskId: "t-agent", callIds: ["toolu_agent"] },
    ]);
  });

  it("finds a subagent whose task started before its call", () => {
    expect(resolveStopTargets(running, agentFallbackCallId("Early agent"))).toEqual([
      { taskId: "t-early", callIds: ["agent:Early agent"] },
    ]);
  });

  it("finds a command by its row, and answers for the Bash call too", () => {
    expect(resolveStopTargets(running, "background:t-shell")).toEqual([
      { taskId: "t-shell", callIds: ["toolu_bash", "background:t-shell"] },
    ]);
    expect(resolveStopTargets(running, "toolu_bash")[0].taskId).toBe("t-shell");
  });

  it("stops every task when no call is given", () => {
    expect(
      resolveStopTargets(running)
        .map((target) => target.taskId)
        .sort(),
    ).toEqual(["t-agent", "t-early", "t-monitor", "t-shell"]);
  });

  it("stops nothing for a call whose task already ended", () => {
    expect(resolveStopTargets(running, "toolu_gone")).toEqual([]);
    expect(resolveStopTargets(state())).toEqual([]);
  });
});

describe("settledTaskStatus", () => {
  it("reads killed and stopped as the user's only when they asked", () => {
    expect(settledTaskStatus("killed", true)).toBe("stopped");
    expect(settledTaskStatus("stopped", true)).toBe("stopped");
    expect(settledTaskStatus("killed", false)).toBe("killed");
  });

  it("leaves a task that finished first with its own outcome", () => {
    expect(settledTaskStatus("completed", true)).toBe("completed");
    expect(settledTaskStatus("failed", true)).toBe("failed");
  });
});
