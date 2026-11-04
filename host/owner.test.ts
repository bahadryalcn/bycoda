import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireHostOwner } from "./owner";

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-owner-"));
  directories.push(directory);
  return directory;
}

it("rejects simultaneous owners and recovers a stale modern PID lock", async () => {
  const directory = fixture();
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
  }
});

it("writes the lock atomically and treats an empty or unparsable lock as stale", async () => {
  const directory = fixture();
  const lock = join(directory, "owner.lock");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const leftover of ["", "\n", "{\"version\":2,\"pi", "not a pid"]) {
    writeFileSync(lock, leftover);
    // The SQLite exclusive lock proves no other host owns the directory; a
    // truncated lock from a crash must not start a restart loop.
    const release = await acquireHostOwner(directory);
    try {
      expect(JSON.parse(readFileSync(lock, "utf8"))).toEqual({ version: 2, pid: process.pid });
      expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      release();
    }
  }
});

it("still refuses a legacy PID lock that belongs to a live host", async () => {
  const directory = fixture();
  // This test process is alive but is not a host, so the legacy check lets it through.
  writeFileSync(join(directory, "owner.lock"), String(process.pid));
  const release = await acquireHostOwner(directory);
  release();
  // A legacy lock that no longer names a process is stale.
  writeFileSync(join(directory, "owner.lock"), "2147483647");
  (await acquireHostOwner(directory))();
});
