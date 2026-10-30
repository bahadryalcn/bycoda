import { processConstructions } from "../processConstruction.testSupport";
import {
  nativeOutputFrame,
  captureNativeOutputEvent,
  getNativeOutputEventOrigin,
} from "../../core/nativeOutputDelivery.testSupport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exerciseOverlappingApproval,
  exerciseApprovalActualWriteLifetime,
} from "../approvalOverlap.testSupport";

const sent: string[] = [];
let heldApprovalWrite: (() => Promise<void>) | null = null;
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number) => void) | undefined;
let queueAgent: ((message: Record<string, unknown>) => void) | null = null;

beforeEach(() => {
  processConstructions.reset();
  queueAgent = null;
});
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCursorBinary: async () => ({ path: "/fake/cursor-agent" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void, exit: (code: number) => void) => {
      onLine = line;
      onExit = exit;
    },
    writeChild: async (_id: string, line: string) => {
      sent.push(line);
      const message = JSON.parse(line);
      if (message.id === 993 && message.result && heldApprovalWrite) await heldApprovalWrite();
      queueAgent?.(message);
    },
  }),
);

const stores = vi.hoisted(() => ({ tools: vi.fn(), subagents: vi.fn() }));
vi.mock("./cursorStore", () => ({
  readStoredCursorToolCalls: stores.tools,
  readStoredCursorSubagentRuns: stores.subagents,
}));

