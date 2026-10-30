import { processConstructions } from "../processConstruction.testSupport";
import {
  nativeOutputFrame,
  captureNativeOutputEvent,
  getNativeOutputEventOrigin,
} from "../../core/nativeOutputDelivery.testSupport";
import { describe, expect, it, vi, beforeEach } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number | null) => void) | undefined;
let queueAgent: ((message: Record<string, unknown>) => void) | null = null;

beforeEach(() => {
  processConstructions.reset();
  queueAgent = null;
});
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveFxBinary: async () => ({ path: "/fake/fx" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (l: string) => void, exit: (c: number | null) => void) => {
      onLine = line;
      onExit = exit;
    },
    writeChild: async (_id: string, line: string) => {
      sent.push(line);
      queueAgent?.(JSON.parse(line));
    },
  }),
);

const { sendFxTurn, stopFxSession, cancelFxTurn } = await import("./fx");
import type { HarnessEvent } from "../../core/types";

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
function notify(update: unknown) {
  onLine!(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "S1", update },
    }),
  );
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

describe("fx live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("auto-approves a permission request instead of blocking the turn", async () => {
    const events: HarnessEvent[] = [];
    const input = {
      sessionId: "t1",
      cwd: "/repo",
      model: "fx:zai/glm-5.2",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      text: "hey",
      attachments: [],
      onEvent: (e: HarnessEvent) => events.push(e),
    };

    const turn1 = sendFxTurn(input as never);
    await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
    reply(parse().find((m) => m.method === "initialize")!.id, {
      protocolVersion: 1,
    });
    await waitFor(() => parse().some((m) => m.method === "session/new"), "session/new");
    reply(parse().find((m) => m.method === "session/new")!.id, {
      sessionId: "S1",
      configOptions: [
        { id: "provider", category: "model", currentValue: "gateway" },
        { id: "model", category: "model", currentValue: "zai/glm-5.2" },
        { id: "mode", category: "mode", currentValue: "ask" },
      ],
    });
    // model already matches -> set_config_option is skipped; set_mode then prompt
    await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "set_mode t1");
    reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t1");
    reply(parse().find((m) => m.method === "session/prompt")!.id, {
      stopReason: "end_turn",
    });
    await turn1;
    console.log(
      "TURN 1 OK, messages:",
      parse().map((m) => m.method ?? `reply:${m.id}`),
    );

    // ---- turn 2 ----
    sent.length = 0;
    const turn2 = sendFxTurn({ ...input, text: "check the repo" } as never);
    await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "set_mode t2");
    reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t2");
    const promptId = parse().find((m) => m.method === "session/prompt")!.id;
    console.log(
      "turn2 outbound ids:",
      parse().map((m) => `${m.method}=${m.id}`),
    );

    notify({
      sessionUpdate: "tool_call",
      toolCallId: "call_a",
      title: "Running",
      kind: "execute",
      status: "pending",
    });

    // fx numbers its OWN requests from 1
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {
          sessionId: "S1",
          toolCall: {
            toolCallId: "call_a",
            title: "terminal.exec git status -s",
            kind: "execute",
            status: "pending",
            rawInput: {
              action: "exec",
              command: "git status -s",
              cwd: "/repo",
            },
          },
          options: [
            { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
            {
              optionId: "allow_always",
              name: "Allow for this session",
              kind: "allow_always",
            },
            { optionId: "reject_once", name: "Reject", kind: "reject_once" },
          ],
        },
      }),
    );

    await waitFor(() => parse().some((m) => m.id === 1 && m.result), "auto permission response");
    const response = parse().find((m) => m.id === 1 && m.result);
    console.log("auto-approved without any UI round trip:", JSON.stringify(response));
    expect(response.result.outcome.optionId).toBe("allow_always");
    expect(
      events.some((e) => e.type === "approval.requested"),
      "fx must never park a turn on an approval",
    ).toBe(false);

    reply(promptId, { stopReason: "end_turn" });
    await turn2;
    await stopFxSession("t1");
  });

  it("routes a late exit to the current turn's listener, not turn 1's", async () => {
    const turn1Events: HarnessEvent[] = [];
    const turn2Events: HarnessEvent[] = [];
    const base = {
      sessionId: "t2",
      cwd: "/repo",
      model: "fx:zai/glm-5.2",
      modelSettings: {},
      runtimeMode: "supervised" as const,
      attachments: [],
    };

    const turn1 = sendFxTurn({
      ...base,
      text: "hey",
      onEvent: (e: HarnessEvent) => turn1Events.push(e),
    } as never);
    await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
    reply(parse().find((m) => m.method === "initialize")!.id, {
      protocolVersion: 1,
    });
    await waitFor(() => parse().some((m) => m.method === "session/new"), "session/new");
    reply(parse().find((m) => m.method === "session/new")!.id, {
      sessionId: "S2",
      configOptions: [{ id: "model", category: "model", currentValue: "zai/glm-5.2" }],
    });
    await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "set_mode t1");
    reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t1");
    reply(parse().find((m) => m.method === "session/prompt")!.id, {
      stopReason: "end_turn",
    });
    await turn1;

    // Turn 2 registers a new listener; fx then dies mid-turn.
    sent.length = 0;
    const turn2 = sendFxTurn({
      ...base,
      text: "again",
      onEvent: (e: HarnessEvent) => turn2Events.push(e),
    } as never);
    await waitFor(() => parse().some((m) => m.method === "session/set_mode"), "set_mode t2");
    reply(parse().find((m) => m.method === "session/set_mode")!.id, {});
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt t2");
    onExit!(1);
    await turn2.catch(() => undefined);

    expect(
      turn2Events.some((e) => e.type === "session.ended"),
      "session.ended must reach the turn that is actually running",
    ).toBe(true);
    expect(turn1Events.some((e) => e.type === "session.ended")).toBe(false);
    await stopFxSession("t2");
  });
});

