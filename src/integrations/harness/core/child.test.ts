import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ChildProcessHandle } from "./child";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: never }) => void>(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "main",
  }),
}));

function receipt(sessionId: string, pid = 42) {
  return {
    version: 1 as const,
    backend: "native" as const,
    sessionId,
    pid,
    constructionId: `00000000-0000-4000-8000-${pid.toString(16).padStart(12, "0")}`,
  };
}
const fixtureHandles = new WeakMap<object, Map<string, ChildProcessHandle>>();
function processHandle(child: typeof import("./child"), sessionId: string): ChildProcessHandle {
  const handles = fixtureHandles.get(child) ?? new Map<string, ChildProcessHandle>();
  fixtureHandles.set(child, handles);
  let handle = handles.get(sessionId);
  if (!handle) {
    handle = child.createChildProcessHandle(sessionId);
    handles.set(sessionId, handle);
  }
  return handle;
}
function emit(name: string, payload: Record<string, unknown>) {
  const processEvent =
    name.startsWith("harness-stdout") ||
    name.startsWith("harness-stderr") ||
    name === "harness-exit";
  mocks.handlers.get(name)?.({
    payload: {
      ...(processEvent
        ? { constructionId: receipt(String(payload.sessionId)).constructionId }
        : {}),
      ...payload,
    } as never,
  });
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installResolvedListeners() {
  mocks.listen.mockImplementation(
    async (name: string, handler: (event: { payload: never }) => void) => {
      mocks.handlers.set(name, handler);
      return vi.fn();
    },
  );
}

async function loadChild() {
  vi.resetModules();
  if (!mocks.invoke.getMockImplementation())
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "harness_spawn" ? receipt(args.sessionId) : undefined,
    );
  return import("./child");
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  mocks.handlers.clear();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isCurrentChildExit", () => {
  it("matches only the live child's pid", async () => {
    installResolvedListeners();
    const { isCurrentChildExit } = await loadChild();
    expect(isCurrentChildExit(undefined, 41)).toBe(false);
    expect(isCurrentChildExit(42, 41)).toBe(false);
    expect(isCurrentChildExit(42, 42)).toBe(true);
  });
});

