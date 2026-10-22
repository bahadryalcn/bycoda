import { describe, expect, it } from "vitest";
import { deriveActivityDock, type DockAgent } from "./activityDock";
import { canStopAgent, sessionHasBackgroundWork, stopAllControl } from "./backgroundStop";
import { newSession, type Block } from "./session";

const user: Block = { id: "u1", role: "user", text: "go", startedAt: 1_000 };

function agentBlock(id: string, status: string): Block {
  return {
    id: `b-${id}`,
    role: "tool",
    text: `Agent: ${id}`,
    tool: { callId: id, kind: "agent", status },
    agentRun: { name: id, steps: [] },
  };
}

function dockFor(
  blocks: Block[],
  patch: { busy?: boolean; backgroundTasks?: string[]; agents?: number } = {},
) {
  return deriveActivityDock({
    blocks,
    busy: patch.busy ?? true,
    pendingQuestion: false,
    backgroundTasks: patch.backgroundTasks,
    backgroundAgents: patch.agents,
    unseenDone: false,
  });
}

const row = (patch: Partial<DockAgent> = {}): DockAgent => ({
  blockId: "b1",
  callId: "c1",
  name: "Review",
  kind: "agent",
  status: "running",
  detail: "",
  ...patch,
});

describe("canStopAgent", () => {
  it("offers Stop only on a running row with a call, in a harness that can split it", () => {
    expect(canStopAgent(row(), true)).toBe(true);
    expect(canStopAgent(row(), false)).toBe(false);
    expect(canStopAgent(row({ status: "done" }), true)).toBe(false);
    expect(canStopAgent(row({ status: "stopped" }), true)).toBe(false);
    expect(canStopAgent(row({ callId: undefined }), true)).toBe(false);
  });
});

describe("stopAllControl", () => {
  const working = dockFor([user, agentBlock("a", "in_progress")]);

  it("stops the tasks and keeps the turn when the harness can stop one by one", () => {
    expect(stopAllControl(working, true)).toMatchObject({
      kind: "task",
      label: "Stop all background work",
    });
    expect(stopAllControl(working, true)?.title).toContain("not interrupted");
  });

  it("says plainly that it ends the turn when it cannot", () => {
    const control = stopAllControl(working, false);
    expect(control).toMatchObject({ kind: "turn", label: "Stop all" });
    expect(control?.title).toContain("Interrupt the whole turn");
  });

  it("counts background commands the transcript has no row for yet", () => {
    const waiting = dockFor([user], {
      backgroundTasks: ["npm run dev"],
      agents: 0,
    });
    expect(waiting.state).toBe("background");
    expect(stopAllControl(waiting, true)?.kind).toBe("task");
  });

  it("is absent when nothing is running, or the turn is over", () => {
    expect(stopAllControl(dockFor([user]), true)).toBeNull();
    expect(
      stopAllControl(dockFor([user, agentBlock("a", "in_progress")], { busy: false }), true),
    ).toBeNull();
  });

  it("settles to nothing once the last background task is stopped", () => {
    const before = dockFor([user], { backgroundTasks: ["dev"], agents: 0 });
    expect(before.state).toBe("background");
    // The adapter clears the list when Claude reports the task gone, and the
    // turn ends with it.
    const after = dockFor([user, agentBlock("a", "stopped")], { busy: false });
    expect(after.state).toBe("idle");
    expect(stopAllControl(after, true)).toBeNull();
  });
});

describe("sessionHasBackgroundWork", () => {
  it("needs a busy session with a running agent or a waited-on command", () => {
    const idle = { ...newSession("claude", "/repo"), blocks: [user] };
    expect(sessionHasBackgroundWork(idle)).toBe(false);
    expect(
      sessionHasBackgroundWork({
        ...idle,
        busy: true,
        blocks: [user, agentBlock("a", "in_progress")],
      }),
    ).toBe(true);
    expect(
      sessionHasBackgroundWork({
        ...idle,
        busy: true,
        backgroundTasks: ["dev"],
        backgroundAgents: 0,
      }),
    ).toBe(true);
    expect(
      sessionHasBackgroundWork({
        ...idle,
        busy: true,
        blocks: [user, agentBlock("a", "completed")],
      }),
    ).toBe(false);
  });
});
