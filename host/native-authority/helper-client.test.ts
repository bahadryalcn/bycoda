import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { encodeHelperFrame } from "./protocol";
import {
  NativeAuthorityHelperRuntime,
  type NativeHelperRuntimeOptions,
  type NativeHelperSpawnOptions,
} from "./helper-client";

const fixturePath = fileURLToPath(new URL("./fixtures/helper.mjs", import.meta.url));
const evidenceRoot = resolve("temp/verification/2026-10-28-native-authority-helper-client");
const address = "\\\\.\\pipe\\bycoda-authority-v1-" + "a".repeat(32);
const runtimes: NativeAuthorityHelperRuntime[] = [];
const directories: string[] = [];
const restores: (() => void)[] = [];
type Spawned = {
  child: ChildProcessWithoutNullStreams;
  executable: string;
  args: readonly string[];
  options: NativeHelperSpawnOptions;
};
async function fixture(
  mode: string | ((index: number) => string) = "normal",
  options: Partial<NativeHelperRuntimeOptions> = {},
) {
  await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(join(evidenceRoot, "fixture-"));
  directories.push(directory);
  const audit = join(directory, "commands.jsonl");
  const children: Spawned[] = [];
  const runtime = new NativeAuthorityHelperRuntime({
    executablePath: process.execPath,
    ...options,
    spawn: (executable, args, launchOptions) => {
      const selected = typeof mode === "function" ? mode(children.length) : mode;
      const child = spawn(process.execPath, [fixturePath, selected, audit, ...args], launchOptions);
      children.push({ child, executable, args, options: launchOptions });
      return child;
    },
  });
  runtimes.push(runtime);
  return {
    runtime,
    children,
    audit: async (): Promise<any[]> =>
      (await readFile(audit, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}
afterEach(async () => {
  restores.splice(0).forEach((restore) => restore());
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== evidenceRoot || !basename(target).startsWith("fixture-"))
      throw new Error("Unsafe fixture cleanup target");
    await rm(target, { recursive: true, force: true });
  }
});

describe("actual native-helper child stream client", () => {
  it("never opens a known-exited helper when its stdout ready frame is deferred", async () => {
    const runtime = new NativeAuthorityHelperRuntime({
      executablePath: process.execPath,
      spawn: (_executable, _args, options) => {
        const child = spawn(
          process.execPath,
          ["-e", "process.stdin.once('data',()=>process.exit(0))"],
          options,
        );
        child.stdout.resume();
        const lateStdout = new PassThrough();
        lateStdout.on("error", () => {});
        Object.defineProperty(child, "stdout", { value: lateStdout });
        const emit = child.emit.bind(child);
        let closeAfterStdout: (() => void) | undefined;
        // Keep the OS process exit real. Only defer the I/O boundary, which Node
        // explicitly allows to outlive exit; no client-private state is touched.
        child.emit = (event, ...args) => {
          if (event === "close") {
            closeAfterStdout = () => {
              emit(event, ...args);
            };
            return true;
          }
          return emit(event, ...args);
        };
        child.once("exit", () =>
          queueMicrotask(() => {
            if (!lateStdout.destroyed)
              lateStdout.write(encodeHelperFrame({ version: 1, kind: "ready" }));
            setImmediate(() => {
              lateStdout.end();
              closeAfterStdout?.();
            });
          }),
        );
        return child;
      },
    });
    runtimes.push(runtime);
    await expect(runtime.open(address)).rejects.toMatchObject({
      code: "HELPER_EXIT",
      commandDelivery: "unknown",
    });
    expect(runtime.observation().activeHelpers).toBe(0);
  });
  it("bootstraps through stdin only, serializes commands and waits for actual clean exit", async () => {
    const f = await fixture("fragmented");
    const client = await f.runtime.open(address);
    await client.send({ text: "Türkçe 😀", retained: null });
    expect(await client.receive()).toEqual({
      text: "Türkçe 😀",
      retained: null,
    });
    await client.send(null);
    expect(await client.receive()).toBeNull();
    await client.close();
    expect(await client.exited).toMatchObject({
      code: 0,
      signal: null,
      spawned: true,
    });
    expect(f.runtime.observation()).toMatchObject({
      activeHelpers: 0,
      qualified: false,
    });
    const rows = await f.audit();
    expect(rows[0]).toEqual({ bootstrap: { version: 1, address } });
    expect(rows.slice(1).map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(f.children[0].args).toEqual(["--native-authority-helper"]);
    expect(f.children[0].options).toMatchObject({
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(JSON.stringify(f.children[0].options.env)).not.toContain(address);
  });

  it("does not inherit arbitrary Host secrets or allow a mutable option to replace the executable", async () => {
    const previous = process.env.BYCODA_HELPER_TEST_SECRET;
    process.env.BYCODA_HELPER_TEST_SECRET = "fixture-secret-not-for-child";
    restores.push(() => {
      if (previous === undefined) delete process.env.BYCODA_HELPER_TEST_SECRET;
      else process.env.BYCODA_HELPER_TEST_SECRET = previous;
    });
    let selected = "";
    const options: NativeHelperRuntimeOptions = {
      executablePath: process.execPath,
      spawn: (executable, args, launchOptions) => {
        selected = executable;
        expect(launchOptions.env?.BYCODA_HELPER_TEST_SECRET).toBeUndefined();
        return spawn(process.execPath, [fixturePath, "normal", "-", ...args], launchOptions);
      },
    };
    const runtime = new NativeAuthorityHelperRuntime(options);
    runtimes.push(runtime);
    options.executablePath = resolve("unrequested-other.exe");
    const client = await runtime.open(address);
    expect(selected).toBe(process.execPath);
    await client.close();
  });

  it.each([
    ["truncated", "INVALID_FRAME"],
    ["truncated-header", "INVALID_FRAME"],
    ["oversize", "FRAME_TOO_LARGE"],
    ["bad-utf8", "INVALID_FRAME"],
    ["bad-json", "INVALID_FRAME"],
    ["wrong-id", "INVALID_FRAME"],
    ["wrong-kind", "INVALID_FRAME"],
    ["unknown-field", "INVALID_FRAME"],
    ["unknown-error", "INVALID_FRAME"],
    ["exit-no-reply", "HELPER_EXIT"],
    ["stderr-overflow", "STDERR_LIMIT"],
  ])(
    "closes on %s, retains unknown delivery and never writes the queued command",
    async (mode, code) => {
      const f = await fixture(mode);
      const client = await f.runtime.open(address);
      const results = Promise.allSettled([
        client.send({ retained: "not replayable" }),
        client.receive(),
      ]);
      const [sent, queued] = await results;
      expect(sent).toMatchObject({
        status: "rejected",
        reason: { code, commandDelivery: "unknown" },
      });
      expect(queued).toMatchObject({
        status: "rejected",
        reason: { commandDelivery: "not-sent" },
      });
      await client.exited;
      expect((await f.audit()).filter((row) => row.kind)).toEqual([{ kind: "send", id: 1 }]);
      await expect(client.send("no reconnect")).rejects.toMatchObject({
        code: "CLOSED",
        commandDelivery: "not-sent",
      });
      expect(f.children).toHaveLength(1);
    },
  );

  it("rejects duplicate acknowledgements without replaying or dispatching the next queued command", async () => {
    const f = await fixture("duplicate");
    const client = await f.runtime.open(address);
    const [first, next] = await Promise.allSettled([client.send("once"), client.receive()]);
    expect(first).toMatchObject({
      status: "rejected",
      reason: { code: "INVALID_FRAME", commandDelivery: "unknown" },
    });
    expect(next).toMatchObject({
      status: "rejected",
      reason: { commandDelivery: "not-sent" },
    });
    await client.exited;
    expect((await f.audit()).filter((row) => row.kind)).toHaveLength(1);
  });

  it.each([
    ["bad-ready", "INVALID_FRAME"],
    ["startup-truncated", "INVALID_FRAME"],
    ["startup-error", "PEER_REJECTED"],
  ])("rejects %s bootstrap and retains process ownership through exit", async (mode, code) => {
    const f = await fixture(mode);
    await expect(f.runtime.open(address)).rejects.toMatchObject({ code });
    await f.runtime.close();
    expect(f.runtime.observation().activeHelpers).toBe(0);
  });

  it("bounds startup time and aborts a real child without releasing its budget on the request alone", async () => {
    const f = await fixture("startup-timeout", { defaultTimeoutMs: 100 });
    await expect(f.runtime.open(address)).rejects.toMatchObject({
      code: "DEADLINE",
      commandDelivery: "unknown",
    });
    await f.runtime.close();
    expect(f.runtime.observation().activeHelpers).toBe(0);
    expect(f.children).toHaveLength(1);
  });

  it("keeps the helper slot after closed ACK until its actual delayed exit", async () => {
    const f = await fixture("hold-close", { maxActiveHelpers: 1 });
    const client = await f.runtime.open(address);
    let completed = false;
    const closing = client.close().then(() => {
      completed = true;
    });
    await vi.waitFor(async () =>
      expect((await f.audit()).some((row) => row.kind === "close")).toBe(true),
    );
    expect(completed).toBe(false);
    expect(f.runtime.observation().activeHelpers).toBe(1);
    await expect(f.runtime.open(address)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    await closing;
    expect(f.runtime.observation().activeHelpers).toBe(0);
  });

  it("retains capacity after a failed termination request until actual exit, across reconnect attempts", async () => {
    const f = await fixture((index) => (index === 0 ? "stubborn" : "normal"), {
      maxActiveHelpers: 1,
      defaultTimeoutMs: 500,
    });
    const client = await f.runtime.open(address);
    const child = f.children[0].child;
    const kill = vi.spyOn(child, "kill").mockImplementation(() => false);
    restores.push(() => kill.mockRestore());
    const sending = client.send("unknown", { timeoutMs: 80 });
    await expect(sending).rejects.toMatchObject({
      code: "DEADLINE",
      commandDelivery: "unknown",
    });
    expect(f.runtime.observation().activeHelpers).toBe(1);
    await expect(f.runtime.open(address)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    kill.mockRestore();
    child.kill("SIGKILL");
    await client.exited;
    const next = await f.runtime.open(address);
    await next.close();
    expect(f.children).toHaveLength(2);
  });

  it("shares the process budget across independent runtimes and releases only actually exited children", async () => {
    const a = await fixture();
    const b = await fixture();
    const c = await fixture();
    const clients = await Promise.all(
      Array.from({ length: 8 }, (_, index) => (index < 4 ? a.runtime : b.runtime).open(address)),
    );
    expect(a.runtime.observation().globalActiveHelpers).toBe(8);
    await expect(c.runtime.open(address)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    await Promise.all(clients.map((client) => client.close()));
    expect(a.runtime.observation().globalActiveHelpers).toBe(0);
    const fresh = await c.runtime.open(address);
    await fresh.close();
  });

  it("cancels a queued command without claiming anything about earlier delivered work", async () => {
    const f = await fixture("delay-receive");
    const client = await f.runtime.open(address);
    await client.send("already delivered");
    const receiving = client.receive();
    const abort = new AbortController();
    const skipped = client.send("never written", { signal: abort.signal });
    abort.abort();
    await expect(skipped).rejects.toMatchObject({
      code: "CANCELLED",
      commandDelivery: "not-sent",
    });
    expect(await receiving).toBe("already delivered");
    await client.send("later delivered");
    await client.close();
    expect((await f.audit()).filter((row) => row.kind).map((row) => row.id)).toEqual([1, 2, 4, 5]);
  });

  it("cancels an in-flight command as unknown and never automatically resends it", async () => {
    const f = await fixture("stall");
    const client = await f.runtime.open(address);
    const abort = new AbortController();
    const sending = client.send("accepted stream bytes", {
      signal: abort.signal,
    });
    const outcome = Promise.allSettled([sending, client.receive()]);
    await vi.waitFor(async () =>
      expect((await f.audit()).some((row) => row.kind === "send")).toBe(true),
    );
    abort.abort();
    expect(await outcome).toMatchObject([
      {
        status: "rejected",
        reason: { code: "CANCELLED", commandDelivery: "unknown" },
      },
      { status: "rejected", reason: { commandDelivery: "not-sent" } },
    ]);
    await client.exited;
    expect((await f.audit()).filter((row) => row.kind)).toHaveLength(1);
  });

  it.each([{ maxQueuedCommands: 1 }, { maxQueuedBytes: 1200 }])(
    "bounds queued count/bytes behind an actual blocked receive: %j",
    async (limits) => {
      const f = await fixture("stall", limits);
      const client = await f.runtime.open(address);
      const active = client.receive({ timeoutMs: 200 });
      await vi.waitFor(async () =>
        expect((await f.audit()).some((row) => row.kind === "receive")).toBe(true),
      );
      const queued = client.send("x".repeat(600));
      const results = Promise.allSettled([active, queued]);
      await expect(client.send("x".repeat(600))).rejects.toMatchObject({
        code: "QUEUE_FULL",
        commandDelivery: "not-sent",
      });
      await results;
      await client.exited;
    },
  );

  it("uses admission deadlines for queued work while a live earlier command keeps running", async () => {
    const f = await fixture("delay-receive");
    const client = await f.runtime.open(address);
    const active = client.receive();
    const queued = client.send("expired before write", { timeoutMs: 20 });
    await expect(queued).rejects.toMatchObject({
      code: "DEADLINE",
      commandDelivery: "not-sent",
    });
    expect(await active).toEqual({ fixture: true });
    await client.close();
    expect((await f.audit()).filter((row) => row.kind)).toEqual([
      { kind: "receive", id: 1 },
      { kind: "close", id: 3 },
    ]);
  });

  it("waits for actual write completion and drain even when the real child has already acknowledged", async () => {
    const f = await fixture("pause-input");
    const client = await f.runtime.open(address);
    const stdin = f.children[0].child.stdin;
    // Buffer the write until it exceeds the fixture stream's high-water
    // mark. An uncorked pipe may write synchronously and legitimately return
    // true even for a large frame on fast macOS/Windows runners.
    (stdin as any)._writableState.highWaterMark = 1024;
    stdin.cork();
    const original = stdin.write.bind(stdin) as (...args: any[]) => boolean;
    let release: (() => void) | undefined;
    let returnedFalse = false;
    const spy = vi.spyOn(stdin, "write").mockImplementation(((
      chunk: Buffer,
      callback: (error?: Error | null) => void,
    ) => {
      const result = original(chunk, (error?: Error | null) => {
        release = () => callback(error);
      });
      returnedFalse ||= !result;
      return result;
    }) as typeof stdin.write);
    restores.push(() => spy.mockRestore());
    let finished = false;
    const sending = client.send("x".repeat(60_000)).then(() => {
      finished = true;
    });
    try {
      await vi.waitFor(() => expect(returnedFalse).toBe(true));
    } finally {
      stdin.uncork();
    }
    await vi.waitFor(async () => {
      expect(release).toBeTypeOf("function");
      expect((await f.audit()).some((row) => row.kind === "send")).toBe(true);
    });
    expect(returnedFalse).toBe(true);
    expect(finished).toBe(false);
    release!();
    await sending;
    spy.mockRestore();
    await client.close();
  });

  it("rejects oversized envelopes locally while keeping prior stream work and the connection", async () => {
    const f = await fixture();
    const client = await f.runtime.open(address);
    await client.send("already written");
    await expect(client.send("x".repeat(65536))).rejects.toMatchObject({
      code: "FRAME_TOO_LARGE",
      commandDelivery: "not-sent",
    });
    expect(await client.receive()).toBe("already written");
    await client.close();
    expect((await f.audit()).filter((row) => row.kind).map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("preserves a native error code as unknown stream delivery, not a domain rejection proof", async () => {
    const f = await fixture("native-error");
    const client = await f.runtime.open(address);
    await expect(client.send({})).rejects.toMatchObject({
      code: "PIPE_CLOSED",
      source: "helper",
      commandDelivery: "unknown",
    });
    await client.exited;
  });

  it("treats an oversized received wrapper after a native read as unknown, without truncation or replay", async () => {
    const f = await fixture("native-wrapper-too-large");
    const client = await f.runtime.open(address);
    await expect(client.receive()).rejects.toMatchObject({
      code: "FRAME_TOO_LARGE",
      source: "helper",
      commandDelivery: "unknown",
    });
    await client.exited;
    expect((await f.audit()).filter((row) => row.kind)).toEqual([{ kind: "receive", id: 1 }]);
    expect(f.children).toHaveLength(1);
  });

  it("tears down a full queue on close failure and waits for actual helper exit", async () => {
    const f = await fixture("stall", { maxQueuedCommands: 1 });
    const client = await f.runtime.open(address);
    const active = client.receive();
    await vi.waitFor(async () =>
      expect((await f.audit()).some((row) => row.kind === "receive")).toBe(true),
    );
    const queued = client.send("held");
    const results = await Promise.allSettled([active, queued, client.close()]);
    expect(results).toMatchObject([
      {
        status: "rejected",
        reason: { code: "QUEUE_FULL", commandDelivery: "unknown" },
      },
      {
        status: "rejected",
        reason: { code: "QUEUE_FULL", commandDelivery: "not-sent" },
      },
      {
        status: "rejected",
        reason: { code: "QUEUE_FULL", commandDelivery: "not-sent" },
      },
    ]);
    expect(client.observation().exited).toBe(true);
    expect(f.runtime.observation().activeHelpers).toBe(0);
  });

  it("runtime shutdown stops admission and retains current/queued delivery distinctions until actual exit", async () => {
    const f = await fixture("stall");
    const client = await f.runtime.open(address);
    const active = client.receive();
    await vi.waitFor(async () =>
      expect((await f.audit()).some((row) => row.kind === "receive")).toBe(true),
    );
    const queued = client.send("not written");
    const outcomes = Promise.allSettled([active, queued]);
    const exits = await f.runtime.close();
    expect(exits).toHaveLength(1);
    expect(await outcomes).toMatchObject([
      {
        status: "rejected",
        reason: { code: "RUNTIME_CLOSED", commandDelivery: "unknown" },
      },
      {
        status: "rejected",
        reason: { code: "RUNTIME_CLOSED", commandDelivery: "not-sent" },
      },
    ]);
    await expect(f.runtime.open(address)).rejects.toMatchObject({
      code: "RUNTIME_CLOSED",
      commandDelivery: "not-sent",
    });
    expect(f.children).toHaveLength(1);
  });

  it("does not reset the process budget when the client module is re-evaluated", async () => {
    const f = await fixture();
    const client = await f.runtime.open(address);
    vi.resetModules();
    const { NativeAuthorityHelperRuntime: ReloadedRuntime } = await import("./helper-client");
    const reloaded = new ReloadedRuntime({ executablePath: process.execPath });
    runtimes.push(reloaded);
    expect(reloaded.observation().globalActiveHelpers).toBe(1);
    await client.close();
    expect(reloaded.observation().globalActiveHelpers).toBe(0);
  });

  it("never spawns an invalid address and releases a confirmed spawn failure", async () => {
    const f = await fixture();
    await expect(f.runtime.open(address + "\n")).rejects.toMatchObject({
      code: "INVALID_BOOTSTRAP",
      commandDelivery: "not-sent",
    });
    expect(f.children).toHaveLength(0);
    const failed = new NativeAuthorityHelperRuntime({
      executablePath: join(evidenceRoot, "not-installed.exe"),
    });
    runtimes.push(failed);
    await expect(failed.open(address)).rejects.toMatchObject({
      code: "SPAWN_FAILED",
      commandDelivery: "not-sent",
    });
    expect(failed.observation().activeHelpers).toBe(0);
  });
});