describe("child bridge", () => {
  it("updates the resolved binary to the checked release with its configured identity", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "bycoda.providerBinaryPaths.v1"
          ? JSON.stringify({ opencode: "/custom/bin/opencode" })
          : null,
    });
    mocks.invoke.mockResolvedValueOnce({ path: "/resolved/opencode" });
    const child = await loadChild();

    await child.updateHarnessCli("opencode", "1.19.0");

    expect(mocks.invoke).toHaveBeenCalledWith("harness_resolve_configured", {
      provider: "opencode",
      binaryPath: "/custom/bin/opencode",
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("harness_update", {
      command: "/resolved/opencode",
      binaryProvider: "opencode",
      binaryPath: "/custom/bin/opencode",
      targetVersion: "1.19.0",
    });
  });

  it("waits until every listener is installed", async () => {
    const pending = deferred<UnlistenFn>();
    mocks.listen.mockImplementation(
      (name: string, handler: (event: { payload: never }) => void) => {
        mocks.handlers.set(name, handler);
        return name === "harness-stdout" ? pending.promise : Promise.resolve(vi.fn());
      },
    );
    const child = await loadChild();
    let acquired = false;
    const lease = child.acquireHarnessBridge().then((release) => {
      acquired = true;
      return release;
    });

    await flush();
    expect(acquired).toBe(false);

    pending.resolve(vi.fn());
    const release = await lease;
    expect(acquired).toBe(true);
    release();
  });

  it("cleans a failed installation and allows retry", async () => {
    vi.useFakeTimers();
    const late = deferred<UnlistenFn>();
    const firstUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn());
    const child = await loadChild();
    const releaseApp = child.startHarnessBridge();

    await expect(child.acquireHarnessBridge()).rejects.toThrow("listen failed");
    expect(firstUnlisten).toHaveBeenCalledOnce();

    late.resolve(lateUnlisten);
    await flush();
    expect(lateUnlisten).toHaveBeenCalledOnce();

    installResolvedListeners();
    const releaseProbe = await child.acquireHarnessBridge();
    releaseProbe();
    releaseApp();
    await vi.runAllTimersAsync();
  });

  it.each([undefined, "Provider stdout message exceeded the 64 MiB limit"])(
    "reconciles an early exit with reason=%s",
    async (reason) => {
      installResolvedListeners();
      const spawned = deferred<ReturnType<typeof receipt>>();
      mocks.invoke.mockImplementation((command: string) => {
        if (command === "harness_spawn") return spawned.promise;
        return Promise.resolve();
      });
      const child = await loadChild();
      const release = await child.acquireHarnessBridge();
      const onExit = vi.fn();
      child.watchChild(processHandle(child, "probe"), vi.fn(), onExit);

      const spawning = child.spawnChild(
        processHandle(child, "probe"),
        "pi",
        ["--mode", "rpc"],
        "/repo",
      );
      mocks.handlers.get("harness-exit")?.({
        payload: {
          sessionId: "probe",
          constructionId: receipt("probe").constructionId,
          code: 1,
          pid: 42,
          reason,
        } as never,
      });
      expect(onExit).not.toHaveBeenCalled();

      spawned.resolve(receipt("probe"));
      await spawning;
      if (reason) expect(onExit).toHaveBeenCalledWith(1, reason);
      else expect(onExit).toHaveBeenCalledWith(1);
      release();
    },
  );

  it("passes stored overrides through resolution and command validation", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "bycoda.providerBinaryPaths.v1"
          ? JSON.stringify({
              claude: "/opt/claude/bin/claude",
              codex: "/opt/codex/bin/codex",
              cursor: "/opt/cursor/bin/cursor-agent",
              grok: "/opt/grok/bin/grok",
              opencode: "/opt/opencode/bin/opencode",
              pi: "/opt/pi/bin/pi",
              omp: "/opt/omp/bin/omp",
              fx: "/opt/fx/bin/fx",
              hermes: "/opt/hermes/bin/hermes",
              antigravity: "/opt/antigravity/bin/agy_acp_server.par",
            })
          : null,
    });
    mocks.invoke.mockResolvedValue({ path: "/resolved" });
    const child = await loadChild();

    await child.resolveCodexBinary();
    expect(mocks.invoke).toHaveBeenCalledWith("harness_resolve_configured", {
      provider: "codex",
      binaryPath: "/opt/codex/bin/codex",
    });

    for (const [provider, binaryPath, resolve] of [
      ["claude", "/opt/claude/bin/claude", child.resolveClaudeBinary],
      ["cursor", "/opt/cursor/bin/cursor-agent", child.resolveCursorBinary],
      ["grok", "/opt/grok/bin/grok", child.resolveGrokBinary],
      ["pi", "/opt/pi/bin/pi", child.resolvePiBinary],
      ["omp", "/opt/omp/bin/omp", child.resolveOmpBinary],
      ["fx", "/opt/fx/bin/fx", child.resolveFxBinary],
      ["hermes", "/opt/hermes/bin/hermes", child.resolveHermesBinary],
      ["antigravity", "/opt/antigravity/bin/agy_acp_server.par", child.resolveAntigravityBinary],
    ] as const) {
      await resolve();
      expect(mocks.invoke).toHaveBeenLastCalledWith("harness_resolve_configured", {
        provider,
        binaryPath,
      });
    }

    await child.execChild("/resolved", ["--version"], undefined, "opencode");
    expect(mocks.invoke).toHaveBeenCalledWith("harness_exec", {
      command: "/resolved",
      args: ["--version"],
      cwd: undefined,
      binaryProvider: "opencode",
      binaryPath: "/opt/opencode/bin/opencode",
    });

    await child.execChild("/resolved", ["--version"], undefined, "codex", null);
    expect(mocks.invoke).toHaveBeenLastCalledWith("harness_exec", {
      command: "/resolved",
      args: ["--version"],
      cwd: undefined,
      binaryProvider: "codex",
      binaryPath: null,
    });
  });

  it("never routes a retired generation's stdout or exit to its replacement", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const oldLines: string[] = [];
    const oldExit = vi.fn();
    child.watchChild(processHandle(child, "thread#0"), (line) => oldLines.push(line), oldExit);
    await child.spawnChild(processHandle(child, "thread#0"), "agent", [], "/tmp");
    emit("harness-stdout", { sessionId: "thread#0", line: "gen0" });
    expect(oldLines).toEqual(["gen0"]);

    // Retire the generation, then register its replacement under a new key.
    child.unwatchChild(processHandle(child, "thread#0"));
    const newLines: string[] = [];
    const newExit = vi.fn();
    child.watchChild(processHandle(child, "thread#1"), (line) => newLines.push(line), newExit);
    await child.spawnChild(processHandle(child, "thread#1"), "agent", [], "/tmp");

    // Late output from the killed process arrives under its own key and is
    // dropped — it can never reach the replacement's handlers.
    emit("harness-stdout", { sessionId: "thread#0", line: "gen0-late" });
    emit("harness-exit", { sessionId: "thread#0", code: 1, pid: 42 });
    expect(oldLines).toEqual(["gen0"]);
    expect(oldExit).not.toHaveBeenCalled();
    expect(newLines).toEqual([]);
    expect(newExit).not.toHaveBeenCalled();

    // The replacement still receives its own traffic.
    emit("harness-stdout", { sessionId: "thread#1", line: "gen1" });
    expect(newLines).toEqual(["gen1"]);
    release();
  });

  it("does not hold output for children another window owns", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();

    // Events are broadcast to every window; this one never spawned "other".
    for (let i = 0; i < 5; i += 1) {
      emit("harness-stdout", { sessionId: "other", line: `line ${i}` });
      emit("harness-sse", { sessionId: "other", data: `event ${i}` });
    }

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild(processHandle(child, "other"), (line) => lines.push(line), vi.fn());
    child.watchSse("other", (data) => events.push(data));
    expect(lines).toEqual([]);
    expect(events).toEqual([]);
    release();
  });

  it("still replays output a spawned child printed before it was watched", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "harness_spawn" ? receipt(args.sessionId) : undefined,
    );

    await child.spawnChild(processHandle(child, "mine"), "agent", [], "/tmp");
    emit("harness-stdout", { sessionId: "mine", line: "early" });
    await child.openHarnessSse("mine", "http://127.0.0.1:1/event");
    emit("harness-sse", { sessionId: "mine", data: "early-event" });

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild(processHandle(child, "mine"), (line) => lines.push(line), vi.fn());
    child.watchSse("mine", (data) => events.push(data));
    expect(lines).toEqual(["early"]);
    expect(events).toEqual(["early-event"]);
    release();
  });

  it("unpacks batched stdout, stderr and SSE events in order", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const lines: string[] = [];
    const errors: string[] = [];
    const events: string[] = [];
    child.watchChild(
      processHandle(child, "batch"),
      (line) => lines.push(line),
      vi.fn(),
      (line) => errors.push(line),
    );
    child.watchSse("batch", (data) => events.push(data));
    await child.spawnChild(processHandle(child, "batch"), "agent", [], "/tmp");

    emit("harness-stdout-lines", { sessionId: "batch", lines: ["a", "b"] });
    emit("harness-stdout-lines", { sessionId: "batch", lines: ["c"] });
    emit("harness-stderr-lines", { sessionId: "batch", lines: ["e1", "e2"] });
    emit("harness-sse-batch", { sessionId: "batch", data: ["s1", "s2"] });
    expect(lines).toEqual(["a", "b", "c"]);
    expect(errors).toEqual(["e1", "e2"]);
    expect(events).toEqual(["s1", "s2"]);
    release();
  });

  it("keeps delivering a batch after one line's handler throws", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lines: string[] = [];
    const errors: string[] = [];
    child.watchChild(
      processHandle(child, "throwing"),
      (line) => {
        if (line === "b") throw new Error("parser bug");
        lines.push(line);
      },
      vi.fn(),
      (line) => {
        if (line === "e2") throw new Error("stderr parser bug");
        errors.push(line);
      },
    );
    await child.spawnChild(processHandle(child, "throwing"), "agent", [], "/tmp");

    emit("harness-stdout-lines", { sessionId: "throwing", lines: ["a", "b", "c"] });
    emit("harness-stdout", { sessionId: "throwing", line: "d" });
    emit("harness-stderr-lines", { sessionId: "throwing", lines: ["e1", "e2", "e3"] });
    // The failing line is skipped; everything behind it in the batch still arrives.
    expect(lines).toEqual(["a", "c", "d"]);
    expect(errors).toEqual(["e1", "e3"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("stdout line handler failed"),
      expect.objectContaining({ sessionId: "throwing", error: "parser bug" }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("stderr line handler failed"),
      expect.objectContaining({ sessionId: "throwing", error: "stderr parser bug" }),
    );
    warn.mockRestore();
    release();
  });

  it("caps an unwatched child's buffer by lines, not by batches", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "harness_spawn" ? receipt(args.sessionId) : undefined,
    );

    await child.spawnChild(processHandle(child, "burst"), "agent", [], "/tmp");
    await child.openHarnessSse("burst", "http://127.0.0.1:1/event");
    const first = Array.from({ length: 800 }, (_, i) => `l${i}`);
    const second = Array.from({ length: 800 }, (_, i) => `l${800 + i}`);
    emit("harness-stdout-lines", { sessionId: "burst", lines: first });
    emit("harness-stdout-lines", { sessionId: "burst", lines: second });
    emit("harness-sse-batch", { sessionId: "burst", data: [...first, ...second] });
    // A batch from a child this window does not own is never held.
    emit("harness-stdout-lines", { sessionId: "foreign", lines: first });

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild(processHandle(child, "burst"), (line) => lines.push(line), vi.fn());
    child.watchSse("burst", (data) => events.push(data));
    const expected = Array.from({ length: 1000 }, (_, i) => `l${600 + i}`);
    expect(lines).toEqual(expected);
    expect(events).toEqual(expected);
    const foreign: string[] = [];
    child.watchChild(processHandle(child, "foreign"), (line) => foreign.push(line), vi.fn());
    expect(foreign).toEqual([]);
    release();
  });

  it("bounds an unwatched buffer by bytes, keeping the newest items", async () => {
    installResolvedListeners();
    const { pushBounded } = await loadChild();
    const map = new Map<string, { items: string[]; bytes: number }>();
    const big = (c: string) => c.repeat(400);
    pushBounded(map, "s", [big("a"), big("b")], 1000);
    pushBounded(map, "s", [big("c")], 1000);
    expect(map.get("s")?.items).toEqual([big("b"), big("c")]);
    expect(map.get("s")?.bytes).toBe(800);

    // A single line over the bound is kept rather than dropped.
    pushBounded(map, "huge", ["x".repeat(5000)], 1000);
    expect(map.get("huge")?.items).toHaveLength(1);
  });

  it("scopes listeners to this window so targeted events skip other windows", async () => {
    installResolvedListeners();
    vi.stubGlobal("__TAURI_INTERNALS__", {
      metadata: { currentWindow: { label: "main-3" } },
    });
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    for (const call of mocks.listen.mock.calls) {
      expect(call[2]).toEqual({ target: "main-3" });
    }
    release();
  });

  it("does not register global listeners when window identity is missing", async () => {
    installResolvedListeners();
    vi.stubGlobal("__TAURI_INTERNALS__", { metadata: { currentWindow: { label: "" } } });
    const child = await loadChild();
    await expect(child.acquireHarnessBridge()).rejects.toThrow("Window event subscription requires a window identity");
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("drops output a killed child prints after it was stopped", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "harness_spawn" ? receipt(args.sessionId) : undefined,
    );

    child.watchChild(processHandle(child, "probe"), vi.fn(), vi.fn());
    await child.spawnChild(processHandle(child, "probe"), "agent", [], "/tmp");
    await child.killChild(processHandle(child, "probe"));
    emit("harness-stdout", { sessionId: "probe", line: "late" });

    const lines: string[] = [];
    child.watchChild(child.createChildProcessHandle("probe"), (line) => lines.push(line), vi.fn());
    expect(lines).toEqual([]);
    release();
  });
});

