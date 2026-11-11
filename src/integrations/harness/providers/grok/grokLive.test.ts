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
import { describe, expect, it, vi, beforeEach } from "vitest";

const sent: string[] = [];
let heldApprovalWrite: (() => Promise<void>) | null = null;
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number | null) => void) | undefined;
let queueAgent: ((message: Record<string, unknown>) => void) | null = null;

beforeEach(() => {
  processConstructions.reset();
  queueAgent = null;
});
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveGrokBinary: async () => ({ path: "/fake/grok" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (l: string) => void, exit: (c: number | null) => void) => {
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

const { compactGrokContext, sendGrokTurn, respondGrokApproval, stopGrokSession, cancelGrokTurn } =
  await import("./grok");
import type { HarnessEvent } from "../../core/types";

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
const parse = () => sent.map((s) => JSON.parse(s));
const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

const initResult = {
  protocolVersion: 1,
  authMethods: [{ id: "cached_token" }],
  _meta: {
    defaultAuthMethodId: "cached_token",
    modelState: {
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: { totalContextTokens: 500000 },
        },
      ],
    },
  },
};

async function handshake() {
  await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
  reply(parse().find((m) => m.method === "initialize")!.id, initResult);
  await waitFor(() => parse().some((m) => m.method === "authenticate"), "authenticate");
  reply(parse().find((m) => m.method === "authenticate")!.id, {});
  await waitFor(() => parse().some((m) => m.method === "session/new"), "session/new");
  reply(parse().find((m) => m.method === "session/new")!.id, {
    sessionId: "S1",
    models: { currentModelId: "grok-4.6" },
  });
}

