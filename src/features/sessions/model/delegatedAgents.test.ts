// @vitest-environment happy-dom
import { rememberRemoteSession } from "../../connections/model/connections";
import { describe, expect, it } from "vitest";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
  type DelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import {
  delegatedAgentBlock,
  delegatedBlockId,
  delegatedChildren,
  delegatedDockAgents,
  crewMemberOf,
  delegationParentOf,
} from "./delegatedAgents";
import { deriveActivityDock } from "./activityDock";
import type { Block, Session } from "./session";
import { newSession } from "./session";

const PARENT = "parent-1";

function parentLink(patch: Partial<DelegationParent> = {}): string {
  const link: DelegationParent = {
    parentSessionId: PARENT,
    runId: "run-1",
    kind: "subagent",
    model: "codex:gpt-a",
    startedAt: 2_000,
    ...patch,
  };
  return JSON.stringify(link);
}

function child(id: string, patch: Partial<Session> = {}, link: Partial<DelegationParent> = {}) {
  const session = newSession("codex", "/repo", "codex:gpt-a");
  return {
    ...session,
    id,
    title: `Subagent · ${id}`,
    modelSettings: { ...session.modelSettings, [DELEGATION_PARENT_KEY]: parentLink(link) },
    blocks: [] as Block[],
    ...patch,
  } satisfies Session;
}

const brief: Block = { id: "b-user", role: "user", text: "Fix the parser.", startedAt: 2_100 };

function toolStep(id: string, status = "completed"): Block {
  return {
    id,
    role: "tool",
    text: `Read ${id}`,
    tool: { callId: id, kind: "read", status },
  };
}

function finished(id: string, blocks: Block[], extra: Partial<Session> = {}): Session {
  return child(id, { blocks: [brief, ...blocks], busy: false, ...extra });
}

describe("delegationParentOf", () => {
  it("decodes the parent link the Host wrote", () => {
    expect(delegationParentOf(child("c1"))).toMatchObject({
      parentSessionId: PARENT,
      runId: "run-1",
      kind: "subagent",
    });
  });

  it("is undefined for an ordinary session", () => {
    expect(delegationParentOf(newSession("codex", "/repo"))).toBeUndefined();
  });

  it("is undefined for a malformed link instead of throwing", () => {
    const session = child("c1", {
      modelSettings: { [DELEGATION_PARENT_KEY]: "{oops" },
    });
    expect(delegationParentOf(session)).toBeUndefined();
  });
});

describe("delegatedChildren", () => {
  it("returns only the children of the given parent, oldest first", () => {
    const late = child("late", {}, { startedAt: 5_000 });
    const early = child("early", {}, { startedAt: 3_000 });
    const other = child("other", {}, { parentSessionId: "parent-2" });
    const plain = newSession("codex", "/repo");
    const ids = delegatedChildren([late, plain, other, early], PARENT).map((session) => session.id);
    expect(ids).toEqual(["early", "late"]);
  });
});