it("forwards an explicit logical locator after the existing guard slot without altering ordinary payloads", async () => {
  installResolvedListeners();
  const child = await loadChild();
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "harness_spawn" ? receipt(args.sessionId) : undefined,
  );
  const guard = vi.fn(async () => {});
  await child.spawnChild(
    processHandle(child, "logical#1"),
    "agent",
    [],
    "/tmp",
    undefined,
    undefined,
    undefined,
    undefined,
    guard,
    "logical",
  );
  expect(guard).toHaveBeenCalledTimes(2);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "harness_spawn",
    expect.objectContaining({ sessionId: "logical#1", logicalSessionId: "logical" }),
  );
  expect(
    mocks.invoke.mock.calls.find(([command]) => command === "harness_spawn")?.[1],
  ).not.toHaveProperty("beforeSpawn");
  await child.openHarnessSse(
    "logical#2",
    "http://127.0.0.1:1/event",
    undefined,
    undefined,
    "logical",
  );
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "harness_sse_open",
    expect.objectContaining({ sessionId: "logical#2", logicalSessionId: "logical" }),
  );
  await child.spawnChild(processHandle(child, "ordinary"), "agent", [], "/tmp");
  expect(
    mocks.invoke.mock.calls.find(
      ([command, args]) => command === "harness_spawn" && args.sessionId === "ordinary",
    )?.[1],
  ).not.toHaveProperty("logicalSessionId");
});

