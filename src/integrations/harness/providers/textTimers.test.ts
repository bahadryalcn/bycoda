import { processConstructions } from "./processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  lines: new Map<string, (line: string) => void>(),
  started: false,
  args: new Map<string, string[]>(),
  requests: [] as string[],
}));
beforeEach(() => processConstructions.reset());
vi.mock("../core/child", () =>
  processConstructions.mock({
    resolveCodexBinary: async () => ({ path: "/fake/codex" }),
    resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
    watchChild: (id: string, line: (line: string) => void) => child.lines.set(id, line),
    unwatchChild: (id: string) => child.lines.delete(id),
    killChild: async (id: string) => {
      child.lines.delete(id);
    },
    spawnChild: async (id: string, _command: string, args: string[]) => {
      child.args.set(id, args);
      child.lines.get(id)?.(JSON.stringify({ type: "system", subtype: "init" }));
    },
    writeChild: async (id: string, line: string) => {
      const request = JSON.parse(line);
      if (request.type === "user") {
        child.started = true;
        return;
      }
      if (request.id === undefined) return;
      child.requests.push(request.method);
      const overrides: Record<string, unknown> = {};
      const args = child.args.get(id) ?? [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] !== "-c") continue;
        const value = args[++index],
          equal = value.indexOf("=");
        overrides[value.slice(0, equal)] = JSON.parse(value.slice(equal + 1));
      }
      child.lines.get(id)?.(
        JSON.stringify({
          id: request.id,
          result:
            request.method === "config/read"
              ? {
                  config: {
                    web_search: overrides.web_search,
                    features: Object.fromEntries(
                      Object.entries(overrides)
                        .filter(([key]) => key.startsWith("features."))
                        .map(([key, value]) => [key.slice(9), value]),
                    ),
                  },
                }
              : request.method === "mcpServerStatus/list"
                ? { data: [], nextCursor: null }
                : request.method === "thread/start"
                  ? { thread: { id: "test" } }
                  : {},
        }),
      );
      if (request.method === "turn/start") child.started = true;
    },
  }),
);

afterEach(() => {
  child.lines.clear();
  child.args.clear();
  child.requests.length = 0;
  child.started = false;
  vi.useRealTimers();
});
it.each(["codex", "claude"] as const)(
  "cleans %s generation deadlines on every exit",
  async (provider) => {
    const run =
      provider === "codex"
        ? (await import("./codex/codexText")).runCodexTextPrompt
        : (await import("./claude/claudeText")).runClaudeTextPrompt;
    vi.useFakeTimers();
    for (const outcome of ["success", "failure", "abort", "timeout"]) {
      child.started = false;
      child.requests.length = 0;
      const abort = new AbortController();
      const promise = run({ cwd: "/repo", prompt: "Text", signal: abort.signal, timeoutMs: 100 });
      const settled = promise.then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      );
      for (let i = 0; i < 100; i++) await Promise.resolve();
      expect(child.started).toBe(true);
      if (provider === "codex") {
        expect(child.requests).toContain("config/read");
        expect(child.requests.indexOf("mcpServerStatus/list")).toBeGreaterThan(
          child.requests.indexOf("thread/start"),
        );
        expect(child.requests.indexOf("turn/start")).toBeGreaterThan(
          child.requests.indexOf("mcpServerStatus/list"),
        );
      }
      const receive = child.lines.get(`bycoda-${provider}-text`)!;
      if (outcome === "abort") abort.abort();
      else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(100);
      else if (provider === "codex") {
        receive(JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "Text" } }));
        receive(
          JSON.stringify({
            method: "turn/completed",
            params: {
              turn: {
                id: "turn",
                status: outcome === "failure" ? "failed" : "completed",
                error: { message: "Failed" },
              },
            },
          }),
        );
      } else {
        receive(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Text" }] },
          }),
        );
        receive(
          JSON.stringify({
            type: "result",
            is_error: outcome === "failure",
            subtype: outcome === "failure" ? "error_during_execution" : "success",
          }),
        );
      }
      const result = await settled;
      expect("error" in result).toBe(outcome !== "success");
      expect(vi.getTimerCount()).toBe(0);
    }
  },
);