const {
  sendCursorTurn,
  cancelCursorTurn,
  respondCursorApproval,
  respondCursorQuestion,
  stopCursorSession,
  __cursorTestReset,
} = await import("./cursor");
import type { HarnessEvent } from "../../core/types";
import { newSession } from "../../../../features/sessions/model/session";
import { applyHarnessEvent } from "../../core/apply";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function request(id: number, method: string, params: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}; sent=${JSON.stringify(parse())}`);
};

function outboundRequest(method: string) {
  return parse().find((message) => message.method === method);
}

async function startTurn(sessionId: string) {
  const events: HarnessEvent[] = [];
  const turn = sendCursorTurn({
    sessionId,
    cwd: "/repo",
    model: "cursor:composer-2.5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "explore the codebase",
    attachments: [],
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });

  await waitFor(() => !!outboundRequest("initialize"), "initialize");
  reply(outboundRequest("initialize")!.id as number, {});

  await waitFor(() => !!outboundRequest("authenticate"), "authenticate");
  reply(outboundRequest("authenticate")!.id as number, {});

  await waitFor(() => !!outboundRequest("session/new"), "session/new");
  reply(outboundRequest("session/new")!.id as number, {
    sessionId: "cursor_1",
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "composer-2.5",
      },
    ],
  });

  await waitFor(() => !!outboundRequest("session/prompt"), "session/prompt");
  const promptId = outboundRequest("session/prompt")!.id as number;
  return { events, promptId, turn };
}

function emitAgentStart() {
  notify("session/update", {
    sessionId: "cursor_1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_agent",
      title: "Task: Explore auth",
      kind: "other",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Explore auth",
        subagentType: "explore",
      },
    },
  });
}

function agentEvents(events: HarnessEvent[]) {
  return events.filter((event) => event.type === "tool.updated" && event.callId === "call_agent");
}

beforeEach(() => {
  stores.tools.mockReset().mockResolvedValue([]);
  stores.subagents.mockReset().mockResolvedValue([]);
  sent.length = 0;
  heldApprovalWrite = null;
  onLine = undefined;
  __cursorTestReset();
});

it.each([false, true])(
  "retains Cursor actual approval writes after timeout (cancel first: %s)",
  async (cancelBeforeTimeout) => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    const outcome = turn.catch(() => undefined);
    let frame = 0;
    await exerciseApprovalActualWriteLifetime({
      events,
      requestId: 993,
      cancelBeforeTimeout,
      ask: () =>
        nativeOutputFrame("cursor-live", `actual-write-${++frame}`, () =>
          request(993, "session/request_permission", {
            sessionId: "cursor_1",
            toolCall: { toolCallId: "retained", title: "Run git status", kind: "execute" },
            options: [
              { optionId: "allow-once", kind: "allow_once" },
              { optionId: "reject-once", kind: "reject_once" },
            ],
          }),
        ),
      approve: (nonce) => respondCursorApproval("cursor-live", 993, "allow", nonce),
      cancel: () => cancelCursorTurn("cursor-live"),
      holdWrites: (gate) => {
        heldApprovalWrite = gate;
      },
      replies: () =>
        parse()
          .filter((message) => message.id === 993 && message.result)
          .map((message) => message.result),
    });
    if (!cancelBeforeTimeout) reply(promptId, { stopReason: "end_turn" });
    await outcome;
  },
);

it.each([false, true])(
  "fails closed on an overlapping Cursor permission (allow already queued: %s)",
  async (allowBeforeDuplicate) => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    let frame = 0;
    await exerciseOverlappingApproval({
      events,
      requestId: 992,
      allowBeforeDuplicate,
      ask: () =>
        nativeOutputFrame("cursor-live", `overlap-${++frame}`, () =>
          request(992, "session/request_permission", {
            sessionId: "cursor_1",
            toolCall: { toolCallId: "overlap", title: "Run git status", kind: "execute" },
            options: [
              { optionId: "allow-once", kind: "allow_once" },
              { optionId: "reject-once", kind: "reject_once" },
            ],
          }),
        ),
      approve: (nonce, decision) => respondCursorApproval("cursor-live", 992, decision, nonce),
      replies: () =>
        parse()
          .filter((message) => message.id === 992 && message.result)
          .map((message) => message.result),
      deniedResult: { outcome: { outcome: "selected", optionId: "reject-once" } },
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  },
);

it("rejects a completed occurrence when Cursor reuses its permission RPC ID", async () => {
  const { events, promptId, turn } = await startTurn("cursor-live");
  const ask = () =>
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 991,
        method: "session/request_permission",
        params: {
          sessionId: "cursor_1",
          toolCall: { toolCallId: "reused-tool", title: "Run git status", kind: "execute" },
          options: [
            { optionId: "allow-once", kind: "allow_once" },
            { optionId: "reject-once", kind: "reject_once" },
          ],
        },
      }),
    );
  let previous: Extract<HarnessEvent, { type: "approval.requested" }> | undefined;
  for (let occurrence = 0; occurrence < 2; occurrence++) {
    ask();
    await waitFor(
      () => events.filter((event) => event.type === "approval.requested").length === occurrence + 1,
      "permission source",
    );
    const asked = events.filter(
      (event): event is Extract<HarnessEvent, { type: "approval.requested" }> =>
        event.type === "approval.requested",
    )[occurrence];
    respondCursorApproval("cursor-live", 991, "allow");
    if (previous) {
      expect(asked.occurrenceId).not.toBe(previous.occurrenceId);
      respondCursorApproval("cursor-live", 991, "allow", previous.occurrenceId);
    }
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 991 && message.result)).toHaveLength(
      occurrence,
    );
    respondCursorApproval("cursor-live", 991, "deny", asked.occurrenceId);
    await waitFor(
      () =>
        parse().filter((message) => message.id === 991 && message.result).length === occurrence + 1,
      "matching permission reply",
    );
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: 991,
      occurrenceId: asked.occurrenceId,
      decision: "deny",
    });
    respondCursorApproval("cursor-live", 991, "allow", asked.occurrenceId);
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 991 && message.result)).toHaveLength(
      occurrence + 1,
    );
    previous = asked;
  }
  reply(promptId, { stopReason: "end_turn" });
  await turn;
});

afterEach(async () => {
  await stopCursorSession("cursor-live");
  __cursorTestReset();
});

it("keeps concurrent Cursor questions reachable until each native response is written", async () => {
  const { events, promptId, turn } = await startTurn("cursor-live");
  for (const id of [71, 72])
    request(id, "cursor/ask_question", {
      questions: [{ id: String(id), question: `Question ${id}`, options: [{ label: "Local" }] }],
    });
  expect(events.filter((event) => event.type === "question.asked")).toHaveLength(1);
  respondCursorQuestion("cursor-live", 71, { kind: "answered", answers: { "71": ["Local"] } });
  await waitFor(
    () => events.filter((event) => event.type === "question.asked").length === 2,
    "second queued question",
  );
  expect(parse()).toContainEqual(expect.objectContaining({ id: 71, result: expect.anything() }));
  respondCursorQuestion("cursor-live", 72, { kind: "skipped" });
  await waitFor(
    () => events.filter((event) => event.type === "question.resolved").length === 2,
    "both responses acknowledged",
  );
  expect(
    events.reduce(applyHarnessEvent, newSession("cursor", "/repo")).pendingQuestion,
  ).toBeUndefined();
  reply(promptId, { stopReason: "end_turn" });
  await turn;
});

describe("cursor background subagents", () => {
  it("recovers native child steps without parent-attributed ACP events and enriches foreground names", async () => {
    const run = {
      agentId: "child_1",
      toolCallId: "call_agent",
      revision: "12",
      prompt: "Perform a read-only, defect-first code review of ACP routing in /repo.",
      steps: [
        { id: "child_1:blob:0", kind: "message", text: "Checking routing." },
        {
          id: "child_1:tool:read",
          kind: "tool",
          text: "",
          toolName: "Read",
          args: { path: "/repo/acp.ts" },
          status: "completed",
          output: "export const route = true;",
        },
      ],
    };
    stores.subagents.mockResolvedValue([run]);
    const { events, promptId, turn } = await startTurn("cursor-live");
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_agent",
        title: "Task: Subagent task",
        kind: "other",
        status: "pending",
        rawInput: { _toolName: "task" },
      },
    });
    expect(agentEvents(events).at(-1)).toMatchObject({ title: "Subagent" });
    await waitFor(() => events.some((event) => event.type === "agent.step"), "stored child steps");
    expect(stores.subagents).toHaveBeenCalledWith("cursor_1", ["call_agent"], expect.any(Object));
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
      },
    });
    request(101, "cursor/task", {
      toolCallId: "call_agent",
      agentId: "child_1",
      description: "Review ACP routing",
      durationMs: 25,
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
    const session = events.reduce(applyHarnessEvent, newSession("cursor", "/repo"));
    const row = session.blocks.find((block) => block.tool?.callId === "call_agent")!;
    expect(row.text).toBe("Review ACP routing");
    expect(row.tool?.status).toBe("completed");
    expect(row.agentRun?.name).toBe("Review ACP routing");
    expect(row.agentRun?.steps).toHaveLength(2);
    expect(row.agentRun?.steps[1]).toMatchObject({
      toolKind: "read",
      status: "completed",
      preview: { path: "/repo/acp.ts" },
    });
    expect(session.blocks.filter((block) => block.role === "assistant")).toEqual([]);
    expect(stores.subagents.mock.calls.at(-1)?.[2]).toEqual({ child_1: "12" });
  });

  it("keeps a task description received before its placeholder tool row", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    notify("cursor/task", {
      toolCallId: "call_agent",
      description: "Review UI events",
      agentId: "child_1",
    });
    notify("session/update", {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_agent",
        title: "Task: Subagent task",
        rawInput: { _toolName: "task" },
        status: "in_progress",
      },
    });
    expect(agentEvents(events).at(-1)).toMatchObject({
      title: "Review UI events",
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it.each(["cancel", "stop", "exit"])(
    "ignores an in-flight child read after %s",
    async (action) => {
      let resolve!: (runs: unknown[]) => void;
      stores.subagents.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const { events, promptId, turn } = await startTurn("cursor-live");
      emitAgentStart();
      await waitFor(() => !!resolve, "child read");
      if (action === "cancel") await cancelCursorTurn("cursor-live");
      else if (action === "stop") await stopCursorSession("cursor-live");
      else onExit!(1);
      const count = events.length;
      resolve([
        {
          agentId: "child_1",
          toolCallId: "call_agent",
          revision: "1",
          steps: [{ id: "late", kind: "message", text: "Late result" }],
        },
      ]);
      // A stopped ACP client rejects its prompt; cancellation still receives a reply.
      if (action === "cancel") reply(promptId, { stopReason: "cancelled" });
      await turn.catch(() => undefined);
      await new Promise((done) => setTimeout(done, 5));
      expect(
        events
          .slice(count)
          .some((event) => event.type === "agent.step" || event.type === "message.completed"),
      ).toBe(false);
    },
  );

  it("routes attributed child work to its row and leaves parent narration separate", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    const meta = { parentToolCallId: "call_agent" };
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        _meta: meta,
        content: { type: "text", text: "Child narration" },
      },
    });
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        _meta: meta,
        toolCallId: "child_read",
        title: "Read auth.ts",
        kind: "read",
        status: "in_progress",
      },
    });
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "child_read",
        status: "completed",
      },
    });
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Parent narration" },
      },
    });
    expect(events.filter((event) => event.type === "message.delta")).toEqual([
      { type: "message.delta", text: "Parent narration" },
    ]);
    expect(events.filter((event) => event.type === "agent.step")).toEqual([
      expect.objectContaining({
        callId: "call_agent",
        kind: "message",
        text: "Child narration",
      }),
      expect.objectContaining({
        callId: "call_agent",
        stepId: "tool:child_read",
        status: "in_progress",
      }),
      expect.objectContaining({
        callId: "call_agent",
        stepId: "tool:child_read",
        status: "completed",
      }),
    ]);
    expect(
      events.some((event) => event.type === "tool.updated" && event.callId === "child_read"),
    ).toBe(false);
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("keeps a failed child tool's error text on its step", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    const meta = { parentToolCallId: "call_agent" };
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        _meta: meta,
        toolCallId: "child_bash",
        title: "npm test",
        kind: "execute",
        status: "in_progress",
      },
    });
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "child_bash",
        status: "failed",
        content: [{ type: "text", text: "Tests failed: assertion error" }],
      },
    });
    expect(events.filter((event) => event.type === "agent.step").at(-1)).toMatchObject({
      callId: "call_agent",
      stepId: "tool:child_bash",
      status: "failed",
      detail: "Tests failed: assertion error",
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("does not pass a child tool's command off as its error output", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    const meta = { parentToolCallId: "call_agent" };
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        _meta: meta,
        toolCallId: "child_bash",
        title: "npm test",
        kind: "execute",
        rawInput: { command: "npm test" },
        status: "in_progress",
      },
    });
    // Failed with nothing to say, but the update still carries the call: the
    // command is the title, not the reason it failed.
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "child_bash",
        status: "failed",
        rawInput: { command: "npm test" },
      },
    });
    const step = events.filter((event) => event.type === "agent.step").at(-1);
    expect(step).toMatchObject({
      callId: "call_agent",
      stepId: "tool:child_bash",
      status: "failed",
    });
    expect(step).not.toHaveProperty("detail");
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("emits request-shaped Cursor todo updates as structured task lists", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    request(71, "cursor/update_todos", {
      toolCallId: "call_todos",
      todos: [
        { content: "Inspect", status: "completed" },
        { content: "Implement", status: "in_progress" },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "tasks.updated",
      items: [
        { text: "Inspect", status: "completed" },
        { text: "Implement", status: "in_progress" },
      ],
    });
    await waitFor(
      () => parse().some((message) => message.id === 71 && "result" in message),
      "cursor/update_todos response",
    );
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("keeps notification-shaped Cursor todo updates compatible", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    notify("_cursor/update_todos", {
      todos: [{ content: "Inspect", status: "pending" }],
    });
    expect(events.at(-1)).toEqual({
      type: "tasks.updated",
      items: [{ text: "Inspect", status: "pending" }],
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("preserves Cursor's partial-update signal and task identities", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    request(72, "cursor/update_todos", {
      toolCallId: "call_todos",
      merge: true,
      todos: [{ id: "2", content: "Implementing the fix", status: "completed" }],
    });
    expect(events.at(-1)).toEqual({
      type: "tasks.updated",
      merge: true,
      items: [
        {
          id: "2",
          text: "Implementing the fix",
          status: "completed",
        },
      ],
    });
    await waitFor(
      () => parse().some((message) => message.id === 72 && "result" in message),
      "partial cursor/update_todos response",
    );
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("marks Cursor's redundant todo tool call as internal task activity", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_todos",
        title: "Update TODOs",
        kind: "other",
        status: "pending",
        rawInput: { _toolName: "updateTodos", todos: [] },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "tool.updated",
      callId: "call_todos",
      kind: "tasks",
    });
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_todos",
        kind: "other",
        status: "completed",
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "tool.updated",
      callId: "call_todos",
      kind: "tasks",
      status: "completed",
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("keeps an ACP background task active until the prompt completes", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
        rawOutput: { isBackground: true },
      },
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      title: "Explore auth",
      kind: "agent",
      status: "in_progress",
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(false);

    reply(promptId, { stopReason: "end_turn" });
    await turn;

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      kind: "agent",
      status: "completed",
    });
    expect(settled).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
  });

  it("uses Cursor's task request when raw ACP output omits the background flag", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
      },
    });
    request(99, "cursor/task", {
      toolCallId: "call_agent",
      description: "Explore auth",
      subagentType: "explore",
      agentId: "child_1",
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      title: "Explore auth",
      kind: "agent",
      status: "in_progress",
      detail: "explore subagent",
    });
    await waitFor(
      () => parse().some((message) => message.id === 99 && "result" in message),
      "cursor/task response",
    );

    reply(promptId, { stopReason: "end_turn" });
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({ status: "completed" });
  });

  it("does not reopen a foreground task after Cursor reports its duration", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
        rawOutput: { isBackground: false, durationMs: 25 },
      },
    });
    request(100, "cursor/task", {
      toolCallId: "call_agent",
      description: "Explore auth",
      subagentType: "explore",
      agentId: "child_1",
      durationMs: 25,
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      kind: "agent",
      status: "completed",
    });

    reply(promptId, { stopReason: "end_turn" });
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({ status: "completed" });
  });
});

it.each(["initialize", "authenticate", "session/new"])(
  "Cursor %s yanıt vermeyince startup reddedilir",
  async (stage) => {
    vi.useFakeTimers();
    try {
      const events: HarnessEvent[] = [];
      const turn = sendCursorTurn({
        sessionId: "deadline",
        cwd: "/repo",
        model: "cursor:test",
        runtimeMode: "supervised",
        text: "hi",
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      const outcome = turn.catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(0);
      if (stage !== "initialize") {
        reply(outboundRequest("initialize")!.id as number, {});
        await vi.advanceTimersByTimeAsync(0);
      }
      if (stage === "session/new") {
        reply(outboundRequest("authenticate")!.id as number, {});
        await vi.advanceTimersByTimeAsync(0);
      }
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await outcome).toContain(`${stage} response timed out`);
      expect(events.some((event) => event.type === "session.started")).toBe(false);
      expect(outboundRequest("session/prompt")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  },
);

it("Cursor exit settles the original approval without writing to the exited process", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const { events, turn } = await startTurn("cursor-exit");
    const outcome = turn.catch(() => undefined);
    const inspect = nativeOutputFrame("cursor-exit", "exit-permission", () =>
      request(92, "session/request_permission", {
        sessionId: "cursor_1",
        toolCall: {
          toolCallId: "execute",
          title: "Run rm",
          kind: "execute",
          rawInput: { command: "rm file" },
        },
        options: [
          { optionId: "allow-once", kind: "allow_once" },
          { optionId: "reject-once", kind: "reject_once" },
        ],
      }),
    );
    await waitFor(() => events.some((event) => event.type === "approval.requested"), "approval");
    onExit!(1);
    await outcome;
    await waitFor(
      () => events.some((event) => event.type === "approval.resolved"),
      "approval cleanup",
    );
    expect(parse().some((message) => message.id === 92 && message.result)).toBe(false);
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: 92,
      occurrenceId: events.find((event) => event.type === "approval.requested")!.occurrenceId,
      decision: "cancelled",
    });
    await waitFor(() => inspect().pendingCausalWork === 0, "original permission handler drained");
    expect(
      warning.mock.calls.some(([message]) => message === "[bycoda] cursor server request failed"),
    ).toBe(false);
  } finally {
    warning.mockRestore();
  }
});

it("owns timer-backed stored-tool enrichment before its actual file read settles", async () => {
  const { events, promptId, turn } = await startTurn("cursor-causal");
  let release!: (value: Array<{ toolCallId: string; toolName: string; args: unknown }>) => void;
  stores.tools.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const line = JSON.stringify({
    method: "session/update",
    params: {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "causal-tool",
        kind: "read",
        status: "in_progress",
      },
    },
  });
  const inspect = nativeOutputFrame("cursor-causal", line, () => onLine!(line));
  expect(inspect().pendingCausalWork).toBeGreaterThan(0);
  await waitFor(() => !!release, "actual stored-tool read");
  const original = events.find((e) => e.type === "tool.started" || e.type === "tool.updated")!;
  const origin = getNativeOutputEventOrigin(original);
  expect(origin).not.toBeNull();
  release([
    { toolCallId: "causal-tool", toolName: "read_file", args: { path: "/repo/causal.ts" } },
  ]);
  await waitFor(
    () => events.some((e) => e.type === "tool.updated" && e.preview?.path === "/repo/causal.ts"),
    "causal stored tool result",
  );
  const enriched = events.find(
    (e) => e.type === "tool.updated" && e.preview?.path === "/repo/causal.ts",
  )!;
  expect(getNativeOutputEventOrigin(enriched)).toBe(origin);
  expect(inspect().unavailableReason).toBe("additional-input-unsealed");
  reply(promptId, { stopReason: "end_turn" });
  await turn;
  await vi.waitFor(() => expect(inspect().pendingCausalWork).toBe(0));
});

it.each([true, false])(
  "preserves cursor A's callback and permission policy while B is queued (cancel B: %s)",
  async (cancelB) => {
    // Production provider/client/queue; only the child transport is the existing
    // protocol fixture. No physical Native/provider retirement is asserted.
    sent.length = 0;
    const sessionId = `cursor-queue-${cancelB}`;
    const eventsA: HarnessEvent[] = [];
    const eventsB: HarnessEvent[] = [];
    const eventsC: HarnessEvent[] = [];
    const prompts: Record<string, unknown>[] = [];
    const pending: Promise<unknown>[] = [];
    const permissionResponse = (id: number) =>
      parse().find((message) => message.id === id && message.result)?.result as
        | { outcome: { optionId: string } }
        | undefined;
    queueAgent = (message) => {
      if (typeof message.id !== "number" || typeof message.method !== "string") return;
      if (message.method === "session/prompt") {
        prompts.push(message);
        return;
      }
      const result =
        message.method === "initialize"
          ? {}
          : ["session/new", "session/load"].includes(message.method)
            ? {
                sessionId: "cursor_1",
                models: { currentModelId: "composer-2.5" },
                configOptions: [
                  { id: "model", category: "model", currentValue: "composer-2.5" },
                  { id: "mode", category: "mode", currentValue: "ask" },
                ],
              }
            : {};
      reply(message.id, result);
    };
    const base = {
      sessionId,
      cwd: "/repo",
      model: "cursor:composer-2.5",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      attachments: [],
    };
    const emitText = (text: string) => {
      const line = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "cursor_1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        },
      });
      nativeOutputFrame(sessionId, line, () => onLine!(line));
    };
    const ask = (id: number) => {
      const line = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: {
          sessionId: "cursor_1",
          toolCall: { toolCallId: `queue-${id}`, title: "Run git status", kind: "execute" },
          options: [
            { optionId: "allow_once", kind: "allow_once" },
            { optionId: "reject_once", kind: "reject_once" },
          ],
        },
      });
      nativeOutputFrame(sessionId, line, () => onLine!(line));
    };
    const first = sendCursorTurn({
      ...base,
      text: "original A input",
      operationContext: { operation: {} },
      onEvent: (event) => eventsA.push(event),
    });
    const firstOutcome = first.then(
      () => undefined,
      (error: unknown) => error,
    );
    pending.push(firstOutcome);
    try {
      await waitFor(() => prompts.length === 1, "original A prompt held");
      const queuedContext = { operation: {} };
      const observedB = vi.fn();
      const second = sendCursorTurn({
        ...base,
        cwd: "/queued",
        text: "queued B input",
        intent: "plan",
        runtimeMode: "full-access",
        operationContext: queuedContext,
        onOriginalProcess: observedB,
        onEvent: (event) => eventsB.push(event),
      });
      const secondOutcome = second.then(
        () => undefined,
        (error: unknown) => error,
      );
      pending.push(secondOutcome);
      const observedC = vi.fn();
      const third = sendCursorTurn({
        ...base,
        text: "fresh C input",
        operationContext: { operation: {} },
        onOriginalProcess: observedC,
        onEvent: (event) => eventsC.push(event),
      });
      const thirdOutcome = third.then(
        () => undefined,
        (error: unknown) => error,
      );
      pending.push(thirdOutcome);
      expect(observedB).toHaveBeenCalledTimes(1);
      expect(observedC).toHaveBeenCalledTimes(1);
      expect(prompts).toHaveLength(1);
      expect(processConstructions.operations.filter((op) => op.kind === "spawn")).toHaveLength(1);
      expect(processConstructions.operations.filter((op) => op.kind === "kill")).toHaveLength(0);
      // Queueing B alone must not redirect A, repolicy A, or restart A.
      emitText("A remains the active callback");
      expect(eventsA).toContainEqual({
        type: "message.delta",
        text: "A remains the active callback",
      });
      expect(eventsB).toHaveLength(0);
      expect(eventsC).toHaveLength(0);
      ask(771);
      await waitFor(
        () =>
          eventsA.some((event) => event.type === "approval.requested" && event.requestId === 771),
        "A supervised permission retained",
      );
      expect(parse().some((message) => message.id === 771 && message.result)).toBe(false);
      const approval = eventsA.find(
        (event) => event.type === "approval.requested" && event.requestId === 771,
      );
      if (!approval || approval.type !== "approval.requested")
        throw new Error("Missing A original approval");
      respondCursorApproval(sessionId, 771, "allow", approval.occurrenceId);
      await waitFor(
        () => parse().some((message) => message.id === 771 && message.result),
        "A original approval response",
      );
      if (cancelB) await cancelCursorTurn(sessionId, queuedContext);
      expect(processConstructions.operations.filter((op) => op.kind === "kill")).toHaveLength(0);
      expect(parse().some((message) => message.method === "session/cancel")).toBe(false);
      reply(prompts[0].id as number, { stopReason: "end_turn" });
      expect(await firstOutcome).toBeUndefined();
      if (cancelB) {
        expect(await secondOutcome).toBeInstanceOf(Error);
        expect(String(await secondOutcome)).toMatch(/cancelled|closed/);
        expect(eventsB).toHaveLength(0);
      } else {
        await waitFor(() => prompts.length === 2, "B starts only after A and owns its restart");
        emitText("B owns its actual entered callback");
        expect(eventsB).toContainEqual({
          type: "message.delta",
          text: "B owns its actual entered callback",
        });
        expect(eventsC).toHaveLength(0);
        ask(772);
        await waitFor(
          () => parse().some((message) => message.id === 772 && message.result),
          "B planning denial",
        );
        expect(permissionResponse(772)?.outcome.optionId).toBe("reject_once");
        expect(prompts).toHaveLength(2);
        reply(prompts[1].id as number, { stopReason: "end_turn" });
        expect(await secondOutcome).toBeUndefined();
      }
      const expectedPrompts = cancelB ? 2 : 3;
      await waitFor(
        () => prompts.length === expectedPrompts,
        "C survives canceled/replaced prior Live",
      );
      emitText("C owns its fresh callback");
      expect(eventsC).toContainEqual({ type: "message.delta", text: "C owns its fresh callback" });
      expect(eventsA).not.toContainEqual({
        type: "message.delta",
        text: "C owns its fresh callback",
      });
      expect(eventsB).not.toContainEqual({
        type: "message.delta",
        text: "C owns its fresh callback",
      });
      expect(
        prompts.map((message) => JSON.stringify(message.params).includes("queued B input")),
      ).toEqual(cancelB ? [false, false] : [false, true, false]);
      reply(prompts[expectedPrompts - 1].id as number, { stopReason: "end_turn" });
      expect(await thirdOutcome).toBeUndefined();
      expect(processConstructions.operations.filter((op) => op.kind === "spawn")).toHaveLength(
        cancelB ? 1 : 3,
      );
    } finally {
      queueAgent = null;
      await stopCursorSession(sessionId);
      await Promise.allSettled(pending);
    }
  },
);
