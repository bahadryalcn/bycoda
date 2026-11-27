import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import {
  BYKIT_HINT,
  bykitAvailable,
  bykitHint,
  readBykitEnabled,
  resetBykitCache,
  saveBykitEnabled,
} from "./bykit-hint";

const cleanups: (() => Promise<void>)[] = [];

function store() {
  const dir = mkdtempSync(join(tmpdir(), "bykit-"));
  const host = new HostStore(join(dir, "host.db"));
  cleanups.push(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return host;
}

beforeEach(() => {
  resetBykitCache();
  vi.useRealTimers();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("adds the instruction block only when bykit resolves", async () => {
  const host = store();
  const hint = await bykitHint(host, async () => "/usr/bin/bykit");
  expect(hint).toBe(BYKIT_HINT);
  expect(hint).toContain("Never write Python/Node/shell scripts or heredocs that write files");
  expect(hint).toContain("bykit edit");
  expect(hint).toContain("name the gap in your report");
  expect(hint.split("\n").length).toBeLessThanOrEqual(6);
  resetBykitCache();
  expect(await bykitHint(host, async () => undefined)).toBe("");
});

it("follows the owner's switch, which is on until a choice is saved", async () => {
  const host = store();
  const installed = async () => "/usr/bin/bykit";
  expect(await readBykitEnabled(host)).toBe(true);
  expect(await saveBykitEnabled(host, false)).toBe(false);
  expect(await readBykitEnabled(host)).toBe(false);
  expect(await bykitHint(host, installed)).toBe("");
  await saveBykitEnabled(host, true);
  expect(await bykitHint(host, installed)).toBe(BYKIT_HINT);
  await expect(saveBykitEnabled(host, "off")).rejects.toThrow("true or false");
  expect(await readBykitEnabled(host)).toBe(true);
});

it("treats a lookup error as absent", async () => {
  expect(await bykitAvailable(() => Promise.reject(new Error("denied")))).toBe(false);
});

it("treats a hung lookup as absent after the deadline", async () => {
  vi.useFakeTimers();
  const pending = bykitAvailable(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toBe(false);
});

it("reuses the answer for a minute, then looks again", async () => {
  const lookup = vi.fn(async () => "bykit");
  let now = 1_000;
  await bykitAvailable(lookup, () => now);
  now += 30_000;
  await bykitAvailable(lookup, () => now);
  expect(lookup).toHaveBeenCalledTimes(1);
  now += 40_000;
  await bykitAvailable(lookup, () => now);
  expect(lookup).toHaveBeenCalledTimes(2);
});

it("gives the hint for a bundled-only bykit and stays empty when the switch is off", async () => {
  const host = store();
  const bundled = () => "/host/bin/bykit";
  expect(await bykitHint(host, async () => undefined, undefined, bundled)).toBe(BYKIT_HINT);
  await saveBykitEnabled(host, false);
  expect(await bykitHint(host, async () => undefined, undefined, bundled)).toBe("");
});