it("retains an actual Native write IPC promise when its caller stops waiting", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const { nativeOutputFrame } = await import("./nativeOutputDelivery.testSupport");
  const held = deferred<void>();
  await child.spawnChild(processHandle(child, "child-write-causal"), "agent", [], "/tmp");
  mocks.invoke.mockImplementation((command) =>
    command === "harness_write" ? held.promise : Promise.resolve(),
  );
  let actual!: Promise<void>;
  const inspect = nativeOutputFrame("child-write-causal", "input", () => {
    actual = child.writeChild(processHandle(child, "child-write-causal"), "reply");
  });
  expect(inspect().pendingCausalWork).toBe(1);
  await Promise.race([actual, Promise.resolve("waiter cancelled")]);
  expect(inspect().pendingCausalWork).toBe(1);
  held.resolve();
  await actual;
  expect(inspect().pendingCausalWork).toBe(0);
});

it.each([false, true])(
  "keeps actual CLI probe work after its visible deadline (late failure: %s)",
  async (lateFailure) => {
    const child = await loadChild();
    const { nativeOutputFrame } = await import("./nativeOutputDelivery.testSupport");
    const held = deferred<string>();
    mocks.invoke.mockReturnValueOnce(held.promise);
    vi.useFakeTimers();
    let visible!: Promise<unknown>;
    const args = ["--version"];
    const inspect = nativeOutputFrame("cli-probe-causal", "input", () => {
      visible = child
        .execChild("/original-cli", args, "/original-cwd")
        .catch((error: unknown) => error);
    });
    args[0] = "mutated-after-dispatch";
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "harness_exec",
      expect.objectContaining({
        command: "/original-cli",
        args: ["--version"],
        cwd: "/original-cwd",
      }),
    );
    expect(inspect().pendingCausalWork).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await visible).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("process completion remains unconfirmed"),
      }),
    );
    expect(inspect().pendingCausalWork).toBe(1);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    if (lateFailure) held.reject(new Error("original physical operation failed"));
    else held.resolve("original version");
    await held.promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(inspect()).toMatchObject({ pendingCausalWork: 0, applicationThrough: null });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  },
);

