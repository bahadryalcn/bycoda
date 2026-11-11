import { expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // The lease is free and the sentinel names no live legacy PID, so the Host is stopped.
    expect(await probeHostOwner(directory)).toBe("stopped");
    release = await acquireHostOwner(directory);
    expect(JSON.parse(readFileSync(join(directory, "owner.lock"), "utf8"))).toMatchObject({
      version: 2,
      pid: process.pid,
    });
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("records the boot time a prober measures the start-up grace from", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-boot-"));
  let release: (() => void) | undefined;
  try {
    const before = Date.now();
    release = await acquireHostOwner(directory);
    const sentinel = JSON.parse(readFileSync(join(directory, "owner.lock"), "utf8"));
    expect(sentinel).toMatchObject({ version: 2, pid: process.pid });
    expect(sentinel.startedAt).toBeGreaterThanOrEqual(before);
    expect(sentinel.startedAt).toBeLessThanOrEqual(Date.now());
    // The extra field does not change how the sentinel is read back.
    expect(await probeHostOwner(directory)).toBe("active");
    release();
    release = undefined;
    writeFileSync(join(directory, "owner.lock"), JSON.stringify(sentinel));
    expect(await probeHostOwner(directory)).toBe("stopped");
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

it("repairs a corrupt sentinel and keeps a quarantined copy of its bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-repair-"));
  let release: (() => void) | undefined;
  try {
    const corrupt = '{"version":2,"pid":';
    writeFileSync(join(directory, "owner.lock"), corrupt);
    release = await acquireHostOwner(directory);
    expect(JSON.parse(readFileSync(join(directory, "owner.lock"), "utf8"))).toMatchObject({
      version: 2,
      pid: process.pid,
    });
    const copies = readdirSync(directory).filter((name) => name.startsWith("owner.lock.corrupt-"));
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(directory, copies[0]), "utf8")).toBe(corrupt);
    expect(await probeHostOwner(directory)).toBe("active");
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("refuses a corrupt sentinel whose bytes name a live legacy PID and leaves it in place", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-corrupt-live-"));
  try {
    const corrupt = `{"version":2,"pid":${process.pid}`;
    writeFileSync(join(directory, "owner.lock"), corrupt);
    expect(await probeHostOwner(directory)).toBe("unknown");
    await expect(acquireHostOwner(directory)).rejects.toThrow("incomplete");
    expect(readFileSync(join(directory, "owner.lock"), "utf8")).toBe(corrupt);
    expect(readdirSync(directory).some((name) => name.includes(".corrupt-"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 65_000);

it("reports active while another owner holds the lease, even with a corrupt sentinel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-held-corrupt-"));
  let release: (() => void) | undefined;
  try {
    release = await acquireHostOwner(directory);
    const corrupt = "not-an-owner-record";
    writeFileSync(join(directory, "owner.lock"), corrupt);
    expect(await probeHostOwner(directory)).toBe("active");
    await expect(acquireHostOwner(directory)).rejects.toThrow("already owns");
    expect(readFileSync(join(directory, "owner.lock"), "utf8")).toBe(corrupt);
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps at most three quarantined sentinel copies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-quarantine-"));
  try {
    for (let round = 1; round <= 4; round++) {
      writeFileSync(join(directory, "owner.lock"), `corrupt-${round}`);
      const release = await acquireHostOwner(directory);
      release();
    }
    const copies = readdirSync(directory).filter((name) => name.startsWith("owner.lock.corrupt-"));
    expect(copies).toHaveLength(3);
    const retained = copies.map((name) => readFileSync(join(directory, name), "utf8")).sort();
    expect(retained).toEqual(["corrupt-2", "corrupt-3", "corrupt-4"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
