import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CODEX_UTILITY_DISABLED_FEATURES,
  CODEX_UTILITY_CONFIG,
  codexUtilitySpawnArgs,
} from "./codexUtilityIsolation";

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
let holdCompactAck = false;
let holdTurnAck = false;
let unsafeMcp = false;
let unsafeBuiltins = false;

function receive(message: unknown) {
  onLine?.(JSON.stringify(message));
}
it("interrupts and retires bounded streamed output without adding an unsupported provider token field", async () => {
  stallTurn = true;
  const pending = runCodexTextPrompt({
    cwd: "/chief",
    prompt: "status",
    maxOutputTokens: 2,
    maxOutputChars: 5,
  });
  const rejected = expect(pending).rejects.toThrow("provider usage is uncertain");
  await vi.waitFor(() =>
    expect(sent.some((request) => request.method === "turn/start")).toBe(true),
  );
  const start = sent.find((request) => request.method === "turn/start")!.params!;
  expect(start).not.toHaveProperty("maxOutputTokens");
  expect(start).not.toHaveProperty("max_output_tokens");
  receive({ method: "item/agentMessage/delta", params: { delta: "123456" } });
  await rejected;
  expect(sent.some((request) => request.method === "turn/interrupt")).toBe(true);
  expect(killChild).toHaveBeenCalled();
  stallTurn = false;
  output = "ok";
  expect(
    await runCodexTextPrompt({
      cwd: "/chief",
      prompt: "fresh",
      maxOutputChars: 2,
    }),
  ).toBe("ok");
});
it("interrupts excessive output while the original turn start acknowledgement is still delayed", async () => {
  stallTurn = true;
  holdTurnAck = true;
  const pending = runCodexTextPrompt({
    cwd: "/chief",
    prompt: "status",
    maxOutputChars: 3,
  });
  const rejected = expect(pending).rejects.toThrow("local text allowance");
  await vi.waitFor(() =>
    expect(sent.some((request) => request.method === "turn/start")).toBe(true),
  );
  receive({
    method: "item/agentMessage/delta",
    params: { delta: "oversized" },
  });
  await rejected;
  expect(killChild).toHaveBeenCalled();
});
it.each([
  "commandExecution",
  "webSearch",
  "mcpToolCall",
  "collabAgentToolCall",
  "imageView",
  "browserToolCall",
  "unknownFutureTool",
])(
  "discards an unexpected %s notification instead of accepting its eventual decision",
  async (type) => {
    stallTurn = true;
    const onEvent = vi.fn();
    const pending = runCodexTextPrompt({
      cwd: "/chief",
      prompt: "finite JSON only",
      onEvent,
    });
    const rejected = expect(pending).rejects.toThrow("unexpected utility tool");
    await vi.waitFor(() =>
      expect(sent.some((request) => request.method === "turn/start")).toBe(true),
    );
    receive({
      method: "item/started",
      params: {
        item: {
          id: "unexpected",
          type,
          command: "private command must not become public output",
        },
      },
    });
    await rejected;
    expect(killChild).toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  },
);
it("denies an approval request and stops the exact utility instead of granting it or continuing reasoning", async () => {
  stallTurn = true;
  const pending = runCodexTextPrompt({
    cwd: "/chief",
    prompt: "finite JSON only",
  });
  const rejected = expect(pending).rejects.toThrow("unexpected utility tool");
  await vi.waitFor(() =>
    expect(sent.some((request) => request.method === "turn/start")).toBe(true),
  );
  receive({
    id: 900,
    method: "item/commandExecution/requestApproval",
    params: { command: "never execute" },
  });
  await rejected;
  expect(sent.find((request) => request.id === 900)).toMatchObject({
    result: { decision: "decline" },
  });
  expect(killChild).toHaveBeenCalled();
});
it("rechecks required builtin gates before reusing a warm exact utility thread", async () => {
  await runCodexTextPrompt({
    cwd: "/chief",
    prompt: "First",
    ephemeral: false,
    threadId: "chief-original",
  });
  const starts = sent.filter((request) => request.method === "turn/start").length;
  unsafeBuiltins = true;
  await expect(
    runCodexTextPrompt({
      cwd: "/chief",
      prompt: "Never send",
      ephemeral: false,
      threadId: "chief-original",
    }),
  ).rejects.toThrow("isolation");
  expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(starts);
  expect(killChild).toHaveBeenCalled();
});
function compactNotifications(id: string, status: string | undefined) {
  const threadId = "chief-original";
  receive({ method: "turn/started", params: { threadId, turn: { id } } });
  for (const method of ["item/started", "item/completed"])
    receive({
      method,
      params: {
        threadId,
        turnId: id,
        item: { type: "contextCompaction", id: "compact-item" },
      },
    });
  receive({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id, ...(status === undefined ? {} : { status }) },
    },
  });
}

