import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";
import { DesktopPresenceWorker, readDesktopPresence } from "./desktop-presence";

it("logs why a failed desktop read counts this computer as away", async () => {
  const warn = vi.fn();
  const failed = await readDesktopPresence({
    platform: "win32",
    read: async () => {
      throw new Error("timed out");
    },
    warn,
  });
  expect(failed).toEqual({ supported: false, locked: true });
  expect(warn).toHaveBeenCalledWith(
    "Desktop presence could not be read; availability counts this computer as away.",
    "(timed out)",
  );
  const read = await readDesktopPresence({
    platform: "win32",
    read: async () => JSON.stringify({ locked: false, supported: true, idleMs: 42 }),
    warn,
  });
  expect(read).toEqual({ locked: false, supported: true, idleMs: 42 });
  expect(warn).toHaveBeenCalledTimes(1);
});

/** A fake resident helper: each stdin newline is one request, answered by `reply`. */
function fakeHelpers(reply: (count: number) => string | undefined) {
  const spawned: { args: string[]; child: ChildProcess; requests: number }[] = [];
  const spawn = (_binary: string, args: string[]) => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const entry = { args, child, requests: 0 };
    Object.assign(child, {
      stdin,
      stdout,
      exitCode: null,
      kill: () => {
        Object.assign(child, { exitCode: 1 });
        child.emit("exit", 1);
        return true;
      },
    });
    stdin.on("data", (chunk: Buffer) => {
      for (const _ of chunk.toString().split("\n").slice(1)) {
        entry.requests++;
        const line = reply(entry.requests);
        if (line !== undefined) stdout.write(`${line}\r\n`);
      }
    });
    spawned.push(entry);
    return child;
  };
  return { spawned, spawn };
}

it("keeps one hidden helper for repeated reads and shares a reading between concurrent callers", async () => {
  const helpers = fakeHelpers((count) =>
    JSON.stringify({ locked: false, supported: true, idleMs: count }),
  );
  const worker = new DesktopPresenceWorker(helpers.spawn);
  const [a, b] = await Promise.all([worker.read(1000), worker.read(1000)]);
  expect(a).toBe(b);
  expect(JSON.parse(await worker.read(1000)).idleMs).toBe(2);
  expect(helpers.spawned).toHaveLength(1);
  expect(helpers.spawned[0].args).toContain("Hidden");
  expect(helpers.spawned[0].requests).toBe(2);
  worker.stop();
});

it("kills a helper that does not answer in time and starts a fresh one on the next read", async () => {
  let answer = false;
  const helpers = fakeHelpers(() =>
    answer ? '{"locked":true,"supported":true,"idleMs":0}' : undefined,
  );
  const worker = new DesktopPresenceWorker(helpers.spawn);
  await expect(worker.read(20)).rejects.toThrow("timed out");
  expect(helpers.spawned[0].child.exitCode).toBe(1);
  answer = true;
  expect(JSON.parse(await worker.read(1000)).locked).toBe(true);
  expect(helpers.spawned).toHaveLength(2);
  worker.stop();
});

it("fails a pending read when the helper exits and stops an idle helper", async () => {
  let requests = 0;
  const helpers = fakeHelpers(() => (++requests === 1 ? undefined : '{"supported":false}'));
  const worker = new DesktopPresenceWorker(helpers.spawn, 30);
  const pending = worker.read(10_000);
  helpers.spawned[0].child.kill();
  await expect(pending).rejects.toThrow("exited");
  await worker.read(1000);
  expect(helpers.spawned).toHaveLength(2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(helpers.spawned[1].child.exitCode).toBe(1);
});

it.runIf(process.platform === "win32")(
  "answers repeated reads from one real helper well inside the deadline",
  async () => {
    const worker = new DesktopPresenceWorker();
    try {
      for (let i = 0; i < 3; i++) {
        const value = JSON.parse(await worker.read(15_000));
        expect(typeof value.locked).toBe("boolean");
        expect(Number.isSafeInteger(value.idleMs)).toBe(true);
      }
      const started = performance.now();
      await worker.read(15_000);
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      worker.stop();
    }
  },
  30_000,
);
