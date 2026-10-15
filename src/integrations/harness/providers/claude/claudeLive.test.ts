import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyHarnessEvent } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";
import {
  foldableWork,
  foldedBlocks,
  groupTurnItems,
  workSummaryLine,
} from "../../../../features/sessions/model/transcriptActivity";

const sent: string[] = [];
const spawned: string[][] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code?: number | null) => void) | undefined;
let onStderr: ((line: string) => void) | undefined;
const spawnChild = vi.fn(async (_id: string, _path: string, args: string[]) => {
  spawned.push(args);
});
const writeChild = vi.fn(async (_id: string, line: string) => {
  sent.push(line);
});
const readHarnessTaskOutput = vi.fn(async () => ({ text: "live output\n", truncated: false }));

vi.mock("../../core/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (l: string) => void,
    exit: (code?: number | null) => void,
    stderr?: (line: string) => void,
  ) => {
    onLine = line;
    onExit = exit;
    onStderr = stderr;
  },
  writeChild,
  readHarnessTaskOutput,
}));

const {
  bindClaudeSession,
  cancelClaudeTurn,
  compactClaudeContext,
  respondClaudeApproval,
  respondClaudeQuestion,
  restoreClaudeTaskLists,
  sendClaudeTurn,
  replayClaudeSession,
  stopClaudeBackgroundWork,
  stopClaudeSession,
  __claudeTestReset,
} = await import("./claude");
// Imports `claude.ts`, so it has to be loaded after the child mock like the rest.
const { buildImportedSession } =
  await import("../../../../features/sessions/model/claudeSessionImport");
