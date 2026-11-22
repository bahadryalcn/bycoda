import { describe, expect, it } from "vitest";
import {
  formatLiveElapsed,
  formatLiveMinutes,
  liveAgentsFromSessions,
  isLiveActivityAgent,
  type LiveAgent,
  workingProjectPaths,
} from "./liveAgents";
import { newSession, type Block, type Session } from "./session";

function chat(cwd: string, patch: Partial<Session> = {}): Session {
  const session = newSession("claude", cwd);
  session.title = "claude · Fix the sidebar";
  session.blocks = [{ id: "u1", role: "user", text: "hello", startedAt: 1_000 }];
  return { ...session, ...patch, blocks: patch.blocks ?? session.blocks };
}

function edit(id: string, path = "src/App.tsx", status = "in_progress"): Block {
  const fileName = path.split("/").pop() ?? path;
  return {
    id,
    role: "tool",
    text: `Edited ${path}`,
    tool: {
      kind: "edit",
      title: `Edited ${path}`,
      status,
      preview: { kind: "write", path, fileName },
    },
  };
}

it("marks local and adopted host projects working and clears completed turns", () => {
  const local = chat("/local", { busy: true });
  const host = chat("/host", { continuingElsewhere: true });
  const hidden = chat("/worker", { busy: true, orchestrationLeadId: "lead" });
  const inbox = chat("/inbox", {
    busy: true,
    inboxAsk: {
      key: "issue",
      title: "Issue",
      url: "https://example.com/issue",
      provider: "github",
    },
  });
  const removed = chat("/removed", { busy: true, worktreeRemoved: true });
  const agents = liveAgentsFromSessions([local, local, host, hidden, inbox, removed]);
  expect(workingProjectPaths(agents)).toEqual(["/local", "/host"]);
  expect(workingProjectPaths(agents.map((agent) => ({ ...agent, needsApproval: true })))).toEqual(
    [],
  );
  expect(workingProjectPaths(agents.map((agent) => ({ ...agent, done: true })))).toEqual([]);
  expect(
    workingProjectPaths(
      liveAgentsFromSessions([
        { ...local, busy: false },
        { ...host, continuingElsewhere: false },
      ]),
    ),
  ).toEqual([]);
});