describe("grok live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    heldApprovalWrite = null;
  });

  it.each([false, true])(
    "retains Grok actual approval writes after timeout (cancel first: %s)",
    async (cancelBeforeTimeout) => {
      const sessionId = `grok-write-${cancelBeforeTimeout}`;
      const events: HarnessEvent[] = [];
      const turn = sendGrokTurn({
        sessionId,
        cwd: "/repo",
        model: "grok:grok-4.6",
        runtimeMode: "supervised",
        text: "hi",
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      const outcome = turn.catch(() => undefined);
      await handshake();
      await waitFor(() => parse().some((message) => message.method === "session/prompt"), "prompt");
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
                  sessionId: "S1",
                  toolCall: { toolCallId: "retained", title: "Run git status", kind: "execute" },
                  options: [
                    { optionId: "allow-once", kind: "allow_once" },
                    { optionId: "reject-once", kind: "reject_once" },
                  ],
                },
              }),
            ),
          ),
        approve: (nonce) => respondGrokApproval(sessionId, 993, "allow", nonce),
        cancel: () => cancelGrokTurn(sessionId),
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
      await stopGrokSession(sessionId);
    },
  );

  it.each([false, true])(
    "fails closed on an overlapping Grok permission (allow already queued: %s)",
    async (allowBeforeDuplicate) => {
      const sessionId = `grok-overlap-${allowBeforeDuplicate}`;
      const events: HarnessEvent[] = [];
      const turn = sendGrokTurn({
        sessionId: sessionId,
        cwd: "/repo",
        model: "grok:grok-4.6",
        runtimeMode: "supervised",
        text: "hi",
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      await handshake();
      await waitFor(() => parse().some((message) => message.method === "session/prompt"), "prompt");
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
                  sessionId: "S1",
                  toolCall: { toolCallId: "overlap", title: "Run git status", kind: "execute" },
                  options: [
                    { optionId: "allow-once", kind: "allow_once" },
                    { optionId: "reject-once", kind: "reject_once" },
                  ],
                },
              }),
            ),
          ),
        approve: (nonce, decision) => respondGrokApproval(sessionId, 992, decision, nonce),
        replies: () =>
          parse()
            .filter((message) => message.id === 992 && message.result)
            .map((message) => message.result),
        deniedResult: { outcome: { outcome: "selected", optionId: "reject-once" } },
      });
      reply(prompt.id, { stopReason: "end_turn" });
      await turn;
      await stopGrokSession(sessionId);
    },
  );

  it("authenticates, selects the model, and prompts", async () => {
    const events: HarnessEvent[] = [];
    const onAccepted = vi.fn();
    const turn = sendGrokTurn({
      sessionId: "t1",
      cwd: "/repo",
      model: "grok:grok-4.6",
      modelSettings: { effort: "high" },
      runtimeMode: "supervised",
      text: "hey",
      attachments: [
        {
          id: "image-1",
          name: "screenshot.png",
          mimeType: "image/png",
          kind: "image",
          size: 3,
          data: "YWJj",
        },
      ],
      onAccepted,
      onEvent: (e) => events.push(e),
    });
    await handshake();
    await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "set_mode");
    reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
    const promptRequest = parse().find((m) => m.method === "session/prompt")!;
    expect(promptRequest.params.prompt).toEqual([
      {
        type: "text",
        text: "hey\n\nAttachments: [image1] = screenshot.png (1st attached image)",
      },
      { type: "image", mimeType: "image/png", data: "YWJj" },
    ]);
    // Grok answers the prompt only when the turn ends, so the prompt being
    // sent is the only sign that it has the turn.
    expect(onAccepted).toHaveBeenCalledOnce();
    reply(promptRequest.id, {
      stopReason: "end_turn",
    });
    await turn;
    expect(events.some((e) => e.type === "session.providerBound")).toBe(true);
    expect(parse().some((m) => m.method === "authenticate")).toBe(true);
    await stopGrokSession("t1");
  });

  it("surfaces a supervised permission request instead of auto-approving", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendGrokTurn({
      sessionId: "t2",
      cwd: "/repo",
      model: "grok:grok-4.6",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (e) => events.push(e),
    });
    await handshake();
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
    const promptId = parse().find((m) => m.method === "session/prompt")!.id;
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {
          sessionId: "S1",
          toolCall: {
            toolCallId: "call_a",
            title: "Execute `git status`",
            kind: "execute",
            rawInput: { variant: "Bash", command: "git status" },
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
      }),
    );
    await waitFor(() => events.some((e) => e.type === "approval.requested"), "approval.requested");
    const original = requestedApproval(events, 1);
    respondGrokApproval("t2", 1, "allow");
    expect(parse().some((message) => message.id === 1 && message.result)).toBe(false);
    respondGrokApproval("t2", 1, "allow", original.occurrenceId);
    await waitFor(() => parse().some((m) => m.id === 1 && m.result), "permission response");
    const response = parse().find((m) => m.id === 1 && m.result);
    expect(response.result.outcome.optionId).toBe("allow-once");
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {
          sessionId: "S1",
          toolCall: { title: "Run second command", kind: "execute", toolCallId: "call_b" },
          options: [
            { optionId: "allow-once", kind: "allow_once" },
            { optionId: "reject-once", kind: "reject_once" },
          ],
        },
      }),
    );
    await waitFor(
      () => events.filter((event) => event.type === "approval.requested").length === 2,
      "replacement permission",
    );
    const current = requestedApproval(events, 1);
    expect(current.occurrenceId).not.toBe(original.occurrenceId);
    respondGrokApproval("t2", 1, "allow", original.occurrenceId);
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 1 && message.result)).toHaveLength(1);
    respondGrokApproval("t2", 1, "deny", current.occurrenceId);
    await waitFor(
      () => parse().filter((message) => message.id === 1 && message.result).length === 2,
      "replacement matching reply",
    );
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: 1,
      occurrenceId: current.occurrenceId,
      decision: "deny",
    });
    respondGrokApproval("t2", 1, "allow", current.occurrenceId);
    await Promise.resolve();
    expect(parse().filter((message) => message.id === 1 && message.result)).toHaveLength(2);
    reply(promptId, { stopReason: "end_turn" });
    await turn;
    await stopGrokSession("t2");
  });

  it("routes a late exit to the current turn's listener", async () => {
    const turn1Events: HarnessEvent[] = [];
    const turn2Events: HarnessEvent[] = [];
    const base = {
      sessionId: "t3",
      cwd: "/repo",
      model: "grok:grok-4.6",
      runtimeMode: "supervised" as const,
      attachments: [],
    };

    const turn1 = sendGrokTurn({
      ...base,
      text: "hey",
      onEvent: (e) => turn1Events.push(e),
    });
    await handshake();
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t1");
    reply(parse().find((m) => m.method === "session/prompt")!.id, {
      stopReason: "end_turn",
    });
    await turn1;

    sent.length = 0;
    const turn2 = sendGrokTurn({
      ...base,
      text: "again",
      onEvent: (e) => turn2Events.push(e),
    });
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t2");
    onExit!(1);
    await turn2.catch(() => undefined);

    expect(turn2Events.some((e) => e.type === "session.ended")).toBe(true);
    expect(turn1Events.some((e) => e.type === "session.ended")).toBe(false);
    await stopGrokSession("t3");
  });

  it("compacts with Grok's ACP extension instead of a slash-command prompt", async () => {
    const turn = sendGrokTurn({
      sessionId: "t4",
      cwd: "/repo",
      model: "grok:grok-4.6",
      runtimeMode: "supervised",
      text: "hey",
      attachments: [],
      onEvent: () => undefined,
    });
    await handshake();
    await waitFor(
      () => parse().some((message) => message.method === "session/prompt"),
      "session/prompt",
    );
    const prompt = parse().find((message) => message.method === "session/prompt")!;
    reply(prompt.id, { stopReason: "end_turn" });
    await turn;
    sent.length = 0;

    const compact = compactGrokContext({
      sessionId: "t4",
      cwd: "/repo",
      model: "grok:grok-4.6",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () => parse().some((message) => message.method === "_x.ai/compact_conversation"),
      "compact_conversation",
    );
    const request = parse().find((message) => message.method === "_x.ai/compact_conversation")!;
    expect(request.params).toEqual({ sessionId: "S1" });
    expect(parse().some((message) => message.method === "session/prompt")).toBe(false);
    reply(request.id, {});
    await compact;
    await stopGrokSession("t4");
  });
});

