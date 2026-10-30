import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Request = {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

const sent: Request[] = [];
let onLine: ((line: string) => void) | undefined;
let output = "Generated text";
let threadCount = 0;
let failTurn = false;
let missingResume = false;
let stallTurn = false;
let stallInterrupt = false;

function receive(message: unknown) {
  onLine?.(JSON.stringify(message));
}

beforeEach(() => {
  processConstructions.reset();
  resolveCodexBinary.mockReset().mockResolvedValue({ path: "/fake/codex" });
  killChild.mockReset().mockResolvedValue(undefined);
});
const resolveCodexBinary = vi.fn(async () => ({ path: "/fake/codex" }));
const killChild = vi.fn(async () => undefined);
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCodexBinary,
    spawnChild: async () => undefined,
    killChild,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      onLine = line;
    },
    writeChild: async (_id: string, line: string) => {
      const request = JSON.parse(line) as Request;
      sent.push(request);
      if (request.id === undefined) return;
      if (request.method === "thread/start") {
        receive({
          id: request.id,
          result: { thread: { id: `thread_${++threadCount}` } },
        });
      } else if (request.method === "thread/resume") {
        receive(
          missingResume
            ? { id: request.id, error: { message: "thread not found" } }
            : {
                id: request.id,
                result: { thread: { id: request.params?.threadId } },
              },
        );
      } else if (request.method === "turn/start") {
        receive({ id: request.id, result: { turn: { id: "turn_1" } } });
        if (stallTurn) return;
        setTimeout(() => {
          receive({
            method: "item/agentMessage/delta",
            params: { delta: output },
          });
          receive({
            method: "turn/completed",
            params: {
              turn: {
                id: "turn_1",
                status: failTurn ? "failed" : "completed",
                ...(failTurn ? { error: { message: "Generation failed" } } : {}),
              },
            },
          });
        }, 0);
      } else if (request.method !== "turn/interrupt" || !stallInterrupt) {
        receive({ id: request.id, result: {} });
      }
    },
  }),
);

vi.mock("../../../../platform/tauri/fs", () => ({
  gitStagedContext: async () => ({
    branch: "helpers",
    summary: "1 file changed",
    patch: "diff",
  }),
  gitRangeContext: async () => ({
    base: "main",
    head: "helpers",
    commitSummary: "Keep helper history clean",
    diffSummary: "1 file changed",
    diffPatch: "diff",
  }),
}));

const { runCodexTextPrompt, stopCodexTextPrompt, warmupCodexText } = await import("./codexText");
const { generateCodexSessionTitle } = await import("./codexTitle");
const { generateCodexCommitMessage, generateCodexBranchName, generateCodexPrContent } =
  await import("./codexGit");

function threadStarts() {
  return sent.filter((request) => request.method === "thread/start");
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  output = "Generated text";
  threadCount = 0;
  failTurn = false;
  missingResume = false;
  stallTurn = false;
  stallInterrupt = false;
});

afterEach(async () => {
  await stopCodexTextPrompt();
  vi.useRealTimers();
});

