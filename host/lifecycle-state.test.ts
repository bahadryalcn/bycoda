import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireHostOwner } from "./owner";
import {
  HOST_SHUTDOWN_DEADLINE_MS,
  HOST_STOP_WAIT_MS,
  readRunningHost,
  verifyHostStopped,
} from "./lifecycle-state";

let directory: string;
let release: (() => void) | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "bycoda-lifecycle-state-"));
});
afterEach(() => {
  release?.();
  release = undefined;
  rmSync(directory, { recursive: true, force: true });
});

it.each([undefined, "", "{broken", '{"pid":-1,"port":0,"secret":""}'])(
  "does not report stopped for an owned Host with unavailable lifecycle metadata %j",
  async (text) => {
    release = await acquireHostOwner(directory);
    if (text !== undefined) writeFileSync(join(directory, "running.json"), text);
    expect(readRunningHost(directory)).toBeUndefined();
    await expect(verifyHostStopped(directory)).rejects.toThrow("still owns");
    if (text !== undefined)
      expect(readFileSync(join(directory, "running.json"), "utf8")).toBe(text);
  },
);

it("recovers after metadata repair without discarding the live owner", async () => {
  release = await acquireHostOwner(directory);
  writeFileSync(join(directory, "running.json"), "broken");
  expect(readRunningHost(directory)).toBeUndefined();
  const valid = { pid: process.pid, port: 3776, secret: "fixture-only" };
  writeFileSync(join(directory, "running.json"), JSON.stringify(valid));
  expect(readRunningHost(directory)).toEqual(valid);
  await expect(verifyHostStopped(directory)).rejects.toThrow("still owns");
});

it("certifies stopped only when no owner remains", async () => {
  await expect(verifyHostStopped(directory)).resolves.toBeUndefined();
  release = await acquireHostOwner(directory);
  release();
  release = undefined;
  await expect(verifyHostStopped(directory)).resolves.toBeUndefined();
  // A damaged sentinel without a live legacy PID is repaired by the next owner, so it no
  // longer blocks certification; one that names a live PID still does.
  writeFileSync(join(directory, "owner.lock"), "broken");
  await expect(verifyHostStopped(directory)).resolves.toBeUndefined();
  writeFileSync(join(directory, "owner.lock"), `{"pid":${process.pid}`);
  await expect(verifyHostStopped(directory)).rejects.toThrow("unknown");
});

it("waits for a stopping Host longer than the Host may take to force its exit", () => {
  // Upgrades failed with "Could not stop the old host service" while the old
  // Host was still inside its 45 s drain: the caller gave up after 20 s.
  expect(HOST_STOP_WAIT_MS).toBeGreaterThan(HOST_SHUTDOWN_DEADLINE_MS);
});
