import { beforeEach, expect, it, vi } from "vitest";
import type { AcpHandlers } from "./acp";
import type { HarnessEvent, SendTurnInput } from "./types";
import { applyHarnessEvent } from "./apply";
import { newSession } from "../../../features/sessions/model/session";

const wire = vi.hoisted(() => ({
  stopReason: "end_turn" as string | undefined,
  prompts: 0,
  sessions: 0,
}));
vi.mock("./acp", () => ({
  AcpClient: class {
    constructor(
      _id: string,
      private handlers: AcpHandlers,
    ) {}
    async request(method: string) {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        wire.sessions++;
        return { sessionId: "provider-thread" };
      }
      if (method === "session/prompt") {
        wire.prompts++;
        this.handlers.onNotification?.("session/update", {
          sessionId: "provider-thread",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Partial answer" },
          },
        });
        return { stopReason: wire.stopReason };
      }
      return {};
    }
    async notify() {}
    async respond() {}
    async respondError() {}
    close() {}
  },
}));
vi.mock("./child", () => ({
  resolveCursorBinary: async () => ({ path: "/fake/cursor" }),
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  resolveFxBinary: async () => ({ path: "/fake/fx" }),
  resolveHermesBinary: async () => ({ path: "/fake/hermes" }),
  spawnChild: async () => {},
  killChild: async () => {},
  watchChild: () => {},
  unwatchChild: () => {},
  readHarnessTextFile: async () => "",
  invokeProviderCommand: async () => [],
}));
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
  wire.prompts = 0;
  wire.sessions = 0;
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