it("cancels account B while original account A teardown is still held", async () => {
  // Real JSON-RPC client over a protocol fake; no physical process receipt is emulated.
  await warmupCodexText("/repo");
  const original = processConstructions.created[0];
  expect(original).toBeDefined();
  expect(
    processConstructions.operations
      .filter((operation) => operation.kind === "spawn")
      .map((operation) => operation.handle),
  ).toEqual([original]);
  let release!: () => void;
  let entered = false;
  let released = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  killChild.mockImplementationOnce(async () => {
    entered = true;
    await held;
  });
  sent.length = 0;
  const switching = runCodexTextPrompt({
    cwd: "/repo",
    providerAccountId: "account-B",
    prompt: "Never dispatch B",
  }).then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    const cancelled = processConstructions.created[1];
    const stopping = stopCodexTextPrompt();
    await stopping;
    expect(released).toBe(false);
    // B must already own a cancellable handle before A's asynchronous kill finishes.
    expect(cancelled).toBeDefined();
    expect(cancelled).not.toBe(original);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "watch")
        .map((operation) => operation.handle),
    ).toEqual([original, cancelled]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "kill")
        .map((operation) => operation.handle),
    ).toEqual([original, cancelled]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([original]);
    expect(sent).toEqual([]);
    released = true;
    release();
    expect((await switching).error).toEqual(
      expect.objectContaining({ message: expect.stringContaining("startup cancelled") }),
    );
    expect(processConstructions.created).toEqual([original, cancelled]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([original]);
    expect(sent).toEqual([]);
    await expect(
      runCodexTextPrompt({
        cwd: "/repo",
        providerAccountId: "account-C",
        prompt: "Explicit fresh C",
      }),
    ).resolves.toBe("Generated text");
    const fresh = processConstructions.created[2];
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(original);
    expect(fresh).not.toBe(cancelled);
    const spawned = processConstructions.operations.filter(
      (operation) => operation.kind === "spawn",
    );
    expect(spawned.map((operation) => operation.handle)).toEqual([original, fresh]);
    expect(spawned[1].args[3]).toEqual({ provider: "codex", id: "account-C" });
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "write" && operation.handle !== original)
        .every((operation) => operation.handle === fresh),
    ).toBe(true);
    expect(sent.some((request) => request.method === "turn/start")).toBe(true);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "kill").at(-1)
        ?.handle,
    ).toBe(fresh);
  } finally {
    released = true;
    release();
    await stopCodexTextPrompt();
    await switching;
  }
});

it("cancels A before binary resolution and lets B use its own original helper handle", async () => {
  let release!: (value: { path: string }) => void;
  resolveCodexBinary.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = runCodexTextPrompt({ cwd: "/repo", prompt: "Never dispatch A" }).then(
    () => undefined,
    (error: unknown) => error,
  );
  let second: Promise<string> | undefined;
  try {
    await vi.waitFor(() => expect(resolveCodexBinary).toHaveBeenCalledOnce());
    const original = processConstructions.created[0];
    expect(original).toBeDefined();
    await stopCodexTextPrompt();
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "spawn"),
    ).toEqual([]);
    expect(sent).toEqual([]);
    second = runCodexTextPrompt({ cwd: "/repo", prompt: "Dispatch B" });
    void second.catch(() => undefined);
    release({ path: "/late/codex-A" });
    expect(await first).toEqual(
      expect.objectContaining({ message: expect.stringContaining("startup cancelled") }),
    );
    expect(await second).toBe("Generated text");
    const replacement = processConstructions.created[1];
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(original);
    const spawned = processConstructions.operations.filter(
      (operation) => operation.kind === "spawn",
    );
    expect(spawned).toHaveLength(1);
    expect(spawned[0].handle).toBe(replacement);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "write")
        .every((operation) => operation.handle === replacement),
    ).toBe(true);
    const spawnAt = processConstructions.operations.findIndex(
      (operation) => operation.kind === "spawn" && operation.handle === replacement,
    );
    const originalCleanup = processConstructions.operations
      .slice(0, spawnAt)
      .filter((operation) => operation.kind === "kill");
    expect(originalCleanup.length).toBeGreaterThan(0);
    expect(originalCleanup.every((operation) => operation.handle === original)).toBe(true);
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "kill").at(-1)
        ?.handle,
    ).toBe(replacement);
  } finally {
    release?.({ path: "/late/codex-A" });
    await stopCodexTextPrompt();
  }
});

