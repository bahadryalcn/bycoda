import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => ({ path: "/fake/claude" })),
  spawn: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
  callbacks: new Map<string, (line: string) => void>(),
}));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveClaudeBinary: mocks.resolve,
    watchChild: (child: string, line: (value: string) => void) => mocks.callbacks.set(child, line),
    unwatchChild: (child: string) => mocks.callbacks.delete(child),
    spawnChild: async (...args: unknown[]) => {
      mocks.spawn(...args);
      mocks.callbacks.get(args[0] as string)?.(JSON.stringify({ type: "system", subtype: "init" }));
    },
    writeChild: async (child: string, line: string) => {
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
    killChild: async (child: string) => {
      mocks.kill(child);
    },
  }),
);

const { runClaudeTextPrompt, stopClaudeTextPrompt } = await import("./claudeText");

beforeEach(() => {
  processConstructions.reset();
  vi.clearAllMocks();
  mocks.callbacks.clear();
  mocks.resolve.mockReset().mockResolvedValue({ path: "/fake/claude" });
});
afterEach(() => stopClaudeTextPrompt());

it("keeps Claude raw text writes and final cleanup on the original construction", async () => {
  expect(
    await runClaudeTextPrompt({ cwd: "/repo", model: "claude-haiku-4-5", prompt: "hello" }),
  ).toBe("answer");
  const child = processConstructions.created[0];
  expect(processConstructions.operations.find((entry) => entry.kind === "spawn")?.handle).toBe(
    child,
  );
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "write")
      .every((entry) => entry.handle === child),
  ).toBe(true);
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "kill")
      .every((entry) => entry.handle === child),
  ).toBe(true);
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
  const original = processConstructions.created[0];
  await stopClaudeTextPrompt();
  release({ path: "/fake/claude" });
  await rejected;
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "kill")
      .every((entry) => entry.handle === original),
  ).toBe(true);
  expect(
    await runClaudeTextPrompt({ cwd: "/repo", model: "claude-haiku-4-5", prompt: "new" }),
  ).toBe("answer");
  const replacement = processConstructions.created[1];
  expect(replacement).not.toBe(original);
  expect(processConstructions.operations.find((entry) => entry.kind === "spawn")?.handle).toBe(
    replacement,
  );
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "write")
      .every((entry) => entry.handle === replacement),
  ).toBe(true);
});