beforeEach(() => {
  holdCompactAck = false;
  holdTurnAck = false;
  unsafeMcp = false;
  unsafeBuiltins = false;
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
      if (request.method === "config/read") {
        receive({
          id: request.id,
          result: {
            config: {
              mcp_servers: { fixture: { command: "never-run" } },
              web_search: "disabled",
              features: {
                ...Object.fromEntries(CODEX_UTILITY_DISABLED_FEATURES.map((name) => [name, false])),
                ...(unsafeBuiltins ? { shell_tool: true } : {}),
              },
            },
          },
        });
      } else if (request.method === "mcpServerStatus/list") {
        receive({
          id: request.id,
          result: {
            data: [
              {
                name: "fixture",
                runtimeStatus: unsafeMcp ? "ready" : "disabled",
                tools: unsafeMcp ? { external_write: {} } : {},
                resources: [],
                resourceTemplates: [],
              },
            ],
            nextCursor: null,
          },
        });
      } else if (request.method === "thread/start") {
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
      } else if (request.method === "thread/compact/start") {
        if (!holdCompactAck) receive({ id: request.id, result: {} });
      } else if (request.method === "turn/start") {
        if (!holdTurnAck) receive({ id: request.id, result: { turn: { id: "turn_1" } } });
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

it("does not submit a turn until the exact provider thread receipt is durable", async () => {
  await expect(
    runCodexTextPrompt({
      cwd: "/chief",
      prompt: "owner work",
      ephemeral: false,
      onThreadId: async () => {
        throw new Error("receipt write failed");
      },
    }),
  ).rejects.toThrow("receipt write failed");
  expect(threadStarts()).toHaveLength(1);
  expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(0);
});
it("isolates utility start/resume config and never sends reasoning while inherited MCP tools remain enabled", async () => {
  await runCodexTextPrompt({
    cwd: "/chief",
    prompt: "First",
    ephemeral: false,
    threadId: "chief-original",
  });
  const spawn = processConstructions.operations.find((operation) => operation.kind === "spawn")!;
  expect(spawn.args[1]).toEqual(codexUtilitySpawnArgs());
  expect(sent.find((request) => request.method === "thread/resume")?.params?.config).toEqual({
    ...CODEX_UTILITY_CONFIG,
    mcp_servers: { fixture: { enabled: false } },
  });
  const turnsBefore = sent.filter((request) => request.method === "turn/start").length;
  unsafeMcp = true;
  await expect(
    runCodexTextPrompt({
      cwd: "/chief",
      prompt: "Never send",
      ephemeral: false,
      threadId: "chief-original",
    }),
  ).rejects.toThrow("isolation");
  expect(sent.filter((request) => request.method === "turn/start")).toHaveLength(turnsBefore);
  expect(killChild).toHaveBeenCalled();
});

it("compacts the same isolated thread and waits for exact completion and durable acknowledgement before reasoning", async () => {
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done));
  const saved = vi.fn(async () => held);
  const result = runCodexTextPrompt({
    cwd: "/chief",
    prompt: "canonical handoff",
    intent: "plan",
    ephemeral: false,
    threadId: "chief-original",
    compactBefore: true,
    onCompacted: saved,
  });
  await vi.waitFor(() =>
    expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
  );
  expect(sent.find((value) => value.method === "thread/compact/start")?.params).toEqual({
    threadId: "chief-original",
  });
  receive({
    method: "turn/started",
    params: { threadId: "other", turn: { id: "foreign" } },
  });
  receive({
    method: "turn/completed",
    params: { threadId: "other", turn: { id: "foreign", status: "completed" } },
  });
  receive({
    method: "turn/started",
    params: { threadId: "chief-original", turn: { id: "compact-1" } },
  });
  receive({
    method: "turn/completed",
    params: {
      threadId: "chief-original",
      turn: { id: "old-turn", status: "completed" },
    },
  });
  for (const method of ["item/started", "item/completed"])
    receive({
      method,
      params: {
        threadId: "chief-original",
        turnId: "compact-1",
        item: { type: "contextCompaction", id: "compact-item" },
      },
    });
  await Promise.resolve();
  expect(saved).not.toHaveBeenCalled();
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
  receive({
    method: "turn/completed",
    params: {
      threadId: "chief-original",
      turn: { id: "compact-1", status: "completed" },
    },
  });
  await vi.waitFor(() => expect(saved).toHaveBeenCalledWith({ threadId: "chief-original" }));
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
  release();
  expect(await result).toBe(output);
  expect(sent.filter((value) => value.method === "thread/start")).toHaveLength(0);
});
it("never reasons after a failed or cancelled compaction", async () => {
  for (const cancel of [false, true]) {
    sent.length = 0;
    const controller = new AbortController(),
      saved = vi.fn(async () => undefined);
    const result = runCodexTextPrompt({
      cwd: "/chief",
      prompt: "never send",
      ephemeral: false,
      threadId: "chief-original",
      compactBefore: true,
      onCompacted: saved,
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow();
    await vi.waitFor(() =>
      expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
    );
    if (cancel) controller.abort();
    else compactNotifications("compact-failed", "failed");
    await rejected;
    expect(saved).not.toHaveBeenCalled();
    expect(sent.some((value) => value.method === "turn/start")).toBe(false);
  }
});
it("does not mistake a compaction start acknowledgement for completion", async () => {
  const saved = vi.fn(async () => undefined);
  const result = runCodexTextPrompt({
    cwd: "/chief",
    prompt: "never send",
    ephemeral: false,
    threadId: "chief-original",
    compactBefore: true,
    onCompacted: saved,
    timeoutMs: 30,
  });
  await expect(result).rejects.toThrow("compaction timed out");
  expect(saved).not.toHaveBeenCalled();
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
});
it("does not reason when saving the compaction receipt fails", async () => {
  const result = runCodexTextPrompt({
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
  await vi.waitFor(() =>
    expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
  );
  compactNotifications("compact-1", "completed");
  await rejected;
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
});
it("binds completion to the RPC turn id despite an unrelated same-thread turn arriving before acknowledgement", async () => {
  holdCompactAck = true;
  const receipt = vi.fn(async () => undefined),
    result = runCodexTextPrompt({
      cwd: "/chief",
      prompt: "canonical handoff",
      ephemeral: false,
      threadId: "chief-original",
      compactBefore: true,
      onCompacted: receipt,
    });
  await vi.waitFor(() =>
    expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
  );
  receive({
    method: "turn/started",
    params: { threadId: "chief-original", turn: { id: "unrelated" } },
  });
  receive({
    method: "turn/completed",
    params: {
      threadId: "chief-original",
      turn: { id: "unrelated", status: "completed" },
    },
  });
  const request = sent.find((value) => value.method === "thread/compact/start")!;
  receive({ id: request.id, result: { turn: { id: "actual-compact" } } });
  await Promise.resolve();
  expect(receipt).not.toHaveBeenCalled();
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
  receive({
    method: "turn/completed",
    params: {
      threadId: "chief-original",
      turn: { id: "actual-compact", status: "completed" },
    },
  });
  expect(await result).toBe(output);
  expect(receipt).toHaveBeenCalledOnce();
});
it("refuses missing or cancelled completion status rather than treating it as completed", async () => {
  for (const status of [undefined, "interrupted", "cancelled"]) {
    sent.length = 0;
    const receipt = vi.fn(async () => undefined),
      result = runCodexTextPrompt({
        cwd: "/chief",
        prompt: "never send",
        ephemeral: false,
        threadId: "chief-original",
        compactBefore: true,
        onCompacted: receipt,
      });
    const rejected = expect(result).rejects.toThrow("successful compaction");
    await vi.waitFor(() =>
      expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
    );
    compactNotifications("bad-compact", status);
    await rejected;
    expect(receipt).not.toHaveBeenCalled();
    expect(sent.some((value) => value.method === "turn/start")).toBe(false);
  }
});
it("does not treat an unrelated ordinary turn as compact-specific completion", async () => {
  const receipt = vi.fn(async () => undefined),
    result = runCodexTextPrompt({
      cwd: "/chief",
      prompt: "never send",
      ephemeral: false,
      threadId: "chief-original",
      compactBefore: true,
      onCompacted: receipt,
      timeoutMs: 40,
    });
  const rejected = expect(result).rejects.toThrow("compaction timed out");
  await vi.waitFor(() =>
    expect(sent.some((value) => value.method === "thread/compact/start")).toBe(true),
  );
  receive({
    method: "turn/started",
    params: { threadId: "chief-original", turn: { id: "ordinary" } },
  });
  receive({
    method: "turn/completed",
    params: {
      threadId: "chief-original",
      turn: { id: "ordinary", status: "completed" },
    },
  });
  await rejected;
  expect(receipt).not.toHaveBeenCalled();
  expect(sent.some((value) => value.method === "turn/start")).toBe(false);
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
    let stopFinished = false;
    void stopping.then(
      () => {
        stopFinished = true;
      },
      () => {
        stopFinished = true;
      },
    );
    // Stop owns the whole original cohort: B is cancelled immediately, but A's
    // actual held kill still prevents that Stop from acknowledging completion.
    await Promise.resolve();
    expect(stopFinished).toBe(false);
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
    await stopping;
    expect((await switching).error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("startup cancelled"),
      }),
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
  const first = runCodexTextPrompt({
    cwd: "/repo",
    prompt: "Never dispatch A",
  }).then(
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
      expect.objectContaining({
        message: expect.stringContaining("startup cancelled"),
      }),
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
