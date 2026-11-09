import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SocialBrowserLaunch } from "./social-browser-launch";
import type { PreparedGuardian } from "../provider-guardian-deployment";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function profile() {
  const directory = await mkdtemp(join(tmpdir(), "social-launch-capsule-"));
  directories.push(directory);
  return directory;
}
function fallback() {
  const child = Object.assign(new EventEmitter(), { pid: 41, kill: vi.fn(() => true) });
  const spawn = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
  return { child, spawn };
}
function native() {
  const proof = Promise.withResolvers<void>();
  let verified = false;
  const child = Object.assign(new EventEmitter(), {
    pid: 41,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    retirement: proof.promise,
    stop: vi.fn(async () => proof.promise),
  });
  Object.defineProperty(child, "retirementVerified", { get: () => verified });
  const prepared = {
    spawn: vi.fn(() => child),
    dispose: vi.fn(async () => {}),
    supportsBuildReceipt: vi.fn(async () => true),
  };
  return {
    child,
    prepared: prepared as unknown as PreparedGuardian,
    verify() {
      verified = true;
      proof.resolve();
      child.emit("close");
    },
  };
}

it("reserves profile before asynchronous preparation and refuses a second physical launch", async () => {
  const path = await profile();
  const ready = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<void>();
  const pending = SocialBrowserLaunch.reserve(path, {
    inUse: async () => false,
    prepare: async () => {
      started.resolve();
      return ready.promise;
    },
  });
  await started.promise;
  await expect(SocialBrowserLaunch.reserve(path, { inUse: async () => false })).rejects.toThrow(
    "reserved",
  );
  ready.resolve(undefined);
  const original = await pending;
  await original.startupFailed(async () => {}); // No browser effect was admitted.
});

it("failed handed-off fallback remains fenced despite launcher exit and free profile", async () => {
  const path = await profile();
  const fake = fallback();
  const ports = { inUse: async () => false, prepare: async () => undefined, spawn: fake.spawn };
  const original = await SocialBrowserLaunch.reserve(path, ports);
  await original.start("browser", []);
  fake.child.emit("exit", 0);
  const unlock = vi.fn(async () => {});
  await expect(original.startupFailed(unlock)).rejects.toThrow("unconfirmed");
  expect(unlock).not.toHaveBeenCalled();
  await expect(SocialBrowserLaunch.reserve(path, ports)).rejects.toThrow("unconfirmed");
  expect(fake.spawn).toHaveBeenCalledTimes(1);
});

it("native cleanup waits original retirement proof rather than launcher/guardian close alone", async () => {
  const path = await profile();
  const fake = native();
  const original = await SocialBrowserLaunch.reserve(path, {
    inUse: async () => false,
    prepare: async () => fake.prepared,
  });
  await original.start("browser", []);
  fake.child.emit("close");
  let released = false;
  const cleanup = original.startupFailed(async () => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  expect(fake.child.stop).toHaveBeenCalledOnce();
  fake.verify();
  await cleanup;
  expect(released).toBe(true);
  const next = await SocialBrowserLaunch.reserve(path, {
    inUse: async () => false,
    prepare: async () => undefined,
  });
  await next.startupFailed(async () => {});
});

it("successful fallback retains profile-specific reuse without inventing tree proof", async () => {
  const path = await profile();
  const fake = fallback();
  const ports = { inUse: async () => false, prepare: async () => undefined, spawn: fake.spawn };
  const original = await SocialBrowserLaunch.reserve(path, ports);
  await original.start("browser", []);
  original.markEstablished();
  fake.child.emit("exit", 0);
  const unlocked = Promise.withResolvers<void>();
  const release = original.releaseProfile(() => unlocked.promise);
  const waiting = SocialBrowserLaunch.reserve(path, ports);
  unlocked.resolve();
  await release;
  const next = await waiting;
  expect(fake.spawn).toHaveBeenCalledTimes(1);
  await next.startupFailed(async () => {});
});

it("ownership changes after reservation prevent spawn and dispose original prepared lease", async () => {
  const path = await profile();
  let inUse = false;
  const fake = native();
  const original = await SocialBrowserLaunch.reserve(path, {
    inUse: async () => inUse,
    prepare: async () => fake.prepared,
  });
  inUse = true;
  await expect(original.start("browser", [])).rejects.toThrow("ownership changed");
  await original.startupFailed(async () => {});
  expect(fake.prepared.spawn).not.toHaveBeenCalled();
  expect(fake.prepared.dispose).toHaveBeenCalledOnce();
});