describe("liveAgentsFromSessions", () => {
  it("shows loaded remote turns and adopted turns with a conflicting local copy", () => {
    const remote = chat("remote://env/repo", { id: "remote", busy: true });
    const adopted = chat("/repo", {
      id: "adopted",
      continuingElsewhere: true,
      adoptedSyncConflict: true,
    });
    const agents = liveAgentsFromSessions([remote, adopted], new Set(["adopted"]));
    expect(agents.map((agent) => agent.id)).toEqual(["remote", "adopted"]);
    expect(agents[1]).toMatchObject({
      activity: "Working on host",
      done: false,
    });
    expect(liveAgentsFromSessions([{ ...adopted, continuingElsewhere: undefined }])).toEqual([]);
  });

  it("keeps internal workers in their lead's agent panel", () => {
    const lead = chat("/repo", { id: "lead", busy: true });
    const worker = chat("/repo", {
      id: "worker",
      busy: true,
      orchestrationLeadId: "lead",
    });
    expect(liveAgentsFromSessions([lead, worker]).map((agent) => agent.id)).toEqual(["lead"]);
  });
  it("skips idle sessions", () => {
    expect(liveAgentsFromSessions([chat("/tmp/a")])).toEqual([]);
  });

  it("maps a busy turn into a live agent", () => {
    const session = chat("/tmp/agent-terminal", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "hello", startedAt: 1_000 }, edit("t1")],
    });
    expect(liveAgentsFromSessions([session])).toEqual([
      {
        id: session.id,
        cwd: "/tmp/agent-terminal",
        title: "Fix the sidebar",
        harness: "claude",
        activity: "Edited src/App.tsx",
        startedAt: 1_000,
        durationMs: undefined,
        needsApproval: false,
        done: false,
      },
    ]);
  });

  it("puts sessions waiting on approval first", () => {
    const working = chat("/tmp/a", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 1_000 }, edit("t1")],
    });
    const waiting = chat("/tmp/b", {
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "go", startedAt: 2_000 },
        {
          id: "a1",
          role: "approval",
          text: "run rm",
          approval: { requestId: 1 },
        },
      ],
    });
    expect(liveAgentsFromSessions([working, waiting]).map((row) => row.id)).toEqual([
      waiting.id,
      working.id,
    ]);
    expect(liveAgentsFromSessions([working, waiting])[0]?.needsApproval).toBe(true);
    expect(liveAgentsFromSessions([working, waiting])[0]?.inputKind).toBe("approval");
  });

  it("keeps parked clarifying questions distinct from action approvals", () => {
    const waiting = chat("/tmp/ask", {
      busy: true,
      pendingQuestion: {
        requestId: 4,
        title: "Which file?",
        questions: [
          {
            id: "q1",
            prompt: "Which file?",
            multiSelect: false,
            allowCustom: true,
            options: [{ id: "a.ts", label: "a.ts" }],
          },
        ],
      },
    });
    expect(liveAgentsFromSessions([waiting])[0]).toMatchObject({
      id: waiting.id,
      activity: "Which file?",
      needsApproval: true,
      inputKind: "question",
      done: false,
    });
  });

  it("sorts working agents by longest-running turn first", () => {
    const newer = chat("/tmp/new", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 5_000 }],
    });
    const older = chat("/tmp/old", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 1_000 }],
    });
    expect(liveAgentsFromSessions([newer, older]).map((row) => row.cwd)).toEqual([
      "/tmp/old",
      "/tmp/new",
    ]);
  });

  it("keeps an unfocused finished session until it is seen", () => {
    const finished = chat("/tmp/done", {
      blocks: [
        {
          id: "u1",
          role: "user",
          text: "go",
          startedAt: 1_000,
          durationMs: 12_000,
        },
        edit("t1", "src/App.tsx", "completed"),
      ],
    });
    expect(liveAgentsFromSessions([finished])).toEqual([]);
    expect(liveAgentsFromSessions([finished], new Set([finished.id]))).toEqual([
      {
        id: finished.id,
        cwd: "/tmp/done",
        title: "Fix the sidebar",
        harness: "claude",
        activity: "Done",
        startedAt: 1_000,
        durationMs: 12_000,
        needsApproval: false,
        done: true,
      },
    ]);
  });

  it("keeps a working session above a finished one", () => {
    const working = chat("/tmp/a", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 5_000 }],
    });
    const finished = chat("/tmp/b", {
      blocks: [
        {
          id: "u1",
          role: "user",
          text: "go",
          startedAt: 1_000,
          durationMs: 8_000,
        },
      ],
    });
    expect(
      liveAgentsFromSessions([finished, working], new Set([finished.id])).map((row) => row.cwd),
    ).toEqual(["/tmp/a", "/tmp/b"]);
  });
});

it("keeps Activity for ongoing work and input", () => {
  const agent: LiveAgent = {
    id: "worker",
    cwd: "/project",
    title: "Build",
    harness: "codex",
    activity: "Working",
    done: false,
    needsApproval: false,
  };
  expect(isLiveActivityAgent(agent)).toBe(true);
  expect(isLiveActivityAgent({ ...agent, done: true })).toBe(false);
  expect(isLiveActivityAgent({ ...agent, issue: "failed" })).toBe(false);
  expect(isLiveActivityAgent({ ...agent, done: true, issue: "failed" })).toBe(false);
  expect(isLiveActivityAgent({ ...agent, issue: "retrying" })).toBe(true);
  expect(isLiveActivityAgent({ ...agent, needsApproval: true })).toBe(true);
  expect(isLiveActivityAgent({ ...agent, waiting: { kind: "commands", count: 1 } })).toBe(true);
});