it("retains fx completion lineage from the real RPC response across its await", async () => {
  sent.length = 0;
  const sessionId = "fx-causal-response";
  const events: HarnessEvent[] = [];
  const done = sendFxTurn({
    sessionId,
    cwd: "/repo",
    model: "fx:zai/glm-5.2",
    runtimeMode: "supervised",
    text: "hi",
    attachments: [],
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });
  await waitFor(() => parse().some((m) => m.method === "initialize"), "init");
  reply(parse().find((m) => m.method === "initialize")!.id, { protocolVersion: 1 });
  await waitFor(() => parse().some((m) => m.method === "session/new"), "new");
  reply(parse().find((m) => m.method === "session/new")!.id, {
    sessionId: "S1",
    configOptions: [
      { id: "model", category: "model", currentValue: "zai/glm-5.2" },
      { id: "mode", category: "mode", currentValue: "ask" },
    ],
  });
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
  await stopFxSession(sessionId);
});

it.each([true, false])(
  "preserves fx A's callback and permission policy while B is queued (cancel B: %s)",
  async (cancelB) => {
    // Production provider/client/queue; only the child transport is the existing
    // protocol fixture. No physical Native/provider retirement is asserted.
    sent.length = 0;
    const sessionId = `fx-queue-${cancelB}`;
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
                sessionId: "S1",
                models: { currentModelId: "zai/glm-5.2" },
                configOptions: [
                  { id: "model", category: "model", currentValue: "zai/glm-5.2" },
                  { id: "mode", category: "mode", currentValue: "ask" },
                ],
              }
            : {};
      reply(message.id, result);
    };
    const base = {
      sessionId,
      cwd: "/repo",
      model: "fx:zai/glm-5.2",
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
    const first = sendFxTurn({
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
      const second = sendFxTurn({
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
      const third = sendFxTurn({
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
        () => parse().some((message) => message.id === 771 && message.result),
        "A ordinary automatic permission",
      );
      expect(permissionResponse(771)?.outcome.optionId).toBe("allow_once");
      if (cancelB) await cancelFxTurn(sessionId, queuedContext);
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
      await stopFxSession(sessionId);
      await Promise.allSettled(pending);
    }
  },
);