it("retains grok completion lineage from the real RPC response across its await", async () => {
  sent.length = 0;
  const sessionId = "grok-causal-response";
  const events: HarnessEvent[] = [];
  const done = sendGrokTurn({
    sessionId,
    cwd: "/repo",
    model: "grok:grok-4.6",
    runtimeMode: "supervised",
    text: "hi",
    attachments: [],
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });
  await handshake();
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
  await stopGrokSession(sessionId);
});

it("keeps Grok compact callbacks queued behind A and admits a fresh compact after queued cancellation", async () => {
  sent.length = 0;
  const sessionId = "grok-compact-queue";
  const held: Record<string, unknown>[] = [];
  const aEvents: HarnessEvent[] = [];
  const bEvents: HarnessEvent[] = [];
  const cEvents: HarnessEvent[] = [];
  const base = {
    sessionId,
    cwd: "/repo",
    model: "grok:grok-4.6",
    runtimeMode: "supervised" as const,
  };
  queueAgent = (message) => {
    if (typeof message.id !== "number" || typeof message.method !== "string") return;
    if (["session/prompt", "_x.ai/compact_conversation"].includes(message.method)) {
      held.push(message);
      return;
    }
    reply(
      message.id,
      message.method === "initialize"
        ? initResult
        : message.method === "session/new"
          ? { sessionId: "S1", models: { currentModelId: "grok-4.6" } }
          : {},
    );
  };
  const a = sendGrokTurn({
    ...base,
    text: "A",
    attachments: [],
    onEvent: (event) => aEvents.push(event),
  });
  const aOutcome = a.then(
    () => undefined,
    (error: unknown) => error,
  );
  const pending: Promise<unknown>[] = [aOutcome];
  const emit = (text: string) => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "S1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      },
    });
    nativeOutputFrame(sessionId, line, () => onLine!(line));
  };
  try {
    await waitFor(() => held.length === 1, "A prompt held");
    const context = { operation: {} };
    const observed = vi.fn();
    const b = compactGrokContext({
      ...base,
      operationContext: context,
      onOriginalProcess: observed,
      onEvent: (event) => bEvents.push(event),
    });
    const bOutcome = b.then(
      () => undefined,
      (error: unknown) => error,
    );
    pending.push(bOutcome);
    expect(observed).toHaveBeenCalledTimes(1);
    emit("A during queued compact");
    expect(aEvents).toContainEqual({ type: "message.delta", text: "A during queued compact" });
    expect(bEvents).toHaveLength(0);
    expect(held).toHaveLength(1);
    await cancelGrokTurn(sessionId, context);
    reply(held[0].id as number, { stopReason: "end_turn" });
    expect(await aOutcome).toBeUndefined();
    expect(await bOutcome).toBeInstanceOf(Error);
    expect(parse().some((message) => message.method === "_x.ai/compact_conversation")).toBe(false);
    const c = compactGrokContext({
      ...base,
      operationContext: { operation: {} },
      onEvent: (event) => cEvents.push(event),
    });
    const cOutcome = c.then(
      () => undefined,
      (error: unknown) => error,
    );
    pending.push(cOutcome);
    await waitFor(() => held.length === 2, "fresh compact entered");
    expect(held[1].method).toBe("_x.ai/compact_conversation");
    emit("C owns the actual compact callback");
    expect(cEvents).toContainEqual({
      type: "message.delta",
      text: "C owns the actual compact callback",
    });
    expect(aEvents).not.toContainEqual({
      type: "message.delta",
      text: "C owns the actual compact callback",
    });
    reply(held[1].id as number, {});
    expect(await cOutcome).toBeUndefined();
    expect(processConstructions.operations.filter((op) => op.kind === "spawn")).toHaveLength(1);
  } finally {
    queueAgent = null;
    await stopGrokSession(sessionId);
    await Promise.allSettled(pending);
  }
});

