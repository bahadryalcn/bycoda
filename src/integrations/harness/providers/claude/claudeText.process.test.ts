import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn((sessionId: string) => Object.freeze({ sessionId })),
  resolve: vi.fn(async () => ({ path: "/fake/claude" })),
  spawn: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
  callbacks: new Map<object, (line: string) => void>(),
}));
vi.mock("../../core/child", () => ({
  createChildProcessHandle: mocks.create,
  resolveClaudeBinary: mocks.resolve,
  watchChild: (child: object, line: (value: string) => void) => mocks.callbacks.set(child, line),
  unwatchChild: (child: object) => mocks.callbacks.delete(child),
  spawnChild: async (...args: unknown[]) => {
    mocks.spawn(...args);
    mocks.callbacks.get(args[0] as object)?.(JSON.stringify({ type: "system", subtype: "init" }));
  },
  writeChild: async (child: object, line: string) => {
    mocks.write(child, line);
    const emit = mocks.callbacks.get(child)!;
    emit(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "answer" }] },
      }),
    );
    emit(JSON.stringify({ type: "result", subtype: "success", is_error: false }));
  },
  killChild: async (child: object) => {
    mocks.kill(child);
  },
}));

const { runClaudeTextPrompt, stopClaudeTextPrompt } = await import("./claudeText");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callbacks.clear();
  mocks.resolve.mockReset().mockResolvedValue({ path: "/fake/claude" });
});
afterEach(() => stopClaudeTextPrompt());

it("keeps Claude raw text writes and final cleanup on the original construction", async () => {
  expect(
    await runClaudeTextPrompt({ cwd: "/repo", model: "claude-haiku-4-5", prompt: "hello" }),
  ).toBe("answer");
  const child = mocks.create.mock.results[0].value;
  expect(mocks.spawn.mock.calls[0][0]).toBe(child);
  expect(mocks.write.mock.calls.every(([target]) => target === child)).toBe(true);
  expect(mocks.kill.mock.calls.every(([target]) => target === child)).toBe(true);
});

it("retires a setup stopped during binary resolution without spawning it or retargeting the next run", async () => {
  let release!: (binary: { path: string }) => void;
  mocks.resolve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = runClaudeTextPrompt({ cwd: "/repo", model: "claude-haiku-4-5", prompt: "old" });
  const rejected = expect(first).rejects.toThrow("stopped");
  await vi.waitFor(() => expect(typeof release).toBe("function"));
  const original = mocks.create.mock.results[0].value;
  await stopClaudeTextPrompt();
  release({ path: "/fake/claude" });
  await rejected;
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.kill.mock.calls.every(([target]) => target === original)).toBe(true);
  expect(
    await runClaudeTextPrompt({ cwd: "/repo", model: "claude-haiku-4-5", prompt: "new" }),
  ).toBe("answer");
  const replacement = mocks.create.mock.results[1].value;
  expect(replacement).not.toBe(original);
  expect(mocks.spawn.mock.calls[0][0]).toBe(replacement);
  expect(mocks.write.mock.calls.every(([target]) => target === replacement)).toBe(true);
});
