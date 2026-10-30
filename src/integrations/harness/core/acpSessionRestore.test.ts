import { beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "./types";
import { processConstructions } from "../providers/processConstruction.testSupport";
import { JsonRpcResponseError } from "./jsonRpc";

const wire = vi.hoisted(() => ({
  requests: [] as { method: string; params: Record<string, unknown> }[],
  failures: new Map<string, Error>(),
  listeners: new Map<string, (line: string) => void>(),
}));

// Actual AcpClient/JsonRpcClient and opaque fixture constructions. Only the
// provider process transport is synthetic; restore decisions use real frames.
vi.mock("./child", () =>
  processConstructions.mock({
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
      const request = JSON.parse(line) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (request.id === undefined || !request.method) return;
      const { method } = request;
      const params = request.params ?? {};
      wire.requests.push({ method, params });
      const receive = wire.listeners.get(sessionId);
      if (!receive) throw new Error("Missing original fixture transport listener");
      const failure = wire.failures.get(method);
      if (failure instanceof JsonRpcResponseError) {
        receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: failure.code, message: failure.message },
          }),
        );
        return;
      }
      // Retain the original fixture's unconfirmed transport failure; it is not
      // transformed into an answered protocol rejection or a resend grant.
      if (failure) throw failure;
      const result =
        method === "initialize"
          ? { protocolVersion: 1, agentCapabilities: { loadSession: true } }
          : method === "session/new"
            ? { sessionId: "NEW" }
            : method === "session/prompt"
              ? { stopReason: "end_turn" }
              : {};
      receive(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    },
    readHarnessTextFile: async () => "",
    invokeProviderCommand: async () => [],
  }),
);

const grok = await import("../providers/grok/grok");
const fx = await import("../providers/fx/fx");
const hermes = await import("../providers/hermes/hermes");
const providers = [
  { name: "grok", bind: grok.bindGrokSession, send: grok.sendGrokTurn, stop: grok.stopGrokSession },
  { name: "fx", bind: fx.bindFxSession, send: fx.sendFxTurn, stop: fx.stopFxSession },
  {
    name: "hermes",
    bind: hermes.bindHermesSession,
    send: hermes.sendHermesTurn,
    stop: hermes.stopHermesSession,
  },
];

beforeEach(() => {
  processConstructions.reset();
  wire.requests.length = 0;
  wire.failures.clear();
  wire.listeners.clear();
});

it.each(providers)(
  "$name preserves a bound session on timeout and retries the original binding",
  async (provider) => {
    const sessionId = `restore-timeout-${provider.name}`;
    const events: HarnessEvent[] = [];
    const input: SendTurnInput = {
      sessionId,
      cwd: "/repo",
      model: `${provider.name}:test-model`,
      modelSettings: {},
      text: "Continue",
      attachments: [],
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    };
    provider.bind(sessionId, "OLD", "/repo");
    wire.failures.set("session/resume", new Error("ACP request timed out"));
    wire.failures.set("session/load", new Error("ACP request timed out"));
    try {
      await expect(provider.send(input)).rejects.toThrow("ACP request timed out");
      expect(
        wire.requests.some(({ method }) => method === "session/new" || method === "session/prompt"),
      ).toBe(false);
      expect(events.some((event) => event.type === "session.providerBound")).toBe(false);
      wire.requests.length = 0;
      wire.failures.clear();
      await provider.send(input);
      expect(
        processConstructions.operations.some(
          (op) => op.kind === "write" && op.writer && op.handle.sessionId === sessionId,
        ),
      ).toBe(true);
      expect(wire.requests.some(({ method }) => method === "session/new")).toBe(false);
      expect(
        wire.requests.find(({ method }) => method === "session/prompt")?.params.sessionId,
      ).toBe("OLD");
    } finally {
      await provider.stop(sessionId);
    }
  },
);

it.each(providers.filter(({ name }) => name !== "hermes"))(
  "$name tries load after an answered resume failure, but never forks on load failure",
  async (provider) => {
    const sessionId = `restore-load-${provider.name}`;
    const input: SendTurnInput = {
      sessionId,
      cwd: "/repo",
      model: `${provider.name}:test-model`,
      modelSettings: {},
      text: "Continue",
      attachments: [],
      runtimeMode: "supervised",
      onEvent: () => {},
    };
    provider.bind(sessionId, "OLD", "/repo");
    wire.failures.set("session/resume", new JsonRpcResponseError("Method not found", -32601));
    wire.failures.set("session/load", new Error("ACP request timed out"));
    try {
      await expect(provider.send(input)).rejects.toThrow("ACP request timed out");
      expect(wire.requests.some(({ method }) => method === "session/load")).toBe(true);
      expect(wire.requests.some(({ method }) => method === "session/new")).toBe(false);
      wire.requests.length = 0;
      wire.failures.delete("session/load");
      await provider.send(input);
      expect(
        processConstructions.operations.some(
          (op) => op.kind === "write" && op.writer && op.handle.sessionId === sessionId,
        ),
      ).toBe(true);
      expect(
        wire.requests.find(({ method }) => method === "session/prompt")?.params.sessionId,
      ).toBe("OLD");
    } finally {
      await provider.stop(sessionId);
    }
  },
);