it.each([true, false])(
  "preserves grok A's callback and permission policy while B is queued (cancel B: %s)",
  async (cancelB) => {
    // Production provider/client/queue; only the child transport is the existing
    // protocol fixture. No physical Native/provider retirement is asserted.
    sent.length = 0;
    const sessionId = `grok-queue-${cancelB}`;
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
          ? initResult
          : ["session/new", "session/load"].includes(message.method)
            ? {
                sessionId: "S1",
                models: { currentModelId: "grok-4.6" },
                configOptions: [
                  { id: "model", category: "model", currentValue: "grok-4.6" },
                  { id: "mode", category: "mode", currentValue: "ask" },
                ],
              }
            : {};
      reply(message.id, result);
    };
    const base = {
      sessionId,
      cwd: "/repo",
      model: "grok:grok-4.6",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      attachments: [],
    };
    const emitText = (text: string) => {
      const line = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "S1",
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
          sessionId: "S1",
          toolCall: { toolCallId: `queue-${id}`, title: "Run git status", kind: "execute" },
          options: [
            { optionId: "allow_once", kind: "allow_once" },
            { optionId: "reject_once", kind: "reject_once" },
          ],
        },
      });
      nativeOutputFrame(sessionId, line, () => onLine!(line));
    };
    const first = sendGrokTurn({
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
      const second = sendGrokTurn({
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
      const third = sendGrokTurn({
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
      respondGrokApproval(sessionId, 771, "allow", approval.occurrenceId);
      await waitFor(
        () => parse().some((message) => message.id === 771 && message.result),
        "A original approval response",
      );
      if (cancelB) await cancelGrokTurn(sessionId, queuedContext);
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
      await stopGrokSession(sessionId);
      await Promise.allSettled(pending);
    }
  },
);
