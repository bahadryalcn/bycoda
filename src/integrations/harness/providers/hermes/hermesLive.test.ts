import { processConstructions } from "../processConstruction.testSupport";
import { requestedApproval } from "../approvalOccurrence.testSupport";
import {
  exerciseOverlappingApproval,
  exerciseApprovalActualWriteLifetime,
} from "../approvalOverlap.testSupport";
import {
  nativeOutputFrame,
  captureNativeOutputEvent,
  getNativeOutputEventOrigin,
} from "../../core/nativeOutputDelivery.testSupport";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let heldApprovalWrite: (() => Promise<void>) | null = null;
let onLine: ((line: string) => void) | undefined;
let onStderr: ((line: string) => void) | undefined;
const textFiles = new Map<string, string>();
let heldFileRead: ((path: string) => Promise<string>) | null = null;
let queueAgent: ((message: Record<string, unknown>) => void) | null = null;

beforeEach(() => {
  processConstructions.reset();
  queueAgent = null;
});
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveHermesBinary: async () => ({ path: "/fake/hermes" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (
      _id: string,
      line: (value: string) => void,
      _exit: (code: number | null) => void,
      stderr: (value: string) => void,
    ) => {
      onLine = line;
      onStderr = stderr;
    },
    writeChild: async (_id: string, line: string) => {
      sent.push(line);
      const message = JSON.parse(line);
      if (message.id === 993 && message.result && heldApprovalWrite) await heldApprovalWrite();
      queueAgent?.(message);
    },
    readHarnessTextFile: async (path: string) => {
      if (heldFileRead) return heldFileRead(path);
      const content = textFiles.get(path);
      if (content == null) throw new Error(`missing ${path}`);
      return content;
    },
  }),
);

const {
  bindHermesSession,
  respondHermesApproval,
  sendHermesTurn,
  stopHermesSession,
  cancelHermesTurn,
} = await import("./hermes");
import type { HarnessEvent } from "../../core/types";

