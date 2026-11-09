import { describe, expect, it } from "vitest";
import {
  type DockAgent,
  blockLifecycle,
  deriveActivityDock,
  dockCountLabel,
  dockStateLabel,
  isBackgroundOnly,
  nextUnseenDone,
  type ActivityDockInput,
} from "./activityDock";
import type { Block, Session } from "./session";
import { newSession } from "./session";
import { appendSteerUser, applyHarnessEvent } from "../../../integrations/harness/core/apply";

const user: Block = { id: "u1", role: "user", text: "go", startedAt: 1_000 };

function agent(id: string, status: string, patch: Partial<Block> = {}): Block {
  return {
    id,
    role: "tool",
    text: `Agent: ${id}`,
    tool: { callId: id, kind: "agent", status },
    agentRun: { name: `Review ${id}`, model: "claude-sonnet-5-5", steps: [] },
    ...patch,
  };
}

describe("dock agent timing", () => {
  it("carries the run's start and end, and omits them on old data", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("a", "completed", {
          agentRun: { name: "A", steps: [], startedAt: 5, endedAt: 9 },
        }),
        agent("b", "in_progress"),
      ],
    });
    expect(dock.agents[0]).toMatchObject({ startedAt: 5, endedAt: 9 });
    expect(dock.agents[1]).not.toHaveProperty("startedAt");
    expect(dock.agents[1]).not.toHaveProperty("endedAt");
  });
});

describe("stopped by the user", () => {
  it("is its own status, counted apart from done and failed", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("a", "completed"),
        agent("b", "failed"),
        agent("c", "stopped"),
        agent("d", "in_progress"),
      ],
    });
    expect(dock.agents.map((entry) => entry.status)).toEqual([
      "done",
      "failed",
      "stopped",
      "running",
    ]);
    expect(dock).toMatchObject({
      running: 1,
      finished: 1,
      failed: 1,
      stopped: 1,
    });
    expect(dockCountLabel(dock)).toBe("1 running · 1 done · 1 failed · 1 stopped");
  });

  it("words a stopped command and a stopped subagent the same way", () => {
    const dock = derive({
      busy: true,
      blocks: [user, agent("a", "stopped"), background("bg", "stopped")],
    });
    expect(dock.agents[0].detail).toBe("stopped by you");
    expect(dock.agents[1]).toMatchObject({
      kind: "command",
      status: "stopped",
      detail: "stopped by you",
    });
  });

  it("carries the call id a stop request is addressed with", () => {
    const dock = derive({
      busy: true,
      blocks: [user, agent("a1", "in_progress")],
    });
    expect(dock.agents[0].callId).toBe("a1");
  });
});

function background(id: string, status: string): Block {
  return {
    id,
    role: "tool",
    text: "npm run dev",
    tool: { callId: id, kind: "execute", status, background: true },
  };
}

function derive(patch: Partial<ActivityDockInput> = {}) {
  return deriveActivityDock({
    blocks: [user],
    busy: false,
    pendingQuestion: false,
    unseenDone: false,
    ...patch,
  });
}

