import { afterEach, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  lines: new Map<string, (line: string) => void>(),
  started: false,
}));
vi.mock("../core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  watchChild: (id: string, line: (line: string) => void) => child.lines.set(id, line),
  unwatchChild: (id: string) => child.lines.delete(id),
  killChild: async () => undefined,
  spawnChild: async (id: string) =>
    child.lines.get(id)?.(JSON.stringify({ type: "system", subtype: "init" })),
  writeChild: async (id: string, line: string) => {
    const request = JSON.parse(line);
    if (request.type === "user") {
      child.started = true;
      return;
    }
    if (request.id === undefined) return;
    child.lines.get(id)?.(
      JSON.stringify({
        id: request.id,
        result: request.method === "thread/start" ? { thread: { id: "test" } } : {},
      }),
    );
    if (request.method === "turn/start") child.started = true;
  },
}));

afterEach(() => {
  child.lines.clear();
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
      const abort = new AbortController();
      const promise = run({ cwd: "/repo", prompt: "Text", signal: abort.signal, timeoutMs: 100 });
      const settled = promise.then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      );
      for (let i = 0; i < 100; i++) await Promise.resolve();
      expect(child.started).toBe(true);
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
