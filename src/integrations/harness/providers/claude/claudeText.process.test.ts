import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => ({ path: "/fake/claude" })),
  spawn: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
  hold: false,
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
      if (mocks.hold) return;
      if (line.includes('"/compact"')) return; // tests explicitly deliver its boundary/result
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
  mocks.hold = false;
  mocks.resolve.mockReset().mockResolvedValue({ path: "/fake/claude" });
});
afterEach(() => stopClaudeTextPrompt());
it("scopes a requested output allowance to the isolated child settings and resumes the same identity when it changes", async () => {
  for (const maxOutputTokens of [120, 240])
    await runClaudeTextPrompt({
      cwd: "/chief",
      prompt: "status",
      intent: "plan",
      ephemeral: false,
      threadId: "chief-original",
      maxOutputTokens,
      maxOutputChars: 1000,
    });
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  for (const [index, expected] of [120, 240].entries()) {
    const args = mocks.spawn.mock.calls[index][2] as string[];
    expect(args).toContain("--resume");
    expect(args).toContain("chief-original");
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toMatchObject({
      disableAllHooks: true,
      env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(expected) },
    });
    expect(args).toContain("--strict-mcp-config");
  }
});
it("retires the captured utility on a streamed text bound without waiting for a provider result", async () => {
  mocks.hold = true;
  const pending = runClaudeTextPrompt({ cwd: "/chief", prompt: "status", maxOutputChars: 8 });
  const rejected = expect(pending).rejects.toThrow("provider usage is uncertain");
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  const emit = [...mocks.callbacks.values()][0];
  emit(
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "12345" } },
    }),
  );
  emit(
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "6789" } },
    }),
  );
  await rejected;
  expect(mocks.kill).toHaveBeenCalledTimes(1);
});
it("bounds a non-streamed assistant snapshot before accepting its successful result", async () => {
  await expect(
    runClaudeTextPrompt({ cwd: "/chief", prompt: "status", maxOutputChars: 3 }),
  ).rejects.toThrow("local text allowance");
  expect(mocks.kill).toHaveBeenCalled();
});
it("requires matching compact boundary and successful result before the next isolated prompt", async () => {
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done)),
    receipt = vi.fn(async () => held);
  const result = runClaudeTextPrompt({
    cwd: "/chief",
    prompt: "canonical handoff",
    intent: "plan",
    ephemeral: false,
    threadId: "chief-original",
    compactBefore: true,
    onCompacted: receipt,
  });
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  expect(mocks.write.mock.calls[0][1]).toContain('"/compact"');
  const emit = [...mocks.callbacks.values()][0];
  emit(JSON.stringify({ type: "system", subtype: "compact_boundary", session_id: "wrong-thread" }));
  emit(
    JSON.stringify({ type: "system", subtype: "compact_boundary", session_id: "chief-original" }),
  );
  await Promise.resolve();
  expect(receipt).not.toHaveBeenCalled();
  emit(
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "chief-original",
      is_error: false,
    }),
  );
  await vi.waitFor(() => expect(receipt).toHaveBeenCalledWith({ threadId: "chief-original" }));
  expect(mocks.write).toHaveBeenCalledTimes(1);
  release();
  expect(await result).toBe("answer");
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(mocks.spawn.mock.calls[0][2]).toEqual(
    expect.arrayContaining([
      "--resume",
      "chief-original",
      "--strict-mcp-config",
      "--permission-mode",
      "plan",
    ]),
  );
});
it("does not accept an ordinary or foreign-thread result as compaction proof", async () => {
  for (const foreign of [false, true]) {
    mocks.write.mockClear();
    const receipt = vi.fn(async () => undefined);
    const result = runClaudeTextPrompt({
      cwd: "/chief",
      prompt: "never send",
      intent: "plan",
      ephemeral: false,
      threadId: "chief-original",
      compactBefore: true,
      onCompacted: receipt,
    });
    const rejected = expect(result).rejects.toThrow("compaction");
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const emit = [...mocks.callbacks.values()][0];
    if (foreign)
      emit(
        JSON.stringify({ type: "system", subtype: "compact_boundary", session_id: "wrong-thread" }),
      );
    emit(
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "chief-original",
        is_error: false,
      }),
    );
    await rejected;
    expect(receipt).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  }
});
it("cancels compaction without starting the next reasoning turn", async () => {
  const controller = new AbortController(),
    receipt = vi.fn(async () => undefined);
  const result = runClaudeTextPrompt({
    cwd: "/chief",
    prompt: "never send",
    ephemeral: false,
    threadId: "chief-original",
    compactBefore: true,
    onCompacted: receipt,
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejected;
  expect(receipt).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
it("does not reason when the completed compaction receipt cannot be saved", async () => {
  const result = runClaudeTextPrompt({
    cwd: "/chief",
    prompt: "never send",
    ephemeral: false,
    threadId: "chief-original",
    compactBefore: true,
    onCompacted: async () => {
      throw new Error("receipt disk full");
    },
  });
  const rejected = expect(result).rejects.toThrow("receipt disk full");
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  const emit = [...mocks.callbacks.values()][0];
  emit(
    JSON.stringify({ type: "system", subtype: "compact_boundary", session_id: "chief-original" }),
  );
  emit(
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "chief-original",
      is_error: false,
    }),
  );
  await rejected;
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
it("requires explicit same-thread successful result metadata after the compact boundary", async () => {
  for (const result of [
    { type: "result", subtype: "success", is_error: false },
    { type: "result", session_id: "chief-original", is_error: false },
    { type: "result", session_id: "chief-original", errors: ["cancelled"] },
    { type: "result", session_id: "chief-original", terminal_reason: "aborted_streaming" },
    { type: "result", session_id: "foreign", subtype: "success", is_error: false },
  ]) {
    mocks.write.mockClear();
    const receipt = vi.fn(async () => undefined),
      pending = runClaudeTextPrompt({
        cwd: "/chief",
        prompt: "never send",
        ephemeral: false,
        threadId: "chief-original",
        compactBefore: true,
        onCompacted: receipt,
      });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const emit = [...mocks.callbacks.values()][0];
    emit(
      JSON.stringify({ type: "system", subtype: "compact_boundary", session_id: "chief-original" }),
    );
    emit(JSON.stringify(result));
    await rejected;
    expect(receipt).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  }
});

it("retains a separate isolated provider transcript and resumes only its saved identity", async () => {
  let id = "";
  const save = vi.fn(async (value: string) => {
    id = value;
  });
  await runClaudeTextPrompt({
    cwd: "/chief",
    prompt: "first",
    intent: "plan",
    ephemeral: false,
    onThreadId: save,
  });
  expect(id).toMatch(/^[\da-f-]{36}$/);
  const first = mocks.spawn.mock.calls[0][2] as string[];
  expect(first).toEqual(
    expect.arrayContaining([
      "--session-id",
      id,
      "--strict-mcp-config",
      "--permission-mode",
      "plan",
    ]),
  );
  expect(first).not.toContain("--no-session-persistence");
  expect(JSON.parse(first[first.indexOf("--settings") + 1]).disableAllHooks).toBe(true);
  await runClaudeTextPrompt({
    cwd: "/chief",
    prompt: "next",
    intent: "plan",
    ephemeral: false,
    threadId: id,
    onThreadId: save,
  });
  expect(mocks.spawn.mock.calls[1][2]).toEqual(expect.arrayContaining(["--resume", id]));
  expect(save).toHaveBeenCalledTimes(2);
});

it("awaits the durable provider identity before any prompt or process is started", async () => {
  await expect(
    runClaudeTextPrompt({
      cwd: "/chief",
      prompt: "unsafe without receipt",
      ephemeral: false,
      onThreadId: async () => {
        throw new Error("disk full");
      },
    }),
  ).rejects.toThrow("disk full");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

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