const parse = () => sent.map((line) => JSON.parse(line));

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((message) => message.method ?? `reply:${message.id}`))}`,
  );
}

async function initialize() {
  await waitFor(() => parse().some((message) => message.method === "initialize"), "initialize");
  const request = parse().find((message) => message.method === "initialize")!;
  reply(request.id, { protocolVersion: 1 });
}

async function newSession() {
  await waitFor(() => parse().some((message) => message.method === "session/new"), "session/new");
  const request = parse().find((message) => message.method === "session/new")!;
  reply(request.id, {
    sessionId: "hermes-session-1",
    models: { currentModelId: "nous:hermes-4" },
  });
}

describe("Hermes live ACP sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    heldApprovalWrite = null;
    onLine = undefined;
    onStderr = undefined;
    textFiles.clear();
    heldFileRead = null;
  });

  it.each([false, true])(
    "retains Hermes actual approval writes after timeout (cancel first: %s)",
    async (cancelBeforeTimeout) => {
      const sessionId = `hermes-write-${cancelBeforeTimeout}`;
      const events: HarnessEvent[] = [];
      const turn = sendHermesTurn({
        sessionId,
        cwd: "/repo",
        model: "hermes:nous:hermes-4",
        runtimeMode: "supervised",
        text: "hi",
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      const outcome = turn.catch(() => undefined);
      await initialize();
      await newSession();
      await waitFor(
        () => parse().some((message) => message.method === "session/set_mode"),
        "session/set_mode",
      );
      reply(parse().find((message) => message.method === "session/set_mode")!.id, {});
      await waitFor(
        () => parse().some((message) => message.method === "session/prompt"),
        "session/prompt",
      );
      const prompt = parse().find((message) => message.method === "session/prompt")!;
      let frame = 0;
      await exerciseApprovalActualWriteLifetime({
        events,
        requestId: 993,
        cancelBeforeTimeout,
        ask: () =>
          nativeOutputFrame(sessionId, `actual-write-${++frame}`, () =>
            onLine!(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 993,
                method: "session/request_permission",
                params: {
                  sessionId: "hermes-session-1",
                  toolCall: { toolCallId: "retained", title: "Run git status", kind: "execute" },
                  options: [
                    { optionId: "allow_once", kind: "allow_once" },
                    { optionId: "deny", kind: "reject_once" },
                  ],
                },
              }),
            ),
          ),
        approve: (nonce) => respondHermesApproval(sessionId, 993, "allow", nonce),
        cancel: () => cancelHermesTurn(sessionId),
        holdWrites: (gate) => {
          heldApprovalWrite = gate;
        },
        replies: () =>
          parse()
            .filter((message) => message.id === 993 && message.result)
            .map((message) => message.result),
      });
      if (!cancelBeforeTimeout) reply(prompt.id, { stopReason: "end_turn" });
      await outcome;
      await stopHermesSession(sessionId);
    },
  );

  it.each([false, true])(
    "fails closed on an overlapping Hermes permission (allow already queued: %s)",
    async (allowBeforeDuplicate) => {
      const sessionId = `hermes-overlap-${allowBeforeDuplicate}`;
      const events: HarnessEvent[] = [];
      const turn = sendHermesTurn({
        sessionId: sessionId,
        cwd: "/repo",
        model: "hermes:nous:hermes-4",
        runtimeMode: "supervised",
        text: "hi",
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      await initialize();
      await newSession();
      await waitFor(
        () => parse().some((message) => message.method === "session/set_mode"),
        "session/set_mode",
      );
      reply(parse().find((message) => message.method === "session/set_mode")!.id, {});
      await waitFor(
        () => parse().some((message) => message.method === "session/prompt"),
        "session/prompt",
      );
      const prompt = parse().find((message) => message.method === "session/prompt")!;
      let frame = 0;
      await exerciseOverlappingApproval({
        events,
        requestId: 992,
        allowBeforeDuplicate,
        ask: () =>
          nativeOutputFrame(sessionId, `overlap-${++frame}`, () =>
            onLine!(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 992,
                method: "session/request_permission",
                params: {
                  sessionId: "hermes-session-1",
                  toolCall: { toolCallId: "overlap", title: "Run git status", kind: "execute" },
                  options: [
                    { optionId: "allow_once", kind: "allow_once" },
                    { optionId: "deny", kind: "reject_once" },
                  ],
                },
              }),
            ),
          ),
        approve: (nonce, decision) => respondHermesApproval(sessionId, 992, decision, nonce),
        replies: () =>
          parse()
            .filter((message) => message.id === 992 && message.result)
            .map((message) => message.result),
        deniedResult: { outcome: { outcome: "selected", optionId: "deny" } },
      });
      reply(prompt.id, { stopReason: "end_turn" });
      await turn;
      await stopHermesSession(sessionId);
    },
  );

  it("starts Hermes ACP, selects model and mode, and sends attachments", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendHermesTurn({
      sessionId: "hermes-live-new",
      cwd: "/repo",
      model: "hermes:openrouter:gpt-5",
      runtimeMode: "auto-accept-edits",
      text: "inspect this",
      attachments: [
        {
          id: "image-1",
          name: "screen.png",
          mimeType: "image/png",
          kind: "image",
          size: 4,
          data: "AAAA",
        },
      ],
      onEvent: (event) => events.push(event),
    });

    onStderr?.(
      "2026-09-17 10:24:42 [WARNING] agent.credential_pool: Copilot token exchange degraded to RAW token (exchange unavailable)",
    );

    await initialize();
    await newSession();
    await waitFor(
      () => parse().some((message) => message.method === "session/set_model"),
      "session/set_model",
    );
    const setModel = parse().find((message) => message.method === "session/set_model")!;
    expect(setModel.params.modelId).toBe("openrouter:gpt-5");
    reply(setModel.id, {});

    await waitFor(
      () => parse().some((message) => message.method === "session/set_mode"),
      "session/set_mode",
    );
    const setMode = parse().find((message) => message.method === "session/set_mode")!;
    expect(setMode.params.modeId).toBe("accept_edits");
    reply(setMode.id, {});

    await waitFor(
      () => parse().some((message) => message.method === "session/prompt"),
      "session/prompt",
    );
    const prompt = parse().find((message) => message.method === "session/prompt")!;
    expect(prompt.params.prompt).toEqual([
      {
        type: "text",
        text: "inspect this\n\nAttachments: [image1] = screen.png (1st attached image)",
      },
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ]);
    reply(prompt.id, { stopReason: "end_turn" });

    await turn;
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "hermes-session-1",
    });
    expect(events.some((event) => event.type === "session.error")).toBe(false);
    await stopHermesSession("hermes-live-new");
  });

  it("loads a bound Hermes session instead of creating a new one", async () => {
    bindHermesSession("hermes-live-load", "persisted-session", "/repo");
    const turn = sendHermesTurn({
      sessionId: "hermes-live-load",
      cwd: "/repo",
      model: "hermes:nous:hermes-4",
      runtimeMode: "supervised",
      text: "continue",
      attachments: [],
      onEvent: () => undefined,
    });

    await initialize();
    await waitFor(
      () => parse().some((message) => message.method === "session/load"),
      "session/load",
    );
    const load = parse().find((message) => message.method === "session/load")!;
    expect(load.params.sessionId).toBe("persisted-session");
    reply(load.id, { models: { currentModelId: "nous:hermes-4" } });

    await waitFor(
      () => parse().some((message) => message.method === "session/set_mode"),
      "session/set_mode",
    );
    const setMode = parse().find((message) => message.method === "session/set_mode")!;
    reply(setMode.id, {});
    await waitFor(
      () => parse().some((message) => message.method === "session/prompt"),
      "session/prompt",
    );
    const prompt = parse().find((message) => message.method === "session/prompt")!;
    reply(prompt.id, { stopReason: "end_turn" });

    await turn;
    expect(parse().some((message) => message.method === "session/new")).toBe(false);
    expect(parse().some((message) => message.method === "session/resume")).toBe(false);
    await stopHermesSession("hermes-live-load");
  });

  it("uses Hermes permission option ids for supervised approvals", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendHermesTurn({
      sessionId: "hermes-live-permission",
      cwd: "/repo",
      model: "hermes:nous:hermes-4",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (event) => events.push(event),
    });

    await initialize();
    await newSession();
    await waitFor(
      () => parse().some((message) => message.method === "session/set_mode"),
      "session/set_mode",
    );
    const setMode = parse().find((message) => message.method === "session/set_mode")!;
    reply(setMode.id, {});
    await waitFor(
      () => parse().some((message) => message.method === "session/prompt"),
      "session/prompt",
    );
    const prompt = parse().find((message) => message.method === "session/prompt")!;

    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 91,
        method: "session/request_permission",
        params: {
          sessionId: "hermes-session-1",
          toolCall: {
            toolCallId: "tool-1",
            title: "Run git status",
            kind: "execute",
            rawInput: { command: "git status" },
          },
          options: [
            { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        },
      }),
    );
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "approval.requested",
    );
    const original = requestedApproval(events, 91);
    respondHermesApproval("hermes-live-permission", 91, "allow");
    expect(parse().some((message) => message.id === 91 && message.result)).toBe(false);
    respondHermesApproval("hermes-live-permission", 91, "allow", original.occurrenceId);
    await waitFor(
      () => parse().some((message) => message.id === 91 && message.result),
      "permission response",
    );
    const response = parse().find((message) => message.id === 91 && message.result)!;
    expect(response.result.outcome.optionId).toBe("allow_once");
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 91,
        method: "session/request_permission",
        params: {
          sessionId: "hermes-session-1",
          toolCall: { title: "Run second command", kind: "execute", toolCallId: "tool-2" },
          options: [
            { optionId: "allow_once", kind: "allow_once" },
            { optionId: "deny", kind: "reject_once" },
          ],
        },
      }),
    );
    await waitFor(
      () => events.filter((event) => event.type === "approval.requested").length === 2,
      "replacement permission",
    );
    const current = requestedApproval(events, 91);
    expect(current.occurrenceId).not.toBe(original.occurrenceId);
    respondHermesApproval("hermes-live-permission", 91, "allow", original.occurrenceId);
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 91 && message.result)).toHaveLength(1);
    respondHermesApproval("hermes-live-permission", 91, "deny", current.occurrenceId);
    await waitFor(
      () => parse().filter((message) => message.id === 91 && message.result).length === 2,
      "matching replacement reply",
    );
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: 91,
      occurrenceId: current.occurrenceId,
      decision: "deny",
    });
    respondHermesApproval("hermes-live-permission", 91, "allow", current.occurrenceId);
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 91 && message.result)).toHaveLength(2);
    reply(prompt.id, { stopReason: "end_turn" });

    await turn;
    await stopHermesSession("hermes-live-permission");
  });

  it("stays busy and resumes after Hermes background subagents finish", async () => {
    const events: HarnessEvent[] = [];
    const transcript = "/tmp/deleg_abcd/task-0.log";
    const manifest = "/tmp/deleg_abcd/manifest.json";
    textFiles.set(manifest, JSON.stringify({ tasks: [{ index: 0, status: "running" }] }));
    textFiles.set(
      transcript,
      "=== Hermes subagent live transcript ===\n12:00:01 assistant | Found the lifecycle race.\n12:00:02 final | end status=completed",
    );

    const turn = sendHermesTurn({
      sessionId: "hermes-live-background",
      cwd: "/repo",
      model: "hermes:nous:hermes-4",
      runtimeMode: "supervised",
      text: "investigate the race",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    await initialize();
    await newSession();
    await waitFor(
      () => parse().some((message) => message.method === "session/set_mode"),
      "session/set_mode",
    );
    const setMode = parse().find((message) => message.method === "session/set_mode")!;
    reply(setMode.id, {});
    await waitFor(
      () => parse().some((message) => message.method === "session/prompt"),
      "first session/prompt",
    );
    const firstPrompt = parse().find((message) => message.method === "session/prompt")!;

    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "hermes-session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "delegate-call",
            kind: "agent",
            title: "Delegate task",
            status: "completed",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "dispatched",
                  mode: "background",
                  delegation_id: "deleg_abcd",
                  live_transcripts: [transcript],
                }),
              },
            ],
          },
        },
      }),
    );
    reply(firstPrompt.id, { stopReason: "end_turn" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(
      events.find((event) => event.type === "tool.updated" && event.callId === "delegate-call"),
    ).toMatchObject({ status: "in_progress", kind: "agent" });

    textFiles.set(
      manifest,
      JSON.stringify({
        completed: "2026-09-21 12:00:02",
        tasks: [{ index: 0, status: "completed" }],
      }),
    );
    await waitFor(
      () => parse().filter((message) => message.method === "session/prompt").length === 2,
      "background continuation prompt",
    );
    const continuation = parse().filter((message) => message.method === "session/prompt")[1]!;
    expect(continuation.params.prompt[0].text).toContain("Found the lifecycle race");
    expect(continuation.params.prompt[0].text).toContain(transcript);
    expect(
      events
        .filter((event) => event.type === "tool.updated" && event.callId === "delegate-call")
        .at(-1),
    ).toMatchObject({ status: "completed", kind: "agent" });

    reply(continuation.id, { stopReason: "end_turn" });
    await turn;
    expect(settled).toBe(true);
    await stopHermesSession("hermes-live-background");
  });
});

it("retains hermes completion lineage from the real RPC response across its await", async () => {
  sent.length = 0;
  const sessionId = "hermes-causal-response";
  const events: HarnessEvent[] = [];
  const done = sendHermesTurn({
    sessionId,
    cwd: "/repo",
    model: "hermes:nous:hermes-4",
    runtimeMode: "supervised",
    text: "hi",
    attachments: [],
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });
  await initialize();
  await newSession();
  await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "mode");
  reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
  await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
  const prompt = parse().find((m) => m.method === "session/prompt")!;
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: prompt.id,
    result: { stopReason: "end_turn" },
  });
  const inspect = nativeOutputFrame(sessionId, line, () => onLine!(line));
  expect(inspect().pendingCausalWork).toBeGreaterThan(0);
  await done;
  const event = events.find((e) => e.type === "message.completed")!;
  expect(getNativeOutputEventOrigin(event)).not.toBeNull();
  expect(inspect()).toMatchObject({ pendingCausalWork: 0, applicationThrough: null });
  await stopHermesSession(sessionId);
});

it("does not release original background dispatch work while a cancelled file read is still running", async () => {
  sent.length = 0;
  heldFileRead = null;
  const sessionId = "hermes-causal-background";
  const events: HarnessEvent[] = [];
  const done = sendHermesTurn({
    sessionId,
    cwd: "/repo",
    model: "hermes:nous:hermes-4",
    runtimeMode: "supervised",
    text: "hi",
    attachments: [],
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });
  await initialize();
  await newSession();
  await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "mode");
  reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
  await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
  const line = JSON.stringify({
    method: "session/update",
    params: {
      sessionId: "hermes-session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "held-background",
        kind: "agent",
        title: "Delegate task",
        status: "completed",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "dispatched",
              mode: "background",
              delegation_id: "deleg_causal",
              live_transcripts: ["/tmp/deleg_causal/task-0.log"],
            }),
          },
        ],
      },
    },
  });
  const inspect = nativeOutputFrame(sessionId, line, () => onLine!(line));
  let release!: (value: string) => void;
  heldFileRead = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  reply(parse().find((m) => m.method === "session/prompt")!.id, { stopReason: "end_turn" });
  await waitFor(() => !!release, "actual manifest read");
  expect(inspect().pendingCausalWork).toBe(1);
  await cancelHermesTurn(sessionId);
  expect(inspect().pendingCausalWork).toBe(1);
  release(JSON.stringify({ completed: true, tasks: [{ status: "completed" }] }));
  await done;
  expect(inspect()).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "additional-input-unsealed",
    applicationThrough: null,
  });
  expect(parse().filter((m) => m.method === "session/prompt")).toHaveLength(1);
  heldFileRead = null;
  await stopHermesSession(sessionId);
});

it.each([true, false])(
  "preserves hermes A's callback and permission policy while B is queued (cancel B: %s)",
  async (cancelB) => {
    // Production provider/client/queue; only the child transport is the existing
    // protocol fixture. No physical Native/provider retirement is asserted.
    sent.length = 0;
    const sessionId = `hermes-queue-${cancelB}`;
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
          ? { protocolVersion: 1 }
          : ["session/new", "session/load"].includes(message.method)
            ? {
                sessionId: "hermes-session-1",
                models: { currentModelId: "nous:hermes-4" },
                configOptions: [
                  { id: "model", category: "model", currentValue: "nous:hermes-4" },
                  { id: "mode", category: "mode", currentValue: "ask" },
                ],
              }
            : {};
      reply(message.id, result);
    };
    const base = {
      sessionId,
      cwd: "/repo",
      model: "hermes:nous:hermes-4",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      attachments: [],
    };
    const emitText = (text: string) => {
      const line = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "hermes-session-1",
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
          sessionId: "hermes-session-1",
          toolCall: { toolCallId: `queue-${id}`, title: "Run git status", kind: "execute" },
          options: [
            { optionId: "allow_once", kind: "allow_once" },
            { optionId: "reject_once", kind: "reject_once" },
          ],
        },
      });
      nativeOutputFrame(sessionId, line, () => onLine!(line));
    };
    const first = sendHermesTurn({
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
      const second = sendHermesTurn({
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
      const third = sendHermesTurn({
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
      respondHermesApproval(sessionId, 771, "allow", approval.occurrenceId);
      await waitFor(
        () => parse().some((message) => message.id === 771 && message.result),
        "A original approval response",
      );
      if (cancelB) await cancelHermesTurn(sessionId, queuedContext);
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
      await stopHermesSession(sessionId);
      await Promise.allSettled(pending);
    }
  },
);