import type { HarnessEvent } from "../../core/types";
import type { RuntimeMode, TurnIntent } from "../../../../features/sessions/model/session";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function emit(rec: Record<string, unknown>) {
  onLine!(JSON.stringify(rec));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}; sent=${JSON.stringify(parse())}`);
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    providerAccountId?: string;
    modelSettings?: Record<string, string>;
  } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: options.modelSettings ?? {},
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    providerAccountId: options.providerAccountId,
    text: "explore the codebase",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () =>
      parse().some((m) => {
        const request = m.request as Record<string, unknown> | undefined;
        return request?.subtype === "initialize";
      }),
    "initialize",
  );
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: "bycoda_1" },
  });
  await waitFor(() => parse().some((m) => m.type === "user"), "user prompt");
  return { events, turn };
}

/** What Claude streams when a finished task wakes it for another turn. */
function emitFollowUpTurn(text: string) {
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "stream_event",
    session_id: "sess_1",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  });
  emit({
    type: "assistant",
    session_id: "sess_1",
    message: { content: [{ type: "text", text }] },
  });
  emit({ type: "result", subtype: "success", session_id: "sess_1" });
}

/** A subagent Claude ran inline: its report comes back on the parent's stream. */
function emitInlineSubagent(taskId = "t1") {
  emit({
    type: "assistant",
    session_id: "sess_1",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_agent",
          name: "Task",
          input: {
            description: "Explore the auth module",
            subagent_type: "explore",
          },
        },
      ],
    },
  });
  emit({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: "toolu_agent",
    description: "Explore the auth module",
    task_type: "local_agent",
  });
  emit({
    type: "user",
    session_id: "sess_1",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_agent",
          content: "Auth lives in src/auth.",
        },
      ],
    },
  });
}

function emitBackgroundBash(taskId = "b1") {
  emit({
    type: "assistant",
    session_id: "sess_1",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_bash",
          name: "Bash",
          input: { command: "sleep 30 && echo done", run_in_background: true },
        },
      ],
    },
  });
  emit({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [
      {
        task_id: taskId,
        task_type: "local_bash",
        description: "Wait 30 seconds then print done",
      },
    ],
  });
  emit({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: "toolu_bash",
    description: "Wait 30 seconds then print done",
    task_type: "local_bash",
  });
  emit({
    type: "user",
    session_id: "sess_1",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_bash",
          content: `Command running in background with ID: ${taskId}`,
        },
      ],
    },
  });
  emit({
    type: "stream_event",
    session_id: "sess_1",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "waiting" },
    },
  });
  emit({
    type: "assistant",
    session_id: "sess_1",
    message: { content: [{ type: "text", text: "waiting" }] },
  });
  emit({ type: "result", subtype: "success", session_id: "sess_1" });
}

function emitBashFinished(taskId = "b1") {
  emit({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  emit({
    type: "system",
    subtype: "task_updated",
    task_id: taskId,
    patch: { status: "completed" },
  });
  emit({
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    tool_use_id: "toolu_bash",
    status: "completed",
    summary: 'Background command "sleep 30 && echo done" completed (exit code 0)',
  });
}

function backgroundUpdates(events: HarnessEvent[]): string[][] {
  return events.flatMap((event) => (event.type === "background.updated" ? [event.tasks] : []));
}

beforeEach(() => {
  sent.length = 0;
  spawned.length = 0;
  onLine = undefined;
  onExit = undefined;
  onStderr = undefined;
  spawnChild.mockClear();
  writeChild.mockClear();
  __claudeTestReset();
});

afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("claude streamed tool inputs", () => {
  it("launches the selected advisor and rebinds when it is disabled", async () => {
    const first = await startTurn("advisor-session", {
      modelSettings: { advisor: "opus", subagentModel: "haiku", subagentPolicy: "force" },
    });
    expect(spawned[0]).toContain("--advisor");
    expect(spawned[0][spawned[0].indexOf("--advisor") + 1]).toBe("opus");
    expect(JSON.parse(spawned[0][spawned[0].indexOf("--settings") + 1]).env).toMatchObject({
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    sent.length = 0;
    const second = await startTurn("advisor-session", { modelSettings: { advisor: "off" } });
    expect(spawned).toHaveLength(2);
    const args = spawned[1];
    expect(
      JSON.parse(args[args.indexOf("--settings") + 1]).env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL,
    ).toBe("1");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second.turn;
  });
  it("replaces an empty Shell row with the complete assistant tool input", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "stream_event",
      session_id: "sess_1",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_shell",
          name: "Bash",
          input: {},
        },
      },
    });
    emit({
      type: "stream_event",
      session_id: "sess_1",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"command":"git status',
        },
      },
    });
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_shell",
            name: "Bash",
            input: {
              command: "git status --short",
              description: "Check changes",
            },
          },
        ],
      },
    });
    emit({
      type: "user",
      session_id: "sess_1",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_shell", content: "clean" }],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.updated",
        callId: "toolu_shell",
        title: "git status --short",
        status: "pending",
      }),
    );
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const tool = session.blocks.find((block) => block.tool?.callId === "toolu_shell");
    expect(tool?.text).toBe("git status --short");
    expect(tool?.tool?.status).toBe("completed");
  });

  it("settles a server-side advisor call from its assistant result block", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "stream_event",
      session_id: "sess_1",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", id: "srvtoolu_adv", name: "advisor", input: {} },
      },
    });
    const pending = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const open = pending.blocks.find((block) => block.tool?.callId === "srvtoolu_adv");
    expect(open?.tool?.kind).toBe("advisor");
    expect(open?.streaming).toBe(true);
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          { type: "server_tool_use", id: "srvtoolu_adv", name: "advisor", input: {} },
          {
            type: "advisor_tool_result",
            tool_use_id: "srvtoolu_adv",
            content: { type: "advisor_result", text: "Looks fine" },
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const tool = session.blocks.find((block) => block.tool?.callId === "srvtoolu_adv");
    expect(tool?.tool?.status).toBe("completed");
    expect(tool?.streaming).toBeFalsy();
  });
});

describe("claude task tools", () => {
  function emitTaskTool(
    id: string,
    name: string,
    input: Record<string, unknown>,
    result: string,
    providerSessionId = "sess_1",
  ) {
    emit({
      type: "assistant",
      session_id: providerSessionId,
      message: { content: [{ type: "tool_use", id, name, input }] },
    });
    emit({
      type: "user",
      session_id: providerSessionId,
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: result }],
      },
    });
  }

  it("builds the task list from TaskCreate and TaskUpdate, not subagent rows", async () => {
    const { events, turn } = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it", description: "Open the PR" },
      "Task #2 created successfully: Ship it",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "in_progress" },
      "Updated task #1 status",
    );
    emitTaskTool(
      "toolu_u2",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const lists = session.blocks.filter((block) => block.role === "tasks");
    expect(lists).toHaveLength(1);
    expect(lists[0].taskList?.items).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
      { id: "2", text: "Ship it", status: "pending" },
    ]);
    expect(
      session.blocks.some((block) => block.tool?.kind === "agent" || block.agent !== undefined),
    ).toBe(false);
  });

  it("keeps earlier tasks updatable after a restart resumes the conversation", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [...first.events];
    const userCount = parse().filter((message) => message.type === "user").length;
    const second = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:opus-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "finish it",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(() => spawned.length === 2, "replacement Claude process");
    expect(spawned[1]).toEqual(expect.arrayContaining(["--resume", "sess_1"]));
    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const lists = session.blocks.filter((block) => block.role === "tasks");
    expect(lists.at(-1)?.taskList?.items).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
    ]);
  });

  /** A later turn that must launch a new Claude process. */
  async function restartedTurn(
    events: HarnessEvent[],
    options: {
      intent?: TurnIntent;
      providerAccountId?: string;
      providerSessionId?: string;
    } = {},
  ) {
    const spawnCount = spawned.length;
    const userCount = parse().filter((message) => message.type === "user").length;
    const turn = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      intent: options.intent,
      providerAccountId: options.providerAccountId,
      text: "finish it",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(() => spawned.length === spawnCount + 1, "replacement Claude process");
    emit({
      type: "system",
      subtype: "init",
      session_id: options.providerSessionId ?? "sess_1",
    });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    return { turn };
  }

  function lastTaskItems(events: HarnessEvent[]) {
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    return session.blocks.filter((block) => block.role === "tasks").at(-1)?.taskList?.items;
  }

  it("shows a TaskUpdate subject rename in the panel", async () => {
    const { events, turn } = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", subject: "Write parser tests", status: "in_progress" },
      "Updated task #1 subject, status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write parser tests", status: "in_progress" },
    ]);
  });

  it("keeps earlier tasks across a plan to build restart", async () => {
    const first = await startTurn("s1", { intent: "plan" });
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events, { intent: "build" });
    expect(spawned[1]).toEqual(expect.arrayContaining(["--resume", "sess_1"]));
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([{ id: "1", text: "Write tests", status: "completed" }]);
  });

  it("keeps earlier tasks after the Claude child exits", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    onExit!(1);

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events);
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([{ id: "1", text: "Write tests", status: "completed" }]);
  });

  it("rehydrates tasks from the persisted panel after an app restart", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it" },
      "Task #2 created successfully: Ship it",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    const restored = first.events.reduce(applyHarnessEvent, newSession("claude", "/repo"));

    // App restart: all module state is gone; only the saved transcript remains.
    await stopClaudeSession("s1");
    __claudeTestReset();
    bindClaudeSession("s1", "sess_1", "/repo");
    restoreClaudeTaskLists(
      "s1",
      restored.blocks.flatMap((block) => (block.taskList ? [block.taskList] : [])),
    );

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events);
    expect(spawned.at(-1)).toEqual(expect.arrayContaining(["--resume", "sess_1"]));
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emitTaskTool(
      "toolu_c3",
      "TaskCreate",
      { subject: "Tag release" },
      "Task #3 created successfully: Tag release",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
      { id: "2", text: "Ship it", status: "pending" },
      { id: "3", text: "Tag release", status: "pending" },
    ]);
  });

  /** Conversation A: tasks #1 and #2 in sess_1, reduced like the saved transcript. */
  async function conversationWithTasks() {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it" },
      "Task #2 created successfully: Ship it",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    return first.events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
  }

  /** Conversation B updates A's #1, then creates its own #1. */
  function emitConversationB() {
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
      "sess_2",
    );
    emitTaskTool(
      "toolu_c3",
      "TaskCreate",
      { subject: "Fresh task" },
      "Task #1 created successfully: Fresh task",
      "sess_2",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_2" });
  }

  it("rehydrates the bound conversation's panel past a later conversation's panel", async () => {
    const restored = await conversationWithTasks();
    const lists = [
      ...restored.blocks.flatMap((block) => (block.taskList ? [block.taskList] : [])),
      {
        key: "claude-tasks",
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Other conversation", status: "pending" as const }],
      },
    ];

    await stopClaudeSession("s1");
    __claudeTestReset();
    bindClaudeSession("s1", "sess_1", "/repo");
    restoreClaudeTaskLists("s1", lists);

    const events: HarnessEvent[] = [];
    const { turn } = await restartedTurn(events);
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "2", status: "completed" },
      "Updated task #2 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "pending" },
      { id: "2", text: "Ship it", status: "completed" },
    ]);
  });

  it("does not carry tasks to another conversation bound to the same thread", async () => {
    const restored = await conversationWithTasks();
    expect(
      restored.blocks.find((block) => block.role === "tasks")?.taskList?.providerSessionId,
    ).toBe("sess_1");

    await stopClaudeSession("s1");
    bindClaudeSession("s1", "sess_2", "/repo");
    restoreClaudeTaskLists(
      "s1",
      restored.blocks.flatMap((block) => (block.taskList ? [block.taskList] : [])),
    );

    const events: HarnessEvent[] = [];
    const { turn } = await restartedTurn(events, { providerSessionId: "sess_2" });
    expect(spawned.at(-1)).toEqual(expect.arrayContaining(["--resume", "sess_2"]));
    emitConversationB();
    await turn;

    const updates = events.filter((event) => event.type === "tasks.updated");
    expect(updates).toEqual([
      expect.objectContaining({
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Fresh task", status: "pending" }],
      }),
    ]);
  });

  it("starts a clean task map when Claude reports a different conversation", async () => {
    await conversationWithTasks();

    const events: HarnessEvent[] = [];
    const turn = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "keep going",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > 1,
      "follow-up prompt",
    );
    emitConversationB();
    await turn;

    expect(events.filter((event) => event.type === "tasks.updated").at(-1)).toEqual(
      expect.objectContaining({
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Fresh task", status: "pending" }],
      }),
    );
  });

  it("drops the task map when the conversation cannot resume", async () => {
    const first = await startTurn("s1", { providerAccountId: "work" });
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [];
    const { turn: second } = await restartedTurn(events, { providerAccountId: "home" });
    expect(spawned.at(-1)).not.toContain("--resume");
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(events.some((event) => event.type === "tasks.updated")).toBe(false);
  });
});

describe("claude assistant message boundaries", () => {
  it("keeps a follow-up paragraph separate and does not replay its snapshot", async () => {
    const { events, turn } = await startTurn("s1");
    const progress = "- update the notes and commit";
    const update =
      "Connect returned an empty file for one image on one post. The catch-up skips it and carries on, and I'll include it in the final tally.";
    for (const text of [progress, update]) {
      emit({
        type: "stream_event",
        session_id: "sess_1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
      });
      emit({
        type: "assistant",
        session_id: "sess_1",
        message: { content: [{ type: "text", text }] },
      });
    }
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(session.blocks.map((block) => block.text)).toEqual([progress, update]);
    expect(events.filter((event) => event.type === "message.delta")).toEqual([
      { type: "message.delta", text: progress },
      { type: "message.delta", text: update },
    ]);
  });
});

describe("claude model switching", () => {
  it("restarts a named account with the new model while resuming the provider conversation", async () => {
    const first = await startTurn("s1", {
      providerAccountId: "account-work",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const userCount = parse().filter((message) => message.type === "user").length;
    const second = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:opus-5",
      modelSettings: {},
      runtimeMode: "supervised",
      providerAccountId: "account-work",
      text: "what did I ask before?",
      attachments: [],
      onEvent: () => undefined,
    });

    await waitFor(() => spawned.length === 2, "replacement Claude process");
    expect(spawned[1]).toEqual(
      expect.arrayContaining(["--model", "claude-opus-5", "--resume", "sess_1"]),
    );
    expect(spawned[1]).not.toContain("--session-id");

    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;
  });
});

describe("claude startup failures", () => {
  function send(events: HarnessEvent[]) {
    return sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "hello",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
  }

  it("yanıtsız Claude init reddedilir ve yeniden başlangıç temiz kalır", async () => {
    vi.useFakeTimers();
    try {
      const events: HarnessEvent[] = [];
      const outcome = send(events).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(8_001);
      expect(await outcome).toContain("initialize response timed out");
      expect(events.some((event) => event.type === "session.started")).toBe(false);
      expect(parse().some((message) => message.type === "user")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const retry = await startTurn("s1");
    expect(spawned).toHaveLength(2);
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await retry.turn;
  });

  it("rejects an exit during initialization without sending the user prompt", async () => {
    const events: HarnessEvent[] = [];
    const turn = send(events);
    const failed = expect(turn).rejects.toThrow("Claude Code exited");
    await waitFor(() => sent.length > 0, "initialize");
    onExit!(1);
    await failed;
    expect(parse().some((m) => m.type === "user")).toBe(false);
    expect(events.some((e) => e.type === "session.started")).toBe(false);
    expect(events.some((e) => e.type === "session.providerBound")).toBe(false);

    const retry = await startTurn("s1");
    expect(spawned[1]).not.toContain("--resume");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await retry.turn;
  });

  it("preserves the missing-conversation error and existing resume binding", async () => {
    bindClaudeSession("s1", "missing-session", "/repo");
    const events: HarnessEvent[] = [];
    const turn = send(events);
    const failed = expect(turn).rejects.toThrow(
      "No conversation found with session ID: missing-session",
    );
    await waitFor(() => sent.length > 0, "initialize");
    onStderr!("No conversation found with session ID: missing-session");
    onExit!(1);
    await failed;
    expect(events.some((e) => e.type === "session.started")).toBe(false);
    const retry = await startTurn("s1");
    expect(spawned[1]).toEqual(expect.arrayContaining(["--resume", "missing-session"]));
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await retry.turn;
  });

  it("handles an exit before spawn resolves", async () => {
    spawnChild.mockImplementationOnce(async (_id, _path, args) => {
      spawned.push(args);
      onExit!(1);
    });
    const events: HarnessEvent[] = [];
    await expect(send(events)).rejects.toThrow("Claude Code exited");
    expect(sent).toHaveLength(0);
    expect(events.some((e) => e.type === "session.started")).toBe(false);
  });

  it("preserves the resume error when exit races the first user-message write", async () => {
    bindClaudeSession("s1", "missing-session", "/repo");
    const events: HarnessEvent[] = [];
    const turn = send(events);
    const failed = expect(turn).rejects.toThrow(
      "No conversation found with session ID: missing-session",
    );
    await waitFor(() => sent.length > 0, "initialize");
    writeChild.mockImplementationOnce(async () => {
      onStderr!("No conversation found with session ID: missing-session");
      onExit!(1);
      throw new Error("Harness process is not running");
    });
    emit({ type: "control_response", response: { subtype: "success" } });
    await failed;
    expect(events).toContainEqual({
      type: "session.error",
      message: expect.stringContaining("No conversation found with session ID: missing-session"),
    });
    expect(events).not.toContainEqual({
      type: "session.error",
      message: "Harness process is not running",
    });
  });

  it("does not resume a new id after the initialize write fails", async () => {
    writeChild.mockRejectedValueOnce(new Error("Harness process is not running"));
    await expect(send([])).rejects.toThrow("Harness process is not running");
    const retry = await startTurn("s1");
    expect(spawned[1]).not.toContain("--resume");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await retry.turn;
  });

  it("binds the allocated id only when Claude confirms it", async () => {
    const events: HarnessEvent[] = [];
    const turn = send(events);
    await waitFor(() => sent.length > 0, "initialize");
    const id = spawned[0][spawned[0].indexOf("--session-id") + 1];
    emit({ type: "control_response", response: { subtype: "success" } });
    await waitFor(() => parse().some((m) => m.type === "user"), "user prompt");
    expect(events.some((e) => e.type === "session.providerBound")).toBe(false);
    emit({ type: "system", subtype: "init", session_id: id });
    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: id });
    emit({ type: "result", subtype: "success", session_id: id });
    await turn;
  });
});

describe("claude legacy account resume", () => {
  it("resumes a legacy thread when the missing account resolves to default", async () => {
    bindClaudeSession("s1", "legacy-session", "/repo");
    const { turn } = await startTurn("s1", {
      providerAccountId: "default",
    });
    expect(spawned[0]).toEqual(expect.arrayContaining(["--resume", "legacy-session"]));
    expect(spawned[0]).not.toContain("--session-id");
    emit({ type: "result", subtype: "success", session_id: "legacy-session" });
    await turn;
  });

  it("does not resume a legacy default thread under a named account", async () => {
    bindClaudeSession("s1", "legacy-session", "/repo");
    const { turn } = await startTurn("s1", {
      providerAccountId: "account-work",
    });
    expect(spawned[0]).not.toContain("--resume");
    expect(spawned[0]).toContain("--session-id");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
});

describe("claude session replay", () => {
  function replay(records: Array<Record<string, unknown>>) {
    const events: HarnessEvent[] = [];
    const prompts: string[] = [];
    replayClaudeSession({
      sessionId: "s1",
      cwd: "/repo",
      runtimeMode: "supervised",
      transcript: records.map((r) => JSON.stringify(r)).join("\n"),
      onEvent: (event) => events.push(event),
      onPrompt: (text) => prompts.push(text),
    });
    return { events, prompts };
  }

  it("rebuilds prompts, replies and tool rows from a stored conversation", () => {
    const { events, prompts } = replay([
      { type: "user", message: { role: "user", content: "ilk soru" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "cevap" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "dosya" }],
        },
      },
    ]);

    expect(prompts).toEqual(["ilk soru"]);
    expect(events.map((e) => e.type)).toEqual([
      "message.delta",
      "tool.started",
      "tool.updated",
      "message.completed",
    ]);
    const started = events[1] as Extract<HarnessEvent, { type: "tool.started" }>;
    expect(started.title).toBe("Read /repo/a.ts");
    expect(started.kind).toBe("read");
    const updated = events[2] as Extract<HarnessEvent, { type: "tool.updated" }>;
    expect(updated.status).toBe("completed");
    expect(updated.detail).toBe("dosya");
  });

  it("closes the previous reply when the next prompt arrives", () => {
    const { events, prompts } = replay([
      { type: "user", message: { role: "user", content: "bir" } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "ilk cevap" }] },
      },
      { type: "user", message: { role: "user", content: "iki" } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "ikinci cevap" }] },
      },
    ]);

    expect(prompts).toEqual(["bir", "iki"]);
    // Each reply is closed before the next one opens, so the two turns stay
    // separate blocks instead of folding into one long answer.
    expect(events.map((e) => e.type)).toEqual([
      "message.delta",
      "message.completed",
      "message.delta",
      "message.completed",
    ]);
  });

  it("skips subagent traffic and records that carry no conversation", () => {
    const { events, prompts } = replay([
      { type: "mode", mode: "normal" },
      { type: "ai-title", aiTitle: "bir baslik" },
      { type: "file-history-snapshot", snapshot: {} },
      {
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "alt ajan" }] },
      },
      { type: "user", message: { role: "user", content: "tek gercek mesaj" } },
    ]);

    expect(prompts).toEqual(["tek gercek mesaj"]);
    expect(events).toEqual([]);
  });

  it("treats a tool result wearing the user role as a tool row, not a prompt", () => {
    const { prompts } = replay([
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "nope", content: "x" }],
        },
      },
    ]);
    expect(prompts).toEqual([]);
  });
});

describe("claude subagents", () => {
  it.each(["allow", "deny"] as const)(
    "routes a child permission decision: %s",
    async (decision) => {
      const { events, turn } = await startTurn("s1");
      emit({
        type: "control_request",
        request_id: "child_permission",
        session_id: "sess_child",
        parent_tool_use_id: "toolu_agent",
        request: {
          subtype: "can_use_tool",
          tool_name: "Read",
          tool_use_id: "child_read",
          input: { file_path: "/home/user/.gitconfig" },
        },
      });
      const approval = events.find((event) => event.type === "approval.requested")!;
      expect(approval).toMatchObject({ callId: "child_read" });
      respondClaudeApproval("s1", approval.requestId, decision);
      await waitFor(
        () =>
          parse().some(
            (message) =>
              (message.response as Record<string, unknown>)?.request_id === "child_permission",
          ),
        "child decision",
      );
      expect(
        parse().find(
          (message) =>
            (message.response as Record<string, unknown>)?.request_id === "child_permission",
        ),
      ).toMatchObject({
        type: "control_response",
        response: { response: { behavior: decision } },
      });
      expect(events.filter((event) => event.type === "session.providerBound").at(-1)).toMatchObject(
        { providerSessionId: "sess_1" },
      );
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;
    },
  );

  it("emits session usage from the turn result and ignores subagent results", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
      parent_tool_use_id: "agent_1",
      total_cost_usd: 9,
      duration_api_ms: 9_000,
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
      total_cost_usd: 0.013,
      duration_api_ms: 2_751,
      usage: {
        input_tokens: 10,
        output_tokens: 31,
        cache_read_input_tokens: 19_640,
        cache_creation_input_tokens: 139,
      },
    });
    await turn;
    expect(events.filter((event) => event.type === "usage")).toEqual([
      {
        type: "usage",
        processCostUsd: 0.013,
        processApiMs: 2_751,
      },
    ]);
  });

  it("keeps simultaneous child questions reachable in the single-question UI", async () => {
    const { events, turn } = await startTurn("s1");
    for (const id of ["child_a", "child_b"]) {
      emit({
        type: "control_request",
        request_id: id,
        parent_tool_use_id: `agent_${id}`,
        request: {
          subtype: "can_use_tool",
          tool_name: "AskUserQuestion",
          input: {
            questions: [
              {
                question: `Question from ${id}`,
                options: [{ label: "Proceed" }],
              },
            ],
          },
        },
      });
    }
    expect(events.filter((event) => event.type === "question.asked")).toHaveLength(1);
    for (const id of ["child_a", "child_b"]) {
      const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
      const request = session.pendingQuestion!;
      expect(request.questions[0].prompt).toBe(`Question from ${id}`);
      respondClaudeQuestion(
        "s1",
        request.requestId,
        id === "child_a"
          ? {
              kind: "answered",
              answers: {
                [request.questions[0].id]: [request.questions[0].options[0].id],
              },
            }
          : { kind: "skipped" },
      );
      await waitFor(
        () =>
          parse().some(
            (message) => (message.response as Record<string, unknown>)?.request_id === id,
          ),
        "question response",
      );
      expect(
        parse().find((message) => (message.response as Record<string, unknown>)?.request_id === id),
      ).toMatchObject({
        response: {
          response: { behavior: id === "child_a" ? "allow" : "deny" },
        },
      });
    }
    expect(
      events.reduce(applyHarnessEvent, newSession("claude", "/repo")).pendingQuestion,
    ).toBeUndefined();
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });

  it.each(["child_a", "child_b"])(
    "preserves the remaining question when %s is cancelled by the server",
    async (cancelled) => {
      const { events, turn } = await startTurn("s1");
      for (const id of ["child_a", "child_b"]) {
        emit({
          type: "control_request",
          request_id: id,
          parent_tool_use_id: `agent_${id}`,
          request: {
            subtype: "can_use_tool",
            tool_name: "AskUserQuestion",
            input: {
              questions: [{ question: id, options: [{ label: "Proceed" }] }],
            },
          },
        });
      }
      emit({ type: "control_cancel_request", request_id: cancelled });
      await waitFor(
        () => events.some((event) => event.type === "question.resolved"),
        "cancelled question",
      );
      const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
      const remaining = cancelled === "child_a" ? "child_b" : "child_a";
      expect(session.pendingQuestion?.questions[0].prompt).toBe(remaining);
      respondClaudeQuestion("s1", session.pendingQuestion!.requestId, {
        kind: "skipped",
      });
      await waitFor(
        () =>
          parse().some(
            (message) => (message.response as Record<string, unknown>)?.request_id === remaining,
          ),
        "remaining question response",
      );
      expect(
        parse().some(
          (message) => (message.response as Record<string, unknown>)?.request_id === cancelled,
        ),
      ).toBe(false);
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;
    },
  );

  it("fails the active turn if a child permission reply cannot be delivered", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "control_request",
      request_id: "child_permission",
      parent_tool_use_id: "toolu_agent",
      request: {
        subtype: "can_use_tool",
        tool_name: "Read",
        input: { file_path: "/home/user/.gitconfig" },
      },
    });
    const approval = events.find((event) => event.type === "approval.requested")!;
    let outcome: unknown;
    void turn.catch((error) => {
      outcome = error;
    });
    writeChild.mockRejectedValueOnce(new Error("Broken pipe"));
    respondClaudeApproval("s1", approval.requestId, "allow");
    await waitFor(() => outcome instanceof Error, "failed permission delivery");
    expect(outcome).toMatchObject({ message: "Broken pipe" });
    expect(events).toContainEqual({
      type: "session.error",
      message: "Broken pipe",
    });
  });

  it.each([
    {
      scenario: "different descriptions",
      descriptions: ["Explore the auth module", "Review the tests"],
    },
    {
      scenario: "identical descriptions",
      descriptions: ["Explore the auth module", "Explore the auth module"],
    },
  ])(
    "shows one row per background subagent when the task list comes first ($scenario)",
    async ({ descriptions }) => {
      const { events, turn } = await startTurn("s1");
      const agents = [
        { id: "toolu_a", task: "t1", description: descriptions[0] },
        { id: "toolu_b", task: "t2", description: descriptions[1] },
      ];

      emit({
        type: "assistant",
        session_id: "sess_1",
        message: {
          content: agents.map((agent) => ({
            type: "tool_use",
            id: agent.id,
            name: "Agent",
            input: {
              description: agent.description,
              subagent_type: "explore",
              run_in_background: true,
            },
          })),
        },
      });
      // Claude lists the tasks, with no tool_use_id, before it announces them.
      emit({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: agents.map((agent) => ({
          task_id: agent.task,
          task_type: "local_agent",
          description: agent.description,
        })),
      });
      // Each listed task must claim a different call, even before task_started
      // supplies the authoritative IDs for agents with identical descriptions.
      expect(
        new Set(events.flatMap((event) => (event.type === "tool.updated" ? [event.callId] : []))),
      ).toEqual(new Set(["toolu_a", "toolu_b"]));
      for (const agent of agents) {
        emit({
          type: "system",
          subtype: "task_started",
          task_id: agent.task,
          tool_use_id: agent.id,
          description: agent.description,
          task_type: "local_agent",
          is_backgrounded: true,
        });
      }

      await waitFor(
        () =>
          events.filter((event) => event.type === "tool.updated" && event.callId === "toolu_b")
            .length > 0,
        "second task started",
      );
      const rows = events.flatMap((event) =>
        event.type === "tool.started" && event.kind === "agent" ? [event.callId] : [],
      );
      expect(rows).toEqual(["toolu_a", "toolu_b"]);

      emit({
        type: "system",
        subtype: "task_notification",
        task_id: "t1",
        tool_use_id: "toolu_a",
        status: "completed",
        summary: "First agent finished",
      });
      const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
      expect(session.blocks.find((block) => block.tool?.callId === "toolu_a")?.tool).toMatchObject({
        status: "completed",
        detail: "First agent finished",
      });
      expect(session.blocks.find((block) => block.tool?.callId === "toolu_b")?.tool).toMatchObject({
        status: "in_progress",
      });
      emit({
        type: "system",
        subtype: "task_notification",
        task_id: "t2",
        tool_use_id: "toolu_b",
        status: "completed",
        summary: "Second agent finished",
      });
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;
    },
  );

  it("keeps an unmatched background subagent visible until it finishes", async () => {
    const { events, turn } = await startTurn("s1");
    const description = "Explore the auth module";
    const task = {
      task_id: "t1",
      task_type: "local_agent",
      description,
    };
    // A task can be listed without an Agent call in the parent transcript.
    for (let i = 0; i < 2; i++) {
      emit({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [task],
      });
    }
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: "t1",
      description,
      summary: "Reading the auth module",
    });
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(session.blocks.filter((block) => block.tool?.kind === "agent")).toHaveLength(1);
    expect(
      session.blocks.find((block) => block.tool?.callId === `agent:${description}`)?.tool,
    ).toMatchObject({
      status: "in_progress",
      detail: "Reading the auth module",
    });

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      status: "completed",
      summary: "Found the auth entry points",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const finished = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(finished.blocks.filter((block) => block.tool?.kind === "agent")).toHaveLength(1);
    expect(
      finished.blocks.find((block) => block.tool?.callId === `agent:${description}`)?.tool,
    ).toMatchObject({
      status: "completed",
      detail: "Found the auth entry points",
    });
  });

  it("stays busy after a parent result while a background subagent is running", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: {
              description: "Explore the auth module",
              subagent_type: "explore",
            },
          },
        ],
      },
    });
    emit({
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      description: "Explore the auth module",
      task_type: "local_agent",
      is_backgrounded: true,
    });
    emit({
      type: "user",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_agent",
            content: "Backgrounded",
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" &&
          event.kind === "agent" &&
          event.title === "Explore the auth module",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(false);

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      status: "completed",
      summary: "Found the tokens",
    });
    // The notification wakes Claude for a follow-up turn; that turn's result
    // is what ends the Bycoda turn.
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    emitFollowUpTurn("The explorer found the tokens.");
    await turn;
    expect(settled).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
  });

  it("ignores the empty result a resume emits for a replayed background task", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    // After a resume, the CLI re-reports a background task the session had
    // started and answers it with an empty zero-turn result before the real
    // turn runs.
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "bash_1",
      status: "stopped",
      summary: "Background shell command didn't finish before the previous session ended",
      session_id: "sess_1",
    });
    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
      num_turns: 0,
      result: "",
      origin: { kind: "task-notification" },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(false);

    emitFollowUpTurn("hello");
    await turn;
    expect(settled).toBe(true);
  });

  it("does not end the turn on a subagent result", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_sub",
      parent_tool_use_id: "toolu_agent",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(false);

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(settled).toBe(true);
  });

  it("does not dump subagent assistant text into the parent transcript", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: { content: [{ type: "text", text: "I will grep for tokens" }] },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(
      events.some(
        (event) => event.type === "message.delta" && event.text.includes("I will grep for tokens"),
      ),
    ).toBe(false);
  });

  it("mirrors a subagent's tools, thinking and prose onto its own row", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: {
              description: "Correctness review",
              subagent_type: "explore",
            },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: {
        id: "msg_sub_1",
        model: "claude-haiku-4-5",
        content: [
          { type: "thinking", thinking: "Start with the reducer." },
          { type: "text", text: "I will grep for tokens" },
          {
            type: "tool_use",
            id: "toolu_sub_read",
            name: "Read",
            input: { file_path: "/repo/src/App.tsx" },
          },
        ],
      },
    });
    emit({
      type: "user",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_read",
            content: "export function App() {}",
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(
      events
        .reduce(applyHarnessEvent, newSession("claude", "/repo"))
        .blocks.find((block) => block.tool?.callId === "toolu_agent")?.agentRun?.model,
    ).toBe("claude-haiku-4-5");
    const steps = events.filter((event) => event.type === "agent.step");
    expect(steps.every((step) => step.callId === "toolu_agent")).toBe(true);
    expect(steps.map((step) => [step.stepId, step.kind, step.text, step.status])).toEqual([
      ["msg_sub_1:thinking", "reasoning", "Start with the reducer.", undefined],
      ["msg_sub_1:text", "message", "I will grep for tokens", undefined],
      ["toolu_sub_read", "tool", "Read /repo/src/App.tsx", "in_progress"],
      ["toolu_sub_read", "tool", "", "completed"],
    ]);
  });

  it("reports subagent context to its parent without touching the main context", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        usage: { input_tokens: 10, cache_read_input_tokens: 90 },
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Review" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: {
        id: "msg_sub_ctx",
        usage: { input_tokens: 5, cache_read_input_tokens: 1000 },
        content: [{ type: "text", text: "working" }],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_unknown",
      message: {
        id: "msg_sub_orphan",
        usage: { input_tokens: 7 },
        content: [{ type: "text", text: "lost" }],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(events.filter((event) => event.type === "agent.context")).toEqual([
      { type: "agent.context", callId: "toolu_agent", used: 1005 },
    ]);
    expect(events.filter((event) => event.type === "context").map((e) => e.used)).toEqual([100]);
  });

  it("keeps a successful subagent result as output and the prompt on the run", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: {
              description: "Run tests",
              prompt: "Run the unit tests and report failures.",
            },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_sub_bash",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    });
    emit({
      type: "user",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_bash",
            content: [{ type: "text", text: "12 passed" }],
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const run = events
      .reduce(applyHarnessEvent, newSession("claude", "/repo"))
      .blocks.find((block) => block.tool?.callId === "toolu_agent")?.agentRun;
    expect(run?.prompt).toBe("Run the unit tests and report failures.");
    expect(run?.steps[0]).toMatchObject({
      id: "toolu_sub_bash",
      status: "completed",
      output: "12 passed",
    });
    expect(run?.steps[0]).not.toHaveProperty("detail");
  });

  it("keeps a failed subagent tool result on its tool row", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Run tests" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_sub_bash",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    });
    emit({
      type: "user",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_bash",
            is_error: true,
            content: [{ type: "text", text: "Tests failed: assertion error" }],
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(
      session.blocks.find((block) => block.tool?.callId === "toolu_agent")?.agentRun?.steps,
    ).toMatchObject([
      {
        id: "toolu_sub_bash",
        kind: "tool",
        text: "npm test",
        toolKind: "execute",
        status: "failed",
        detail: "Tests failed: assertion error",
      },
    ]);
  });

  it("does not mirror a subagent result onto the parent tool row", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Correctness review" },
          },
        ],
      },
    });
    emit({
      type: "user",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_read",
            content: "export function App() {}",
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    // The parent stays in flight: only the subagent's own row settles.
    expect(
      events.some(
        (event) =>
          event.type === "tool.updated" &&
          event.callId === "toolu_agent" &&
          event.status === "completed",
      ),
    ).toBe(false);
  });

  it("ends the turn once a subagent has reported back inline", async () => {
    const { turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emitInlineSubagent();
    emit({ type: "result", subtype: "success", session_id: "sess_1" });

    await turn;
    expect(settled).toBe(true);
  });

  it("routes an unexpected provider exit to the turn that is actually running", async () => {
    const first = await startTurn("s1");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const secondEvents: HarnessEvent[] = [];
    const userMessages = parse().filter((message) => message.type === "user").length;
    const second = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      runtimeMode: "supervised",
      text: "try again",
      attachments: [],
      onEvent: (event) => secondEvents.push(event),
    });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > userMessages,
      "second user prompt",
    );

    onExit?.(1);
    await expect(second).rejects.toThrow("Claude Code exited");
    expect(first.events.some((event) => event.type === "session.ended")).toBe(false);
    expect(secondEvents).toContainEqual({ type: "session.ended", code: 1 });
    expect(secondEvents).toContainEqual({
      type: "session.error",
      message: "Claude Code exited",
    });
  });
});

describe("claude background tasks", () => {
  it("reads output reported only by the completion notification", async () => {
    readHarnessTaskOutput.mockClear();
    readHarnessTaskOutput.mockResolvedValue({ text: "completed output\n", truncated: false });
    const { events, turn } = await startTurn("s1");
    emitBackgroundBash();
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "b1",
      tool_use_id: "toolu_bash",
      status: "completed",
      summary: "Done",
      output_file: "/tmp/claude/project/tasks/b1.output",
    });
    await waitFor(
      () =>
        events.some(
          (e) =>
            e.type === "tool.updated" &&
            e.callId === "background:b1" &&
            e.preview?.output === "completed output\n",
        ),
      "notification output",
    );
    emitFollowUpTurn("Finished");
    await turn;
  });

  it("streams command output while the parent waits and reads the final output", async () => {
    readHarnessTaskOutput.mockClear();
    readHarnessTaskOutput.mockResolvedValue({ text: "first line\n", truncated: false });
    const { events, turn } = await startTurn("s1");
    emitBackgroundBash();
    emit({
      type: "user",
      tool_use_result: { outputFile: "/tmp/claude/project/tasks/b1.output" },
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_bash", content: "Running" }],
      },
    });
    await waitFor(
      () =>
        events.some(
          (e) =>
            e.type === "tool.updated" &&
            e.callId === "background:b1" &&
            e.preview?.output === "first line\n",
        ),
      "live output",
    );
    readHarnessTaskOutput.mockResolvedValue({
      text: "first line\nsecond line\n",
      truncated: false,
    });
    await waitFor(
      () =>
        events.some((e) => e.type === "tool.updated" && e.preview?.output?.includes("second line")),
      "growing output",
    );
    readHarnessTaskOutput.mockResolvedValue({ text: "last line\n", truncated: true });
    emitBashFinished();
    await waitFor(
      () =>
        events.some((e) => e.type === "tool.updated" && e.preview?.output?.includes("last line")),
      "final output",
    );
    emitFollowUpTurn("Finished");
    await turn;
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(
      session.blocks.find((b) => b.tool?.callId === "background:b1")?.tool?.preview?.output,
    ).toContain("Earlier output omitted");
    const reads = readHarnessTaskOutput.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1100));
    expect(readHarnessTaskOutput).toHaveBeenCalledTimes(reads);
  });

  it("rejects unrelated output paths and ignores late reads after cancellation", async () => {
    readHarnessTaskOutput.mockClear();
    const { events } = await startTurn("s1");
    emitBackgroundBash();
    const result = (path: string) =>
      emit({
        type: "user",
        tool_use_result: { outputFile: path },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_bash", content: "Running" }],
        },
      });
    result("/tmp/credentials.json");
    expect(readHarnessTaskOutput).not.toHaveBeenCalled();
    let resolve!: (value: { text: string; truncated: boolean }) => void;
    readHarnessTaskOutput.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    result("/tmp/claude/project/tasks/b1.output");
    await cancelClaudeTurn("s1");
    resolve({ text: "late output", truncated: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(
      events.some((e) => e.type === "tool.updated" && e.preview?.output === "late output"),
    ).toBe(false);
  });

  it("keeps the turn working through a background command and Claude's follow-up", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emitBackgroundBash();
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(false);
    expect(backgroundUpdates(events)).toEqual([["Wait 30 seconds then print done"]]);

    emitBashFinished();
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    emitFollowUpTurn("It finished and printed done.");
    await turn;
    expect(backgroundUpdates(events)).toEqual([["Wait 30 seconds then print done"], []]);
    // The command waited on sits under the message Claude left off with as
    // a row of its own, and the reply is a new message after it, once.
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const turn1 = session.blocks.slice(1);
    const background = turn1.find((block) => block.tool?.background);
    expect(background?.tool).toMatchObject({
      callId: "background:b1",
      status: "completed",
      detail: 'Background command "sleep 30 && echo done" completed (exit code 0)',
    });
    expect(background?.text).toContain("sleep 30");
    expect(
      turn1
        .filter((block) => block.role === "assistant" || block.tool?.background)
        .map((block) => (block.tool?.background ? "[background]" : block.text)),
    ).toEqual(["waiting", "[background]", "It finished and printed done."]);
    const items = groupTurnItems(turn1, { settled: true });
    const fold = foldableWork(items);
    const answer = items.at(-1);
    expect(answer?.type === "block" && answer.block.text).toBe("It finished and printed done.");
    // What Claude yielded with is its answer; the follow-up does not fold it.
    expect((fold ? foldedBlocks(items, fold) : []).map((block) => block.text)).not.toContain(
      "waiting",
    );
  });

  it("shows the waited-on command as a live row under Claude's last message", async () => {
    const { events } = await startTurn("s1");
    emitBackgroundBash();
    await new Promise((r) => setTimeout(r, 10));

    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const last = session.blocks.at(-1);
    expect(session.blocks.at(-2)?.text).toBe("waiting");
    expect(last?.tool).toMatchObject({
      background: true,
      status: "in_progress",
      kind: "execute",
    });
    const items = groupTurnItems(session.blocks.slice(1));
    const group = items.at(-1);
    expect(group?.type === "activity" && workSummaryLine(group.blocks, true)).toBe(
      "Running in background",
    );
  });

  it("lets the turn go if a finished task never wakes Claude", async () => {
    const { turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });
    emitBackgroundBash();

    vi.useFakeTimers();
    try {
      emitBashFinished();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops background commands when the turn is stopped", async () => {
    const { events, turn } = await startTurn("s1");
    emitBackgroundBash("b7");

    await cancelClaudeTurn("s1");
    await turn;
    const requests = parse().flatMap((m) => {
      const request = m.request as Record<string, unknown> | undefined;
      return request ? [request] : [];
    });
    expect(requests).toContainEqual({ subtype: "stop_task", task_id: "b7" });
    expect(requests.at(-1)).toEqual({ subtype: "interrupt" });
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
  });
});

describe("claude stopping background work", () => {
  const stopRequests = () =>
    parse().flatMap((m) => {
      const request = m.request as Record<string, unknown> | undefined;
      return request?.subtype === "stop_task" ? [request.task_id] : [];
    });
  const interrupts = () =>
    parse().filter(
      (m) => (m.request as Record<string, unknown> | undefined)?.subtype === "interrupt",
    );

  /** A backgrounded shell (b7) and a backgrounded subagent (t9) at yield. */
  function emitShellAndAgent() {
    emitBackgroundBash("b7");
    emit({
      type: "system",
      subtype: "task_started",
      task_id: "t9",
      tool_use_id: "toolu_agent9",
      description: "Review the diff",
      task_type: "local_agent",
      is_backgrounded: true,
    });
  }

  function endShell(status: string) {
    emit({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t9", task_type: "local_agent", description: "Review the diff" }],
    });
    emit({
      type: "system",
      subtype: "task_updated",
      task_id: "b7",
      patch: { status },
    });
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "b7",
      tool_use_id: "toolu_bash",
      status,
      summary: "Background command was stopped",
    });
  }

  it("stops one command by its row without touching the turn or the other task", async () => {
    const { events } = await startTurn("s1");
    emitShellAndAgent();

    await stopClaudeBackgroundWork("s1", "background:b7");
    expect(stopRequests()).toEqual(["b7"]);
    expect(interrupts()).toHaveLength(0);

    endShell("killed");
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const row = session.blocks.find((b) => b.tool?.callId === "background:b7");
    expect(row?.tool).toMatchObject({
      status: "stopped",
      detail: "Stopped by you.",
    });
    expect(row?.streaming).toBe(false);
    // The subagent is still what the turn waits on.
    expect(session.backgroundTasks).toEqual(["Review the diff"]);
    expect(session.backgroundAgents).toBe(1);
  });

  it("stops one subagent by its Agent call", async () => {
    const { events } = await startTurn("s1");
    emitShellAndAgent();

    await stopClaudeBackgroundWork("s1", "toolu_agent9");
    expect(stopRequests()).toEqual(["t9"]);

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t9",
      tool_use_id: "toolu_agent9",
      status: "stopped",
      summary: "Agent stopped",
    });
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(session.blocks.find((b) => b.tool?.callId === "toolu_agent9")?.tool).toMatchObject({
      status: "stopped",
      detail: "Stopped by you.",
    });
  });

  it("stops every task at once, still without interrupting the turn", async () => {
    await startTurn("s1");
    emitShellAndAgent();

    await stopClaudeBackgroundWork("s1");
    expect(stopRequests().sort()).toEqual(["b7", "t9"]);
    expect(interrupts()).toHaveLength(0);
  });

  it("keeps a foreground subagent's stop through the error its call returns", async () => {
    const { events } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_inline",
            name: "Agent",
            input: { description: "Inline helper", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "system",
      subtype: "task_started",
      task_id: "t5",
      tool_use_id: "toolu_inline",
      description: "Inline helper",
      task_type: "local_agent",
      is_backgrounded: false,
    });

    await stopClaudeBackgroundWork("s1", "toolu_inline");
    expect(stopRequests()).toEqual(["t5"]);
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t5",
      tool_use_id: "toolu_inline",
      status: "killed",
      summary: "",
    });
    emit({
      type: "user",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_inline",
            is_error: true,
            content: "Agent was stopped by the user",
          },
        ],
      },
    });
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    const block = session.blocks.find((b) => b.tool?.callId === "toolu_inline");
    expect(block?.tool?.status).toBe("stopped");
    expect(block?.tool?.detail).toContain("stopped by the user");
  });

  it("does not claim a task that finished before the stop took effect", async () => {
    const { events } = await startTurn("s1");
    emitBackgroundBash("b7");

    await stopClaudeBackgroundWork("s1", "background:b7");
    emitBashFinished("b7");
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(session.blocks.find((b) => b.tool?.callId === "background:b7")?.tool?.status).toBe(
      "completed",
    );
  });

  it("sends nothing for a call whose task is already gone", async () => {
    await startTurn("s1");
    emitBackgroundBash("b7");
    const before = parse().length;

    await stopClaudeBackgroundWork("s1", "toolu_gone");
    await stopClaudeBackgroundWork("nobody");
    expect(parse()).toHaveLength(before);
  });

  it("takes back its claim when the request never reached Claude", async () => {
    const { events } = await startTurn("s1");
    emitBackgroundBash("b7");

    writeChild.mockRejectedValueOnce(new Error("pipe closed"));
    await expect(stopClaudeBackgroundWork("s1", "background:b7")).rejects.toThrow("pipe closed");
    // Claude ends it on its own: not asked for, so not "stopped by you".
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "b7",
      status: "killed",
      summary: "",
    });
    const session = events.reduce(applyHarnessEvent, newSession("claude", "/repo"));
    expect(session.blocks.find((b) => b.tool?.callId === "background:b7")?.tool?.status).toBe(
      "failed",
    );
  });
});

describe("claude plan permissions", () => {
  it("answers residual plan-mode permissions without prompting the user", async () => {
    const { events, turn } = await startTurn("s1", {
      runtimeMode: "auto",
      intent: "plan",
    });

    emit({
      type: "control_request",
      request_id: "read_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Read",
        input: { file_path: "/repo/src/App.tsx" },
      },
    });
    emit({
      type: "control_request",
      request_id: "write_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Write",
        input: { file_path: "/repo/src/new.ts" },
      },
    });

    await waitFor(
      () => parse().filter((message) => message.type === "control_response").length >= 2,
      "plan permission responses",
    );
    const responses = parse().filter((message) => message.type === "control_response");
    const read = responses.find(
      (message) => (message.response as Record<string, unknown>)?.request_id === "read_1",
    );
    const write = responses.find(
      (message) => (message.response as Record<string, unknown>)?.request_id === "write_1",
    );
    expect(
      ((read?.response as Record<string, unknown>)?.response as Record<string, unknown>)?.behavior,
    ).toBe("allow");
    expect(
      ((write?.response as Record<string, unknown>)?.response as Record<string, unknown>)?.behavior,
    ).toBe("deny");
    expect(events.some((event) => event.type === "approval.requested")).toBe(false);

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });

  it("leaves the captured plan ready to build after a subagent explored for it", async () => {
    const { events, turn } = await startTurn("s1", { intent: "plan" });
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emitInlineSubagent();
    emit({
      type: "control_request",
      request_id: "exit_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "ExitPlanMode",
        tool_use_id: "toolu_exit",
        input: { plan: "# Plan\n\nRewrite the auth module." },
      },
    });
    await waitFor(
      () =>
        parse().some(
          (message) => (message.response as Record<string, unknown>)?.request_id === "exit_1",
        ),
      "exit plan mode response",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });

    // The turn must end for the session to stop being busy; until it does, the
    // plan's Build control stays disabled however the plan block itself reads.
    await turn;
    expect(settled).toBe(true);

    let session = newSession("claude", "/repo");
    for (const event of events) session = applyHarnessEvent(session, event);
    const plan = session.blocks.find((block) => block.role === "plan");
    expect(plan?.text).toContain("Rewrite the auth module.");
    expect(plan?.streaming).toBeFalsy();
    expect(plan?.plan?.status).toBe("ready");
  });
});

describe("claude manual compaction", () => {
  it("runs the built-in command and requires a compact boundary", async () => {
    const { turn } = await startTurn("s1");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    sent.length = 0;

    const events: HarnessEvent[] = [];
    const compact = compactClaudeContext({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    await waitFor(() => parse().some((message) => message.type === "user"), "compact command");
    expect(parse().find((message) => message.type === "user")).toMatchObject({
      message: { content: [{ type: "text", text: "/compact" }] },
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: { content: [{ type: "text", text: "not transcript output" }] },
    });
    emit({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sess_1",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await compact;

    expect(events).toContainEqual({
      type: "status",
      text: "Compacted context",
    });
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });
});

describe("claude replay bindings", () => {
  // `handleLine` keys the resume binding to the directory replay is given, so
  // an imported worktree thread has to be replayed against its checkout: a
  // binding under the project root is dropped once the next turn runs in the
  // checkout, and Claude starts a new conversation instead of continuing.
  async function turnIn(cwd: string) {
    const turn = sendClaudeTurn({
      sessionId: "s1",
      cwd,
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "devam",
      attachments: [],
      onEvent: () => undefined,
    });
    await waitFor(() => spawned.length === 1, "claude process");
    void turn.catch(() => undefined);
    return spawned[0] ?? [];
  }

  it("imports a worktree thread against its checkout", async () => {
    const session = buildImportedSession({
      base: {
        ...newSession("claude", "/repo", "claude:claude-sonnet-5"),
        id: "s1",
        worktreeCwd: "/repo/.worktrees/a",
      },
      // Records reach `handleLine` in the shape the live stream sends, which
      // is where the session id is read from.
      transcript: JSON.stringify({
        type: "assistant",
        session_id: "stored-conv",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "cevap" }],
        },
      }),
      providerSessionId: "stored-conv",
    });
    expect(session.providerSessionId).toBe("stored-conv");

    const args = await turnIn("/repo/.worktrees/a");
    expect(args).toEqual(expect.arrayContaining(["--resume", "stored-conv"]));
    expect(args).not.toContain("--session-id");
  });
});

it("Claude çıkışı bekleyen onay ve soruyu çözer", async () => {
  const { events, turn } = await startTurn("s1");
  const outcome = turn.catch(() => undefined);
  emit({
    type: "control_request",
    request_id: "approval-exit",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input: { command: "rm file" },
    },
  });
  emit({
    type: "control_request",
    request_id: "question-exit",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: {
        questions: [{ question: "Proceed?", options: [{ label: "Yes" }] }],
      },
    },
  });
  await waitFor(() => events.some((event) => event.type === "question.asked"), "question");
  onExit!(1);
  await outcome;
  await waitFor(
    () =>
      events.some((event) => event.type === "approval.resolved") &&
      events.some((event) => event.type === "question.resolved"),
    "interaction cleanup",
  );
});