describe("delegatedDockAgents", () => {
  it("keeps the running child's provider and account instead of the parent's identity", () => {
    const running = child("identity", {
      harness: "claude",
      providerAccountId: "personal",
      runningModelTarget: {
        harness: "grok",
        model: "grok:grok-4",
        modelSettings: {},
        providerAccountId: "work",
      },
      busy: true,
    });
    expect(delegatedDockAgents([running], 1_000)[0]).toMatchObject({
      harness: "grok",
      providerAccountId: "work",
    });
  });
  it("maps a running child to a running agent row that opens the child", () => {
    const running = child("c1", { busy: true, blocks: [brief, toolStep("t1")] });
    const [row] = delegatedDockAgents([running], 1_000);
    expect(row).toMatchObject({
      blockId: delegatedBlockId("c1"),
      sessionId: "c1",
      kind: "agent",
      status: "running",
    });
    expect(row.detailParts?.map((part) => part.text)).toEqual(["1 step"]);
  });

  it("names a run by its task, not by a repeated model label", () => {
    const task = { ...brief, text: "You are a subagent.\n\nTask:\nHost child discovery\n\nDo it." };
    const legacy = child("c1", { title: "Subagent · GPT-6.1 Terra", blocks: [task] });
    expect(delegatedDockAgents([legacy], 1_000)[0]?.name).toBe("Host child discovery");
    const titled = child("c2", { title: "Parser v2.1 fix", blocks: [task] });
    expect(delegatedDockAgents([titled], 1_000)[0]?.name).toBe("Parser v2.1 fix");
  });

  it("maps a finished child to done with steps counted", () => {
    const done = finished("c2", [toolStep("t1"), toolStep("t2")]);
    const [row] = delegatedDockAgents([done], 1_000);
    expect(row.status).toBe("done");
    expect(row.detailParts?.map((part) => part.text)).toEqual(["2 steps"]);
  });

  it("counts a failed step in the failed part", () => {
    const failedStep = toolStep("t2", "failed");
    const done = finished("c3", [toolStep("t1"), failedStep]);
    const [row] = delegatedDockAgents([done], 1_000);
    expect(row.detail).toContain("failed");
  });

  it("maps a child whose last turn errored to failed", () => {
    const broken = finished("c4", [], { usageLimit: {} as Session["usageLimit"] });
    const [row] = delegatedDockAgents([broken], 1_000);
    expect(row.status).toBe("failed");
  });

  it("maps a child whose run was stopped to stopped", () => {
    const stopped = finished("c5", [
      {
        id: "s",
        role: "tool",
        text: "stopped",
        tool: { callId: "s", kind: "agent", status: "stopped" },
      },
    ]);
    const [row] = delegatedDockAgents([stopped], 1_000);
    expect(row.status).toBe("stopped");
  });

  it("keeps finished children available after later turns", () => {
    const old = finished("old", [], {}); // started at 2_000, turn started later
    const oldRunning = child("old-run", { busy: true }, { startedAt: 500 });
    const rows = delegatedDockAgents([old, oldRunning], 9_000);
    expect(rows.map((row) => row.sessionId)).toEqual(["old", "old-run"]);
  });

  it("shows every child when no turn is known", () => {
    const old = finished("old", []);
    expect(delegatedDockAgents([old], undefined)).toHaveLength(1);
  });
});

describe("delegatedAgentBlock", () => {
  it("is a subagent tool block whose run carries the name, model, brief and steps", () => {
    const session = finished("c6", [
      toolStep("t1"),
      { id: "m1", role: "assistant", text: "Parser fixed." },
    ]);
    const block = delegatedAgentBlock(session);
    expect(block.id).toBe(delegatedBlockId("c6"));
    expect(block.tool).toMatchObject({ kind: "subagent" });
    expect(block.agentRun).toMatchObject({
      prompt: "Fix the parser.",
      steps: [
        { kind: "tool", text: expect.any(String) },
        { kind: "message", text: "Parser fixed." },
      ],
    });
    expect(block.agentRun?.model).toBe(session.model);
  });

  it("skips internal blocks and empty assistant text", () => {
    const session = finished("c7", [
      { id: "i", role: "assistant", text: "hidden", internal: true },
      { id: "e", role: "assistant", text: "   " },
    ]);
    expect(delegatedAgentBlock(session).agentRun?.steps).toEqual([]);
  });

  it("reports running while busy and completed once finished", () => {
    expect(delegatedAgentBlock(child("c8", { busy: true, blocks: [brief] })).tool?.status).toBe(
      "running",
    );
    expect(delegatedAgentBlock(finished("c9", [])).tool?.status).toBe("completed");
  });
});