describe("formatLiveMinutes", () => {
  it("shows whole minutes only", () => {
    expect(formatLiveMinutes(0, 0)).toBe("<1m");
    expect(formatLiveMinutes(5_000, 0)).toBe("<1m");
    expect(formatLiveMinutes(0, 59_999)).toBe("<1m");
    expect(formatLiveMinutes(0, 72_000)).toBe("1m");
    expect(formatLiveMinutes(0, 3_600_000)).toBe("1h");
    expect(formatLiveMinutes(0, 3_779_000)).toBe("1h 2m");
  });
});

describe("formatLiveElapsed", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatLiveElapsed(0, 1_000)).toBe("1s");
    expect(formatLiveElapsed(0, 38_000)).toBe("38s");
    expect(formatLiveElapsed(0, 72_000)).toBe("1m 12s");
    expect(formatLiveElapsed(0, 120_000)).toBe("2m");
    expect(formatLiveElapsed(0, 3_600_000)).toBe("1h");
    expect(formatLiveElapsed(0, 3_720_000)).toBe("1h 2m");
  });
});

describe("delegated child sessions", () => {
  const link = JSON.stringify({
    parentSessionId: "lead",
    runId: "run-1",
    kind: "advisor",
    model: "codex:gpt-a",
    startedAt: 1_000,
  });

  it("keeps a running delegated child out of the rail; its parent shows instead", () => {
    const parent = chat("/repo", { id: "lead", busy: true });
    const delegated = chat("/repo", {
      id: "child",
      busy: true,
      modelSettings: { delegationParent: link },
    });
    expect(liveAgentsFromSessions([parent, delegated]).map((agent) => agent.id)).toEqual(["lead"]);
  });

  it("keeps a failed or unseen-finished delegated child out of the rail too", () => {
    const delegated = chat("/repo", {
      id: "child",
      modelSettings: { delegationParent: link },
      usageLimit: {} as Session["usageLimit"],
    });
    expect(liveAgentsFromSessions([delegated], new Set(["child"]))).toEqual([]);
  });

  it("drops a malformed parent link, so the session stays an ordinary live agent", () => {
    const session = chat("/repo", {
      id: "odd",
      busy: true,
      modelSettings: { delegationParent: "{oops" },
    });
    expect(liveAgentsFromSessions([session]).map((agent) => agent.id)).toEqual(["odd"]);
  });
});

describe("waiting agents", () => {
  const link = JSON.stringify({
    parentSessionId: "parent",
    runId: "run-1",
    kind: "subagent",
    model: "codex:gpt-a",
    startedAt: 5,
  });

  it("counts a turn held open by its own commands or subagents as working", () => {
    for (const backgroundAgents of [0, 4]) {
      const held = chat("/repo", {
        busy: true,
        backgroundTasks: ["dev server"],
        backgroundAgents,
      });
      const [agent] = liveAgentsFromSessions([held]);
      expect(agent.waiting).toBeUndefined();
      expect(workingProjectPaths([agent])).toEqual(["/repo"]);
    }
  });

  it("keeps an idle parent with running delegated children in the rail", () => {
    const parent = chat("/repo", { id: "parent" });
    const child = chat("/repo", {
      id: "child",
      busy: true,
      modelSettings: { delegationParent: link },
    });
    const agents = liveAgentsFromSessions([parent, child]);
    expect(agents.map((agent) => agent.id)).toEqual(["parent"]);
    expect(agents[0].waiting).toMatchObject({
      kind: "delegated",
      count: 1,
      since: 5,
    });
    expect(liveAgentsFromSessions([parent])).toEqual([]);
  });

  it("orders waiting after working and before done, and never when input is needed", () => {
    const waiting = chat("/a", { id: "parent" });
    const child = chat("/a", {
      id: "child",
      busy: true,
      modelSettings: { delegationParent: link },
    });
    const working = chat("/b", { id: "k", busy: true });
    const finished = chat("/c", { id: "d" });
    const agents = liveAgentsFromSessions([finished, waiting, child, working], new Set(["d"]));
    expect(agents.map((agent) => agent.id)).toEqual(["k", "parent", "d"]);
    expect(agents[1].waiting?.kind).toBe("delegated");
    expect(agents[2].waiting).toBeUndefined();
  });
});