it("retires an actual probe capture when its backend throws before returning a promise", async () => {
  const child = await loadChild();
  const { nativeOutputFrame } = await import("./nativeOutputDelivery.testSupport");
  const failure = new Error("backend refused invocation");
  mocks.invoke.mockImplementationOnce(() => {
    throw failure;
  });
  let caught: unknown;
  const inspect = nativeOutputFrame("cli-probe-sync-rejection", "input", () => {
    try {
      child.execChild("/original-cli", ["--version"]);
    } catch (error) {
      caught = error;
    }
  });
  expect(caught).toBe(failure);
  expect(inspect()).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "cli-probe-invoke-threw",
    applicationThrough: null,
  });
  expect(mocks.invoke).toHaveBeenCalledOnce();
});

describe("original process construction handles", () => {
  it("refuses old writes and keeps replacement watchers intact across old unwatch and kill, even with PID reuse", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const original = child.createChildProcessHandle("same");
    const replacement = child.createChildProcessHandle("same");
    const a = receipt("same");
    const b = { ...receipt("same"), constructionId: receipt("same", 43).constructionId };
    mocks.invoke.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    await child.spawnChild(original, "agent", [], "/fixture");
    const lines = vi.fn();
    child.watchChild(replacement, lines, vi.fn());
    await child.spawnChild(replacement, "agent", [], "/fixture");
    expect(child.captureChildProcess("same")).toBe(replacement);
    await expect(child.writeChild(original, "old body")).rejects.toThrow("retired");
    child.unwatchChild(original);
    await child.killChild(original);
    emit("harness-stdout", { sessionId: "same", constructionId: a.constructionId, line: "old" });
    emit("harness-stdout", {
      sessionId: "same",
      constructionId: undefined,
      line: "missing identity cannot borrow the current receipt",
      nativeOutput: { processId: 42, streamEpoch: b.constructionId },
    });
    emit("harness-stdout", { sessionId: "same", constructionId: b.constructionId, line: "new" });
    expect(lines).toHaveBeenCalledExactlyOnceWith("new");
    await child.writeChild(replacement, "current body", { environmentId: "owner", generation: 7 });
    expect(mocks.invoke).toHaveBeenCalledWith("harness_kill", {
      sessionId: "same",
      constructionId: a.constructionId,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("harness_write", {
      sessionId: "same",
      constructionId: b.constructionId,
      line: "current body",
      authorityEnvironmentId: "owner",
      authorityGeneration: 7,
    });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "harness_write")).toHaveLength(
      1,
    );
    expect(child.captureChildProcess("same")).toBe(replacement);
    release();
  });

  it("waits for its own invoked spawn before kill without selecting an already accepted replacement", async () => {
    const child = await loadChild();
    const pending = deferred<ReturnType<typeof receipt>>();
    const a = child.createChildProcessHandle("same");
    const b = child.createChildProcessHandle("same");
    mocks.invoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt("same", 43));
    const starting = child.spawnChild(a, "agent", [], "/fixture");
    child.unwatchChild(a);
    const stopped = child.killChild(a);
    let stopSettled = false;
    void stopped.then(() => {
      stopSettled = true;
    });
    await child.spawnChild(b, "agent", [], "/fixture");
    expect(stopSettled).toBe(false);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "harness_kill")).toHaveLength(
      0,
    );
    pending.resolve(receipt("same"));
    await starting;
    await stopped;
    expect(mocks.invoke).toHaveBeenLastCalledWith("harness_kill", {
      sessionId: "same",
      constructionId: receipt("same").constructionId,
    });
    expect(child.captureChildProcess("same")).toBe(b);
    await child.killChild(a);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "harness_kill")).toHaveLength(
      1,
    );
  });

  it("cancels an unstarted original before scheduling or any keyed kill and cannot reuse that handle", async () => {
    const child = await loadChild();
    const original = child.createChildProcessHandle("cancelled");
    await child.killChild(original);
    await expect(child.spawnChild(original, "agent", [], "/fixture")).rejects.toThrow("cancelled");
    await expect(child.writeChild(original, "never")).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("snapshots explicit write authority before awaiting its original spawn receipt", async () => {
    const child = await loadChild();
    const original = child.createChildProcessHandle("authority");
    const pending = deferred<ReturnType<typeof receipt>>();
    mocks.invoke.mockReturnValueOnce(pending.promise);
    const starting = child.spawnChild(original, "agent", [], "/fixture");
    const scope = { environmentId: "original-owner", generation: 7 };
    const writing = child.writeChild(original, "original body", scope);
    scope.environmentId = "later-owner";
    scope.generation = 8;
    pending.resolve(receipt("authority"));
    await starting;
    await writing;
    expect(mocks.invoke).toHaveBeenCalledWith("harness_write", {
      sessionId: "authority",
      constructionId: receipt("authority").constructionId,
      line: "original body",
      authorityEnvironmentId: "original-owner",
      authorityGeneration: 7,
    });
  });

  it("buffers early identified stdout, stderr and exit only until the exact receipt binds", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const original = child.createChildProcessHandle("early");
    const lines = vi.fn();
    const errors = vi.fn();
    const exits = vi.fn();
    child.watchChild(original, lines, exits, errors);
    const pending = deferred<ReturnType<typeof receipt>>();
    mocks.invoke.mockReturnValueOnce(pending.promise);
    const starting = child.spawnChild(original, "agent", [], "/fixture");
    emit("harness-stdout", { sessionId: "early", constructionId: undefined, line: "unidentified" });
    emit("harness-stdout", {
      sessionId: "early",
      constructionId: receipt("early", 43).constructionId,
      line: "foreign",
    });
    emit("harness-stdout", { sessionId: "early", line: "original" });
    emit("harness-stderr", { sessionId: "early", line: "diagnostic" });
    emit("harness-exit", { sessionId: "early", pid: 43, code: 9 });
    emit("harness-exit", { sessionId: "early", pid: 42, code: 1, reason: "Original early exit" });
    expect(lines).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(exits).not.toHaveBeenCalled();
    pending.resolve(receipt("early"));
    await starting;
    expect(lines).toHaveBeenCalledExactlyOnceWith("original");
    expect(errors).toHaveBeenCalledExactlyOnceWith("diagnostic");
    expect(exits).toHaveBeenCalledExactlyOnceWith(1, "Original early exit");
    expect(child.captureChildProcess("early")).toBeUndefined();
    await expect(child.writeChild(original, "after exit")).rejects.toThrow("retired");
    release();
  });

  it("bounds pre-receipt frames rather than accumulating output until a delayed spawn returns", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const original = child.createChildProcessHandle("bounded");
    const lines: string[] = [];
    child.watchChild(original, (line) => lines.push(line), vi.fn());
    const pending = deferred<ReturnType<typeof receipt>>();
    mocks.invoke.mockReturnValueOnce(pending.promise);
    const starting = child.spawnChild(original, "agent", [], "/fixture");
    emit("harness-stdout-lines", {
      sessionId: "bounded",
      lines: Array.from({ length: 1600 }, (_, i) => String(i)),
    });
    emit("harness-stderr", {
      sessionId: "bounded",
      line: "x".repeat(child.MAX_BUFFERED_BYTES + 1),
    });
    pending.resolve(receipt("bounded"));
    await starting;
    expect(lines).toEqual(Array.from({ length: 1000 }, (_, i) => String(i + 600)));
    release();
  });

  it.each([
    42,
    {},
    { ...receipt("invalid"), backend: "host" },
    { ...receipt("invalid"), constructionId: undefined },
    { ...receipt("invalid"), sessionId: "foreign" },
  ])(
    "refuses an unsupported spawn receipt without upgrading a current PID: %j",
    async (invalid) => {
      const child = await loadChild();
      const original = child.createChildProcessHandle("invalid");
      mocks.invoke.mockResolvedValueOnce(invalid);
      await expect(child.spawnChild(original, "agent", [], "/fixture")).rejects.toThrow();
      await expect(child.writeChild(original, "never")).rejects.toThrow();
      await expect(child.killChild(original)).resolves.toBeUndefined();
      expect(child.captureChildProcess("invalid")).toBeUndefined();
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      expect(mocks.invoke).toHaveBeenLastCalledWith("harness_kill", { sessionId: "invalid" });
    },
  );

  it("captures the original backend invoke at creation rather than following later configuration", async () => {
    const child = await loadChild();
    const native = child.createChildProcessHandle("native-original");
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => ({
      ...receipt(String(args?.sessionId)),
      backend: "host" as const,
    }));
    child.configureChildBackend({ invoke: invoke as never, listen: async () => () => {} });
    const host = child.createChildProcessHandle("host-original");
    await child.spawnChild(native, "agent", [], "/fixture");
    await child.spawnChild(host, "agent", [], "/fixture");
    await child.writeChild(native, "native");
    await child.writeChild(host, "host");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "harness_write",
      expect.objectContaining({ sessionId: "native-original" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "harness_write",
      expect.objectContaining({ sessionId: "host-original" }),
    );
    expect(invoke.mock.calls.some(([, args]) => args?.sessionId === "native-original")).toBe(false);
  });

  it("never resurrects an older ordinary receipt after its replacement already exited", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const old = child.createChildProcessHandle("same");
    const current = child.createChildProcessHandle("same");
    const pending = deferred<ReturnType<typeof receipt>>();
    mocks.invoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt("same", 43));
    const first = child.spawnChild(old, "agent", [], "/fixture");
    await child.spawnChild(current, "agent", [], "/fixture");
    emit("harness-exit", {
      sessionId: "same",
      constructionId: receipt("same", 43).constructionId,
      pid: 43,
      code: 0,
    });
    expect(child.captureChildProcess("same")).toBeUndefined();
    pending.resolve(receipt("same"));
    await first;
    expect(child.captureChildProcess("same")).toBeUndefined();
    await expect(child.writeChild(old, "old")).rejects.toThrow("retired");
    release();
  });

  it("does not accept structural handles or bind one accepted handle twice", async () => {
    const child = await loadChild();
    await expect(
      child.spawnChild({ sessionId: "forged" } as ChildProcessHandle, "agent", [], "/fixture"),
    ).rejects.toThrow("original");
    await expect(child.writeChild("forged" as never, "never")).rejects.toThrow("original");
    const original = child.createChildProcessHandle("once");
    await child.spawnChild(original, "agent", [], "/fixture");
    await expect(child.spawnChild(original, "agent", [], "/fixture")).rejects.toThrow("single-use");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