describe("merging with the parent's activity dock", () => {
  it("adds children as dock agents beside the parent's native rows", () => {
    const parentUser: Block = { id: "u", role: "user", text: "go", startedAt: 1_000 };
    const native: Block = {
      id: "n",
      role: "tool",
      text: "Agent: native",
      tool: { callId: "n", kind: "agent", status: "completed" },
      agentRun: { name: "Native", steps: [] },
    };
    const children = [finished("c10", [toolStep("t")])];
    const dock = deriveActivityDock({
      blocks: [parentUser, native],
      busy: false,
      pendingQuestion: false,
      unseenDone: false,
      delegatedAgents: delegatedDockAgents(children, 1_000),
    });
    expect(dock.agents.map((agent) => agent.sessionId)).toEqual([undefined, "c10"]);
    expect(dock.finished).toBe(2);
  });

  it("keeps the dock in the background after the parent turn while a child still runs", () => {
    const parentUser: Block = { id: "u", role: "user", text: "go", startedAt: 1_000 };
    const dock = deriveActivityDock({
      blocks: [parentUser],
      busy: false,
      pendingQuestion: false,
      unseenDone: false,
      delegatedAgents: delegatedDockAgents([child("c11", { busy: true })], 1_000),
    });
    expect(dock.state).toBe("background");
    expect(dock.running).toBe(1);
  });

  it("shows needs-input on the parent when a running child waits for approval", () => {
    const parentUser: Block = { id: "u", role: "user", text: "go", startedAt: 1_000 };
    const waiting = child("c12", {
      busy: true,
      pendingQuestion: { id: "q", text: "Allow?" } as unknown as Session["pendingQuestion"],
    });
    const rows = delegatedDockAgents([waiting], 1_000);
    expect(rows[0].needsInput).toBe(true);
    const dock = deriveActivityDock({
      blocks: [parentUser],
      busy: false,
      pendingQuestion: false,
      unseenDone: false,
      delegatedAgents: rows,
    });
    expect(dock.state).toBe("needs-input");
  });
});

it("matches bound child only to the parent shell of the same Host and project", () => {
  const binding = {
    kind: "local-host" as const,
    machineId: "machine",
    environmentId: "env",
    projectId: "project",
    sessionId: "host-parent",
    authorityGeneration: null,
    created: true,
  };
  const parent = { ...newSession("codex", "/repo"), id: "shell-parent", hostBinding: binding };
  const run = child(
    "host-child",
    { hostBinding: { ...binding, sessionId: "host-child" } },
    { parentSessionId: "host-parent" },
  );
  expect(delegatedChildren([parent, run], parent.id).map((item) => item.id)).toEqual([run.id]);
  expect(
    delegatedChildren(
      [{ ...parent, hostBinding: { ...binding, environmentId: "different" } }, run],
      parent.id,
    ),
  ).toEqual([]);
  expect(delegatedChildren([{ ...parent, id: "host-parent" }, run], "host-parent")).toHaveLength(1);
});

it("groups verified remote children under their mapped parent shell", () => {
  const cwd = "remote://environment/repo";
  const parent = { ...newSession("codex", cwd), id: "remote-parent-shell" };
  const run = child("remote-child-shell", { cwd }, { parentSessionId: "remote-parent-canonical" });
  rememberRemoteSession(parent.id, "remote-parent-canonical");
  rememberRemoteSession(run.id, "remote-child-canonical");
  try {
    expect(delegatedChildren([parent, run], parent.id)).toEqual([run]);
    expect(delegatedChildren([{ ...parent, cwd: "remote://other/repo" }, run], parent.id)).toEqual(
      [],
    );
    rememberRemoteSession(run.id);
    expect(delegatedChildren([parent, run], parent.id)).toEqual([]);
  } finally {
    rememberRemoteSession(parent.id);
    rememberRemoteSession(run.id);
  }
});

describe("crew member children", () => {
  const member = { id: "m1", name: "Ada Reviewer", handle: "ada", sourceId: "src-1" };
  const asMember = (id: string) =>
    finished(id, [], {
      title: "Review the parser",
      modelSettings: {
        [DELEGATION_PARENT_KEY]: parentLink(),
        [CREW_MEMBER_KEY]: JSON.stringify(member),
      },
    });

  it("decodes the member identity and ignores a malformed value", () => {
    expect(crewMemberOf(asMember("c1"))).toMatchObject(member);
    expect(crewMemberOf(child("c2"))).toBeUndefined();
    expect(
      crewMemberOf(child("c3", { modelSettings: { [CREW_MEMBER_KEY]: "{oops" } })),
    ).toBeUndefined();
  });

  it("names the card and dock row for the member, with the handle as agent type", () => {
    const block = delegatedAgentBlock(asMember("c1"));
    expect(block.agentRun).toMatchObject({ name: "Ada Reviewer", agentType: "@ada" });
    expect(block.tool?.kind).toBe("subagent");
    const [row] = delegatedDockAgents([asMember("c1")], undefined);
    expect(row).toMatchObject({ name: "Ada Reviewer", crewMember: member, kind: "agent" });
  });

  it("leaves ordinary delegated children unchanged", () => {
    const [row] = delegatedDockAgents([finished("c4", [])], undefined);
    expect(row.crewMember).toBeUndefined();
  });
});