it.each(["timeout", "abort"] as const)(
  "releases the helper queue after %s even if the provider never acknowledges interrupt",
  async (outcome) => {
    vi.useFakeTimers();
    stallTurn = true;
    stallInterrupt = true;
    const controller = new AbortController();
    const first = runCodexTextPrompt({
      cwd: "/repo",
      prompt: "First request",
      timeoutMs: 100,
      signal: controller.signal,
    }).then(
      () => undefined,
      (error: Error) => error,
    );
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(1);
    if (outcome === "abort") controller.abort();
    else await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(sent.some((request) => request.method === "turn/interrupt")).toBe(true);

    stallTurn = false;
    const second = runCodexTextPrompt({ cwd: "/repo", prompt: "Next request" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await first).toBeInstanceOf(Error);
    await expect(second).resolves.toBe(output);
    expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([
  {
    name: "session titles",
    response: { title: "Keep Helper History Clean", workItem: null },
    run: () =>
      generateCodexSessionTitle({
        sessionId: "session",
        cwd: "/repo",
        message: "Keep helper history clean",
      }),
    expected: { title: "Keep Helper History Clean", workItem: null },
  },
  {
    name: "commit messages",
    response: { subject: "Keep helper history clean", body: "" },
    run: () => generateCodexCommitMessage("/repo"),
    expected: "Keep helper history clean",
  },
  {
    name: "branch names",
    response: { branch: "keep-helper-history-clean" },
    run: () => generateCodexBranchName("/repo", "Keep helper history clean"),
    expected: "keep-helper-history-clean",
  },
  {
    name: "PR content",
    response: {
      title: "Keep helper history clean",
      body: "## Summary\n- Use unsaved threads",
    },
    run: () => generateCodexPrContent("/repo"),
    expected: {
      title: "Keep helper history clean",
      body: "## Summary\n- Use unsaved threads",
      base: "main",
      head: "helpers",
    },
  },
])("generates $name without saving a Codex conversation", async ({ response, run, expected }) => {
  output = JSON.stringify(response);
  await expect(run()).resolves.toEqual(expected);
  expect(threadStarts()).toHaveLength(1);
  expect(threadStarts()[0].params).toMatchObject({ ephemeral: true });
  expect(sent.some((request) => request.method === "thread/resume")).toBe(false);
});

it("keeps warmup and subsequent prompts unsaved across model changes", async () => {
  await warmupCodexText("/repo");
  await expect(
    runCodexTextPrompt({
      cwd: "/repo",
      model: "test-model",
      prompt: "Generate text",
    }),
  ).resolves.toBe(output);
  await expect(runCodexTextPrompt({ cwd: "/repo", prompt: "Generate more text" })).resolves.toBe(
    output,
  );
  expect(threadStarts()).toHaveLength(3);
  expect(threadStarts().every((request) => request.params?.ephemeral === true)).toBe(true);
});

it("does not resume a stored thread for an unsaved text request", async () => {
  await runCodexTextPrompt({
    cwd: "/repo",
    threadId: "stored_thread",
    prompt: "Generate text",
  });
  expect(sent.some((request) => request.method === "thread/resume")).toBe(false);
  expect(threadStarts()[0].params).toMatchObject({ ephemeral: true });
});

it("allows side questions to explicitly retain and resume their thread", async () => {
  const onThreadId = vi.fn();
  await warmupCodexText("/repo");
  await runCodexTextPrompt({
    cwd: "/repo",
    ephemeral: false,
    onThreadId,
    prompt: "Side question",
  });
  expect(threadStarts()).toHaveLength(2);
  expect(threadStarts()[0].params).toMatchObject({ ephemeral: true });
  expect(threadStarts()[1].params).not.toHaveProperty("ephemeral");
  expect(onThreadId).toHaveBeenCalledWith("thread_2");

  await runCodexTextPrompt({
    cwd: "/repo",
    ephemeral: false,
    threadId: "thread_2",
    prompt: "Follow-up",
  });
  expect(sent.find((request) => request.method === "thread/resume")?.params).toMatchObject({
    threadId: "thread_2",
  });
  expect(threadStarts()).toHaveLength(2);
});

it("retains resumable behavior when a side question's saved thread is missing", async () => {
  missingResume = true;
  await runCodexTextPrompt({
    cwd: "/repo",
    ephemeral: false,
    threadId: "missing_thread",
    prompt: "Side question",
  });
  expect(threadStarts()).toHaveLength(1);
  expect(threadStarts()[0].params).not.toHaveProperty("ephemeral");
});

it("keeps a failed generation and its retry unsaved", async () => {
  failTurn = true;
  await expect(runCodexTextPrompt({ cwd: "/repo", prompt: "Generate text" })).rejects.toThrow(
    "Generation failed",
  );
  failTurn = false;
  await expect(runCodexTextPrompt({ cwd: "/repo", prompt: "Retry" })).resolves.toBe(output);
  expect(threadStarts()).toHaveLength(2);
  expect(threadStarts().every((request) => request.params?.ephemeral === true)).toBe(true);
});
