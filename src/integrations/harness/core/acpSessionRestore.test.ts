import { beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "./types";
import { JsonRpcResponseError } from "./jsonRpc";

const wire = vi.hoisted(() => ({
  requests: [] as { method: string; params: Record<string, unknown> }[],
  failures: new Map<string, Error>(),
}));

vi.mock("./acp", () => ({
  AcpClient: class {
    async request(method: string, params: Record<string, unknown>) {
      wire.requests.push({ method, params });
      const failure = wire.failures.get(method);
      if (failure) throw failure;
      if (method === "initialize")
        return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
      if (method === "session/new") return { sessionId: "NEW" };
      if (method === "session/prompt") return { stopReason: "end_turn" };
      return {};
    }
    async notify() {}
    async respond() {}
    async respondError() {}
    close() {}
    pushLine() {}
    rejectPending() {}
  },
}));
vi.mock("./child", () => ({
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  resolveFxBinary: async () => ({ path: "/fake/fx" }),
  resolveHermesBinary: async () => ({ path: "/fake/hermes" }),
  spawnChild: async () => {},
  killChild: async () => {},
  watchChild: () => {},
  unwatchChild: () => {},
  writeChild: async () => {},
  readHarnessTextFile: async () => "",
  invokeProviderCommand: async () => [],
}));

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
  wire.requests.length = 0;
  wire.failures.clear();
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
        wire.requests.find(({ method }) => method === "session/prompt")?.params.sessionId,
      ).toBe("OLD");
    } finally {
      await provider.stop(sessionId);
    }
  },
);
