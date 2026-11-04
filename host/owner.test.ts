import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireHostOwner, probeHostOwner } from "./owner";

it("rejects simultaneous owners and recovers a stale modern PID lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-"));
  let release: (() => void) | undefined;
  try {
    release = await acquireHostOwner(directory);
    await expect(acquireHostOwner(directory)).rejects.toThrow("already owns");
    release();
    release = undefined;
    writeFileSync(join(directory, "owner.lock"), JSON.stringify({ version: 2, pid: process.pid }));
    release = await acquireHostOwner(directory);
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("probes the kernel lease even when the PID sentinel is missing or corrupt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-probe-"));
  let release: (() => void) | undefined;
  try {
    expect(await probeHostOwner(directory)).toBe("stopped");
    release = await acquireHostOwner(directory);
    rmSync(join(directory, "owner.lock"));
    expect(await probeHostOwner(directory)).toBe("active");
    writeFileSync(join(directory, "owner.lock"), "");
    expect(await probeHostOwner(directory)).toBe("active");
    release();
    release = undefined;
    expect(await probeHostOwner(directory)).toBe("unknown");
    await expect(acquireHostOwner(directory)).rejects.toThrow("incomplete");
    expect(readFileSync(join(directory, "owner.lock"), "utf8")).toBe("");
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("makes release idempotent without removing the following owner's sentinel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-release-"));
  let second: (() => void) | undefined;
  try {
    const first = await acquireHostOwner(directory);
    first();
    second = await acquireHostOwner(directory);
    const retained = readFileSync(join(directory, "owner.lock"), "utf8");
    first();
    expect(readFileSync(join(directory, "owner.lock"), "utf8")).toBe(retained);
    expect(await probeHostOwner(directory)).toBe("active");
  } finally {
    second?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not certify a modern PID record without its kernel lease database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-missing-db-"));
  try {
    writeFileSync(join(directory, "owner.lock"), JSON.stringify({ version: 2, pid: process.pid }));
    expect(await probeHostOwner(directory)).toBe("unknown");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps an unrecognized live legacy process unknown instead of replacing its sentinel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-live-legacy-"));
  try {
    writeFileSync(join(directory, "owner.lock"), String(process.pid));
    expect(await probeHostOwner(directory)).toBe("unknown");
    await expect(acquireHostOwner(directory)).rejects.toThrow("could not be verified");
    expect(readFileSync(join(directory, "owner.lock"), "utf8")).toBe(String(process.pid));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 65_000);
