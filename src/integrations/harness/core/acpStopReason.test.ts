import { beforeEach, expect, it, vi } from "vitest";
import { processConstructions } from "../providers/processConstruction.testSupport";
import type { HarnessEvent, SendTurnInput } from "./types";
import { applyHarnessEvent } from "./apply";
import { newSession } from "../../../features/sessions/model/session";

const wire = vi.hoisted(() => ({
  stopReason: "end_turn" as string | undefined,
  prompts: 0,
  sessions: 0,
  listeners: new Map<string, (line: string) => void>(),
}));
// Actual protocol parsing, multiplexing and writer views; only the provider
// process transport below is a protocol fixture, not physical Native proof.
vi.mock("./child", () =>
  processConstructions.mock({
    resolveCursorBinary: async () => ({ path: "/fake/cursor" }),
    resolveGrokBinary: async () => ({ path: "/fake/grok" }),
    resolveFxBinary: async () => ({ path: "/fake/fx" }),
    resolveHermesBinary: async () => ({ path: "/fake/hermes" }),
    spawnChild: async () => {},
    killChild: async (sessionId: string) => {
      wire.listeners.delete(sessionId);
    },
    watchChild: (sessionId: string, onLine: (line: string) => void) => {
      wire.listeners.set(sessionId, onLine);
    },
    unwatchChild: (sessionId: string) => {
      wire.listeners.delete(sessionId);
    },
    writeChild: async (sessionId: string, line: string) => {
      const request = JSON.parse(line) as { id?: number; method?: string };
      if (request.id === undefined || !request.method) return;
      const receive = wire.listeners.get(sessionId);
      if (!receive) throw new Error("Missing original fixture transport listener");
      let result: unknown = {};
      if (request.method === "initialize") result = { protocolVersion: 1 };
      if (request.method === "session/new") {
        wire.sessions++;
        result = { sessionId: "provider-thread" };
      }
      if (request.method === "session/prompt") {
        wire.prompts++;
        receive(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "provider-thread",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Partial answer" },
              },
            },
          }),
        );
        result = { stopReason: wire.stopReason };
      }
      receive(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    },
    readHarnessTextFile: async () => "",
    invokeProviderCommand: async () => [],
  }),
);
vi.mock("../providers/cursor/cursorStore", () => ({
  readStoredCursorToolCalls: async () => [],
  readStoredCursorSubagentRuns: async () => [],
}));

const cursor = await import("../providers/cursor/cursor");
const grok = await import("../providers/grok/grok");
const fx = await import("../providers/fx/fx");
const hermes = await import("../providers/hermes/hermes");
const generic = await import("../providers/generic-acp/genericAcpAdapter");
const providers = [
  { name: "cursor", send: cursor.sendCursorTurn, stop: cursor.stopCursorSession },
  { name: "grok", send: grok.sendGrokTurn, stop: grok.stopGrokSession },
  { name: "fx", send: fx.sendFxTurn, stop: fx.stopFxSession },
  { name: "hermes", send: hermes.sendHermesTurn, stop: hermes.stopHermesSession },
  { name: "acp", send: generic.sendGenericAcpTurn, stop: generic.forgetGenericAcpSession },
];
beforeEach(() => {
  processConstructions.reset();
  wire.prompts = 0;
  wire.sessions = 0;
  wire.listeners.clear();
});

for (const reason of [
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "end_turn",
  "cancelled",
  undefined,
]) {
  it.each(providers)(
    `$name preserves streamed output and explains ${reason ?? "legacy completion"}`,
    async (provider) => {
      wire.stopReason = reason;
      const events: HarnessEvent[] = [];
      const sessionId = `stop-reason-${provider.name}-${reason ?? "legacy"}`;
      const input: SendTurnInput = {
        sessionId,
        cwd: "/repo",
        model: `${provider.name}:test`,
        text: "Answer",
        attachments: [],
        runtimeMode: "supervised",
        onEvent: (event) => events.push(event),
      };
      try {
        await expect(provider.send(input)).resolves.toBeUndefined();
        expect(
          processConstructions.operations.some(
            (op) => op.kind === "write" && op.writer && op.handle.sessionId === sessionId,
          ),
        ).toBe(true);
        expect(wire.prompts).toBe(1);
        expect(events.filter((event) => event.type === "message.completed")).toHaveLength(1);
        const session = events.reduce(applyHarnessEvent, newSession("codex", "/repo"));
        expect(session.blocks.find((block) => block.role === "assistant")).toMatchObject({
          text: "Partial answer",
          streaming: false,
        });
        if (reason && !["end_turn", "cancelled"].includes(reason)) {
          expect(session.blocks).toContainEqual(
            expect.objectContaining({
              role: "system",
              notice: "error",
              text: expect.stringContaining(reason),
            }),
          );
          const failureIndex = events.findIndex((event) => event.type === "session.error");
          expect(failureIndex).toBeGreaterThan(
            events.findIndex((event) => event.type === "message.completed"),
          );
          expect(events[failureIndex]).toMatchObject({
            message: expect.stringMatching(reason === "refusal" ? /Revise/ : /continue/),
          });
          events.length = 0;
          wire.stopReason = "end_turn";
          await provider.send({ ...input, text: "Continue the partial answer" });
          expect(wire.prompts).toBe(2);
          expect(wire.sessions).toBe(1);
          expect(events.some((event) => event.type === "session.error")).toBe(false);
        } else {
          expect(events.some((event) => event.type === "session.error")).toBe(false);
        }
      } finally {
        await provider.stop(sessionId);
      }
    },
  );
}