describe("deriveActivityDock", () => {
  it("is working while the agent is at it", () => {
    const dock = derive({ busy: true });
    expect(dock.state).toBe("working");
    expect(dock.startedAt).toBe(1_000);
    expect(dockStateLabel(dock)).toBe("Working");
  });

  it("waits on background work once the agent has yielded", () => {
    const dock = derive({
      busy: true,
      backgroundTasks: ["dev server", "reviewer"],
      blocks: [user, agent("a1", "in_progress")],
    });
    expect(dock.state).toBe("waiting");
    expect(dockStateLabel(dock)).toBe("Waiting on 2 background tasks");
    expect(dockStateLabel(derive({ busy: true, backgroundTasks: ["x"] }))).toBe(
      "Waiting on 1 background task",
    );
  });

  it("tells subagents apart from commands when the provider can", () => {
    const mixed = derive({
      busy: true,
      backgroundTasks: ["dev server", "reviewer", "tester"],
      backgroundAgents: 2,
    });
    expect(mixed.state).toBe("waiting");
    expect(dockStateLabel(mixed)).toBe("Waiting on 2 background agents · 1 command running");
    expect(
      dockStateLabel(derive({ busy: true, backgroundTasks: ["reviewer"], backgroundAgents: 1 })),
    ).toBe("Waiting on 1 background agent");
  });

  it("reads as finished when only commands keep the turn open", () => {
    const dock = derive({
      busy: true,
      backgroundTasks: ["dev server"],
      backgroundAgents: 0,
    });
    expect(dock.state).toBe("background");
    expect(dockStateLabel(dock)).toBe("Finished · 1 background command running");
    expect(
      dockStateLabel(derive({ busy: true, backgroundTasks: ["a", "b"], backgroundAgents: 0 })),
    ).toBe("Finished · 2 background commands running");
  });

  it("never calls work finished when it cannot tell what is running", () => {
    expect(isBackgroundOnly(true, ["x"], undefined)).toBe(false);
    expect(isBackgroundOnly(true, ["x"], 1)).toBe(false);
    expect(isBackgroundOnly(true, [], 0)).toBe(false);
    expect(isBackgroundOnly(false, ["x"], 0)).toBe(false);
    expect(isBackgroundOnly(true, ["x"], 0)).toBe(true);
  });

  it("asks for input over anything else", () => {
    expect(derive({ busy: true, pendingQuestion: true, backgroundTasks: ["x"] }).state).toBe(
      "needs-input",
    );
    const approval: Block = {
      id: "p1",
      role: "approval",
      text: "rm -rf",
      approval: { requestId: 7 },
    };
    expect(derive({ busy: true, blocks: [user, approval] }).state).toBe("needs-input");
    expect(derive({ busy: true, pendingQuestion: true }).state).toBe("needs-input");
  });

  it("reports done after work, until the reader has looked", () => {
    expect(derive({ unseenDone: true }).state).toBe("done");
    expect(derive({ unseenDone: false }).state).toBe("idle");
  });

  it("does not call a stopped turn done", () => {
    const stopped: Block = {
      id: "s1",
      role: "system",
      text: "interrupted",
      notice: "interrupt",
    };
    expect(derive({ unseenDone: true, blocks: [user, stopped] }).state).toBe("idle");
  });

  it("counts running, finished and failed agents from the same rows", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("a1", "in_progress"),
        agent("a2", "completed"),
        agent("a3", "failed"),
        background("b1", "in_progress"),
      ],
    });
    expect(dock.agents.map((item) => [item.blockId, item.status])).toEqual([
      ["a1", "running"],
      ["a2", "done"],
      ["a3", "failed"],
      ["b1", "running"],
    ]);
    expect([dock.running, dock.finished, dock.failed]).toEqual([2, 1, 1]);
    expect(dockCountLabel(dock)).toBe("2 running · 1 done · 1 failed");
    expect(dock.agents[0]).toMatchObject({
      kind: "agent",
      name: "Review a1",
      // An id the catalog does not know is shown as reported.
      model: "claude-sonnet-5-5",
    });
    expect(dock.agents[3].kind).toBe("command");
  });

  it("words the step count the way the transcript row does", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("a1", "completed", {
          agentRun: {
            name: "Diff view",
            steps: [
              { id: "s1", kind: "tool", text: "Read", status: "completed" },
              { id: "s2", kind: "tool", text: "Edit", status: "failed" },
            ],
          },
        }),
      ],
    });
    expect(dock.agents[0].detail).toBe("2 steps, 1 failed");
  });

  it("does not leave a stale in-flight agent running once idle", () => {
    const dock = derive({
      unseenDone: true,
      blocks: [user, agent("a1", "in_progress")],
    });
    expect(dock.running).toBe(0);
    // Never reported as finished: its outcome is unknown, same as the sheet.
    expect(dock.agents[0].status).toBe("interrupted");
    expect(dock.interrupted).toBe(1);
    expect(dock.finished).toBe(0);
    expect(dockCountLabel(dock)).toBe("1 interrupted");
    expect(blockLifecycle(agent("a1", "in_progress"), false)).toBe("interrupted");
    expect(blockLifecycle(agent("a1", "in_progress"), true)).toBe("running");
  });

  it("keeps an explicitly interrupted child terminal while its siblings still run", () => {
    const dock = derive({
      busy: true,
      blocks: [user, agent("interrupted", "interrupted"), agent("running", "in_progress")],
    });
    expect(dock.agents.map((entry) => entry.status)).toEqual(["interrupted", "running"]);
    expect(dock).toMatchObject({ running: 1, interrupted: 1, finished: 0, stopped: 0 });
    expect(dock.agents[0].detail).toBe("Interrupted");
  });

  it("only looks at the latest turn", () => {
    const next: Block = { id: "u2", role: "user", text: "again", startedAt: 9 };
    const dock = derive({
      busy: true,
      blocks: [user, agent("a1", "completed"), next],
    });
    expect(dock.agents).toEqual([]);
    expect(dock.startedAt).toBe(9);
  });

  it("keeps running agents, commands and their original clock across repeated steers", () => {
    let session: Session = {
      ...newSession("codex", "/repo"),
      busy: true,
      blocks: [user, agent("a1", "in_progress"), background("b1", "in_progress")],
    };
    session = appendSteerUser(session, "Also check the API");
    session = appendSteerUser(session, "Keep the background command running");
    const dock = derive({ busy: session.busy, blocks: session.blocks });
    expect(dock.agents.map((entry) => [entry.callId, entry.status])).toEqual([
      ["a1", "running"],
      ["b1", "running"],
    ]);
    expect(dock.startedAt).toBe(user.startedAt);
    expect(dockCountLabel(dock)).toBe("2 running");

    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "a1",
      kind: "agent",
      status: "completed",
    });
    const updated = derive({ busy: session.busy, blocks: session.blocks });
    expect(updated.agents.map((entry) => entry.status)).toEqual(["done", "running"]);
    expect(updated.startedAt).toBe(user.startedAt);
  });

  it("follows chained continuations without including earlier executions", () => {
    const root: Block = { id: "root", role: "user", text: "start", startedAt: 2000 };
    const first: Block = { id: "first", role: "user", text: "follow up", continuationOf: "root" };
    const second: Block = { id: "second", role: "user", text: "again", continuationOf: "first" };
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("old", "completed"),
        root,
        agent("current", "in_progress"),
        first,
        second,
      ],
    });
    expect(dock.agents.map((entry) => entry.blockId)).toEqual(["current"]);
    expect(dock.startedAt).toBe(2000);
  });

  it("keeps internal work hidden and respects handoff boundaries", () => {
    const blocks: Block[] = [
      user,
      agent("old", "in_progress"),
      { id: "handoff", role: "handoff", text: "Switch provider" },
      agent("hidden", "in_progress", { internal: true }),
      agent("current", "in_progress"),
      { id: "steer", role: "user", text: "Continue", continuationOf: user.id },
    ];
    const dock = derive({ busy: true, blocks });
    expect(dock.agents.map((entry) => entry.blockId)).toEqual(["current"]);
    expect(dock.startedAt).toBeUndefined();
  });

  it("does not pull earlier runs into a continuation with a missing owner", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("old", "completed"),
        { id: "steer", role: "user", text: "Continue", continuationOf: "missing" },
        agent("current", "in_progress"),
      ],
    });
    expect(dock.agents.map((entry) => entry.blockId)).toEqual(["current"]);
  });

  it("does not let internal user messages replace the visible execution", () => {
    const dock = derive({
      busy: true,
      blocks: [
        user,
        agent("current", "in_progress"),
        { id: "internal", role: "user", text: "Internal work", internal: true },
      ],
    });
    expect(dock.agents.map((entry) => entry.blockId)).toEqual(["current"]);
    expect(dock.startedAt).toBe(user.startedAt);
  });

  it("has only the working line for a provider with no background tasks", () => {
    const dock = derive({
      busy: true,
      blocks: [user, { id: "t1", role: "tool", text: "ls" }],
    });
    expect(dock.state).toBe("working");
    expect(dock.agents).toEqual([]);
    expect(dockCountLabel(dock)).toBe("");
    expect(derive({ blocks: [user] }).state).toBe("idle");
  });

  it("ignores background tasks left over from a settled turn", () => {
    expect(derive({ backgroundTasks: ["x"] }).backgroundCount).toBe(0);
  });
});

