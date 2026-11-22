import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import { GitExecPool } from "./git-exec-pool";

let pool: GitExecPool | undefined;
let cwd: string | undefined;
const node = (code: string, options: Partial<Parameters<GitExecPool["exec"]>[2]> = {}) =>
  pool!.exec(process.execPath, ["-e", code], { timeout: 10_000, ...options });

it("streams both pipes without buffering and preserves input and exit code", async () => {
  pool = new GitExecPool();
  const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  const input = Buffer.alloc(2 * 1024 * 1024, 255);
  await expect(
    node(
      "process.stdin.pipe(process.stdout); process.stderr.write(Buffer.alloc(2 * 1024 * 1024, 65)); process.exitCode = 7",
      {
        input: [input.subarray(0, 65536), input.subarray(65536)],
        onOutput: (stream, chunk) => output[stream].push(chunk),
      },
    ),
  ).rejects.toMatchObject({ code: 7, stdout: "", stderr: "" });
  expect(Buffer.concat(output.stdout).equals(input)).toBe(true);
  expect(Buffer.concat(output.stderr).equals(Buffer.alloc(input.length, 65))).toBe(true);
});

afterEach(async () => {
  await pool?.close();
  if (cwd) await rm(cwd, { recursive: true, force: true });
  pool = undefined;
  cwd = undefined;
  vi.unstubAllEnvs();
});

async function markerDirectory() {
  cwd = await mkdtemp(join(tmpdir(), "bycoda-git-pool-"));
  return cwd;
}

function waitingChild(marker: string) {
  return `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 15_000)`;
}

function waitForPid(marker: string) {
  return vi.waitFor(
    async () => {
      // The marker can be visible before its pid is written.
      const pid = Number(await readFile(marker, "utf8"));
      if (!pid) throw new Error("pid not written");
      return pid;
    },
    { timeout: 5_000 },
  );
}

function expectStopped(pid: number) {
  expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
}

it("reuses a worker and returns text and binary output with cwd, stdin and env overrides", async () => {
  pool = new GitExecPool();
  expect(await node('process.stdout.write("out"); process.stderr.write("err")')).toEqual({
    stdout: "out",
    stderr: "err",
  });
  vi.stubEnv("BYCODA_POOL_INHERITED_TEST", "inherited");
  vi.stubEnv("BYCODA_POOL_OVERRIDE_TEST", "original");
  const directory = await markerDirectory();
  const { stdout, stderr } = await node(
    `
    const meta = [process.cwd(), process.env.BYCODA_POOL_INHERITED_TEST, process.env.BYCODA_POOL_OVERRIDE_TEST];
    process.stderr.write(JSON.stringify(meta));
    process.stdin.pipe(process.stdout);
  `,
    {
      cwd: directory,
      encoding: "buffer",
      input: Buffer.from([0, 255, 10]),
      env: { BYCODA_POOL_OVERRIDE_TEST: "override" },
    },
  );
  expect(stdout).toEqual(Buffer.from([0, 255, 10]));
  expect(JSON.parse(stderr.toString())).toEqual([directory, "inherited", "override"]);
  expect(process.env.BYCODA_POOL_OVERRIDE_TEST).toBe("original");
});

it("includes exit metadata and captured output on a nonzero exit", async () => {
  pool = new GitExecPool();
  await expect(
    node('process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7'),
  ).rejects.toMatchObject({ killed: false, code: 7, signal: null, stdout: "out", stderr: "err" });
});

it("preserves the native maxBuffer error and truncated output", async () => {
  pool = new GitExecPool();
  await expect(node('process.stdout.write("123456789")', { maxBuffer: 4 })).rejects.toMatchObject({
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    stdout: "1234",
    stderr: "",
  });
});

it("kills active commands at their deadline and releases the slot", async () => {
  pool = new GitExecPool(1);
  const marker = join(await markerDirectory(), "timeout");
  await node("");
  const pending = node(waitingChild(marker), { timeout: 1_500 });
  const result = expect(pending).rejects.toMatchObject({
    killed: true,
    code: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: "",
  });
  const pid = await waitForPid(marker);
  await result;
  expectStopped(pid);
  expect(await node('process.stdout.write("next")')).toMatchObject({ stdout: "next" });
});