describe("nextUnseenDone", () => {
  it("arms when work finishes", () => {
    expect(nextUnseenDone(false, true, false)).toBe(true);
  });

  it("stays quiet for a session that was idle from the start", () => {
    expect(nextUnseenDone(false, false, false)).toBe(false);
  });

  it("holds until cleared, and new work supersedes it", () => {
    expect(nextUnseenDone(true, false, false)).toBe(true);
    expect(nextUnseenDone(true, false, true)).toBe(false);
  });
});

describe("delegated child sessions in the dock", () => {
  const childRow = (patch: Partial<DockAgent> = {}): DockAgent => ({
    blockId: "delegated:c1",
    sessionId: "c1",
    name: "Check the parser",
    kind: "agent",
    status: "running",
    model: "GPT A",
    detail: "2 steps",
    ...patch,
  });

  it("merges child rows after the native rows and counts them", () => {
    const dock = derive({
      busy: true,
      blocks: [user, agent("a", "completed")],
      delegatedAgents: [
        childRow(),
        childRow({ blockId: "delegated:c2", sessionId: "c2", status: "failed" }),
      ],
    });
    expect(dock.agents.map((entry) => entry.sessionId)).toEqual([undefined, "c1", "c2"]);
    expect(dock).toMatchObject({ running: 1, failed: 1, finished: 1 });
  });

  it("stays in the background after the parent turn while a child still runs", () => {
    const dock = derive({ busy: false, blocks: [user], delegatedAgents: [childRow()] });
    expect(dock.state).toBe("background");
    expect(dock.backgroundCount).toBe(1);
    expect(dock.backgroundAgents).toBe(1);
    expect(dockStateLabel(dock)).toBe("Finished · 1 background agent running");
  });

  it("goes idle once the children have finished after the parent turn", () => {
    const dock = derive({
      busy: false,
      blocks: [user],
      delegatedAgents: [childRow({ status: "done" })],
    });
    expect(dock.state).toBe("idle");
    expect(dock.backgroundCount).toBe(0);
  });

  it("reports needs-input when a running child waits for approval", () => {
    const dock = derive({
      busy: false,
      blocks: [user],
      delegatedAgents: [childRow({ needsInput: true })],
    });
    expect(dock.state).toBe("needs-input");
  });

  it("does not report needs-input for a child that is no longer running", () => {
    const dock = derive({
      busy: false,
      blocks: [user],
      delegatedAgents: [childRow({ needsInput: true, status: "done" })],
    });
    expect(dock.state).toBe("idle");
  });

  it("counts a child as a working agent while the parent turn is still busy", () => {
    const dock = derive({
      busy: true,
      blocks: [user],
      delegatedAgents: [childRow()],
    });
    expect(dock.running).toBe(1);
    expect(dock.backgroundCount).toBe(0);
    expect(dock.state).toBe("working");
  });
});