it("bounds the queue and removes aborted and expired jobs before spawn", async () => {
  pool = new GitExecPool(1, 2);
  const directory = await markerDirectory();
  const active = node(waitingChild(join(directory, "active")));
  const activeResult = expect(active).rejects.toMatchObject({ code: "ECANCELED" });
  const controller = new AbortController();
  const aborted = join(directory, "aborted");
  const expired = join(directory, "expired");
  const queued = node(waitingChild(aborted), { signal: controller.signal });
  const timeout = node(waitingChild(expired), { timeout: 100 });
  const timedOut = expect(timeout).rejects.toMatchObject({ code: "ETIMEDOUT", killed: false });
  await expect(node("")).rejects.toMatchObject({ code: "EAGAIN" });
  controller.abort("cancel queued");
  await expect(queued).rejects.toMatchObject({
    code: "ABORT_ERR",
    cause: "cancel queued",
    killed: false,
  });
  await timedOut;
  await pool.close();
  await activeResult;
  await expect(readFile(aborted)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(expired)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(node("")).rejects.toMatchObject({ code: "ECANCELED" });
});

it("runs children concurrently and aborts an active child without stopping its sibling", async () => {
  pool = new GitExecPool(2);
  const directory = await markerDirectory();
  const marker = join(directory, "abort");
  const controller = new AbortController();
  const active = node(waitingChild(marker), { signal: controller.signal });
  const pid = await waitForPid(marker);
  const sibling = node('process.stdout.write("sibling")');
  const result = expect(active).rejects.toMatchObject({
    name: "AbortError",
    code: "ABORT_ERR",
    killed: true,
  });
  await expect(sibling).resolves.toMatchObject({ stdout: "sibling" });
  controller.abort();
  await result;
  expectStopped(pid);
});

it("does not spawn a dispatched command aborted before the worker receives it", async () => {
  const startup = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  pool = new GitExecPool(
    1,
    1,
    (source) =>
      new Worker(
        'Atomics.wait(require("node:worker_threads").workerData, 0, 0, 5000);\n' + source,
        { eval: true, execArgv: [], workerData: startup },
      ),
  );
  const marker = join(await markerDirectory(), "before-launch");
  const controller = new AbortController();
  const pending = node(waitingChild(marker), { signal: controller.signal });
  controller.abort();
  Atomics.store(startup, 0, 1);
  Atomics.notify(startup, 0);
  await expect(pending).rejects.toMatchObject({ code: "ABORT_ERR", killed: false });
  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects calls from a crashed worker and starts a replacement for queued work", async () => {
  const workers: Worker[] = [];
  pool = new GitExecPool(1, 2, (source) => {
    const worker = new Worker(
      source +
        `
      parentPort.on("message", (message) => {
        if (message.type === "crash") throw new Error("fixture worker crash");
      });
    `,
      { eval: true, execArgv: [] },
    );
    workers.push(worker);
    return worker;
  });
  const marker = join(await markerDirectory(), "crash");
  const pending = node(waitingChild(marker));
  const failure = expect(pending).rejects.toMatchObject({
    code: "EIO",
    message: "fixture worker crash",
  });
  const pid = await waitForPid(marker);
  const queued = node('process.stdout.write("recovered")');
  workers[0].postMessage({ type: "crash" });
  try {
    await failure;
    await expect(queued).resolves.toMatchObject({ stdout: "recovered" });
    expect(workers).toHaveLength(2);
    await vi.waitFor(() => expectStopped(pid));
  } catch (error) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already stopped by worker teardown.
    }
    throw error;
  }
});

it("waits for active children to stop during close", async () => {
  pool = new GitExecPool();
  const marker = join(await markerDirectory(), "close");
  const pending = node(waitingChild(marker));
  const result = expect(pending).rejects.toMatchObject({ code: "ECANCELED", killed: true });
  const pid = await waitForPid(marker);
  await pool.close();
  await result;
  expectStopped(pid);
});

it("keeps slow network commands from starving default-lane probes", async () => {
  pool = new GitExecPool(4, 16);
  const directory = await markerDirectory();
  const slow = Array.from({ length: 4 }, (_, index) => {
    const marker = join(directory, `network-${index}`);
    return {
      marker,
      result: node(waitingChild(marker), { lane: "network" }).catch((error) => error),
    };
  });
  // Two network jobs run; the other two wait in the queue ahead of the probe.
  await Promise.all(slow.slice(0, 2).map(({ marker }) => waitForPid(marker)));
  await expect(node('process.stdout.write("probe")', { timeout: 5_000 })).resolves.toMatchObject({
    stdout: "probe",
  });
  await expect(readFile(slow[2].marker)).rejects.toMatchObject({ code: "ENOENT" });
  await pool.close();
  for (const { result } of slow) expect(await result).toMatchObject({ code: "ECANCELED" });
});

function treeChild(parentMarker: string, grandchildMarker: string) {
  const grandchild = `require("node:fs").writeFileSync(${JSON.stringify(grandchildMarker)}, String(process.pid)); setTimeout(() => {}, 30_000)`;
  return `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
    ${waitingChild(parentMarker)}
  `;
}

async function expectTreeStopped(grandchild: number) {
  try {
    await vi.waitFor(() => expectStopped(grandchild), { timeout: 5_000 });
  } finally {
    try {
      process.kill(grandchild, "SIGKILL");
    } catch {
      // Already stopped.
    }
  }
}

it("stops grandchildren when a command times out", async () => {
  pool = new GitExecPool(1);
  const directory = await markerDirectory();
  const grandchildMarker = join(directory, "grandchild-timeout");
  const pending = expect(
    node(treeChild(join(directory, "parent-timeout"), grandchildMarker), { timeout: 2_000 }),
  ).rejects.toMatchObject({ killed: true, code: null });
  const grandchild = await waitForPid(grandchildMarker);
  await pending;
  await expectTreeStopped(grandchild);
});

it("stops grandchildren when a command is aborted", async () => {
  pool = new GitExecPool(1);
  const directory = await markerDirectory();
  const grandchildMarker = join(directory, "grandchild-abort");
  const controller = new AbortController();
  const pending = expect(
    node(treeChild(join(directory, "parent-abort"), grandchildMarker), {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: "ABORT_ERR", killed: true });
  const grandchild = await waitForPid(grandchildMarker);
  controller.abort();
  await pending;
  await expectTreeStopped(grandchild);
});

it("stops grandchildren when the pool closes", async () => {
  pool = new GitExecPool(1);
  const directory = await markerDirectory();
  const grandchildMarker = join(directory, "grandchild-close");
  const pending = expect(
    node(treeChild(join(directory, "parent-close"), grandchildMarker)),
  ).rejects.toMatchObject({ code: "ECANCELED", killed: true });
  const grandchild = await waitForPid(grandchildMarker);
  await pool.close();
  await pending;
  await expectTreeStopped(grandchild);
});
