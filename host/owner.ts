import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { runPowerShell } from "./windows";
import { writeFileAtomicSync } from "./storage/atomic-write";
import { renameWithRetrySync } from "./storage/rename-retry";

type OwnerState = { version: 2; pid: number } | { version: 1; pid: number };
function parseOwner(text: string): OwnerState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    /* A legacy owner is a plain PID. */
  }
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    value.version === 2 &&
    "pid" in value &&
    Number.isSafeInteger(value.pid) &&
    Number(value.pid) > 0
  )
    return { version: 2, pid: Number(value.pid) };
  if (!/^\s*\d+\s*$/.test(text)) throw new Error("Invalid host owner record");
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid host owner PID");
  return { version: 1, pid };
}

export type HostOwnerStatus = "active" | "stopped" | "unknown";

/** Corrupt owner.lock copies kept for inspection; older copies are deleted. */
const QUARANTINE_LIMIT = 3;

type SentinelRead =
  | { status: "missing" }
  | { status: "ok"; value: OwnerState }
  | { status: "corrupt"; text: string };

function readSentinel(path: string): SentinelRead {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw error;
  }
  const text = bytes.toString("utf8");
  try {
    return { status: "ok", value: parseOwner(text) };
  } catch {
    return { status: "corrupt", text };
  }
}

/** A damaged sentinel may still name the legacy owner it was written by. */
function recoverLegacyPid(text: string): number | undefined {
  const match = /"pid"\s*:\s*(\d+)/.exec(text);
  const pid = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** Move corrupt bytes aside, never over existing evidence, then prune the oldest copies. */
function quarantineSentinel(path: string): string {
  const base = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let target = base;
  for (let attempt = 1; existsSync(target); attempt++) target = `${base}-${attempt}`;
  renameWithRetrySync(path, target);
  const directory = dirname(path);
  const prefix = `${basename(path)}.corrupt-`;
  // ISO timestamps sort chronologically, so lexical order is age order.
  const copies = readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .sort();
  for (const name of copies.slice(0, Math.max(0, copies.length - QUARANTINE_LIMIT)))
    rmSync(join(directory, name), { force: true });
  return target;
}

async function inspectLegacyOwner(pid: number): Promise<HostOwnerStatus> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "stopped" : "unknown";
  }
  try {
    const command =
      process.platform === "win32"
        ? await runPowerShell(
            `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p.CommandLine) { throw 'Cannot inspect host lock owner' }; $p.CommandLine`,
          )
        : (await exec("ps", ["-ww", "-p", String(pid), "-o", "args="], { timeout: 5_000 })).stdout;
    if (!command.trim()) return "unknown";
    // A readable command can confirm a known Host, but a custom wrapper may hide it.
    return /(?:bycoda-host|host\.(?:mjs|js|ts))\b.*\bserve\b/.test(command) ? "active" : "unknown";
  } catch {
    return "unknown";
  }
}

/** Probe the kernel lease before treating missing lifecycle metadata as a stopped Host. */
export async function probeHostOwner(directory: string): Promise<HostOwnerStatus> {
  const databasePath = join(directory, "owner.db");
  let db: DatabaseSync | undefined;
  try {
    const hasDatabase = existsSync(databasePath);
    if (hasDatabase) {
      db = new DatabaseSync(databasePath);
      try {
        db.exec("BEGIN EXCLUSIVE");
      } catch (error) {
        const code = (error as { errcode?: number }).errcode;
        return code !== undefined && [5, 6].includes(code & 0xff) ? "active" : "unknown";
      }
    }
    const sentinel = readSentinel(join(directory, "owner.lock"));
    if (sentinel.status === "missing") return "stopped";
    if (sentinel.status === "corrupt") {
      // Without the lease database, damaged bytes cannot be attributed to a stopped owner.
      if (!hasDatabase) return "unknown";
      // The lease is held, so only a live legacy PID inside the bytes keeps the state unknown.
      const pid = recoverLegacyPid(sentinel.text);
      if (pid === undefined) return "stopped";
      return (await inspectLegacyOwner(pid)) === "stopped" ? "stopped" : "unknown";
    }
    if (sentinel.value.version === 2) return hasDatabase ? "stopped" : "unknown";
    return await inspectLegacyOwner(sentinel.value.pid);
  } catch {
    return "unknown";
  } finally {
    db?.close();
  }
}

/** Kernel-backed SQLite locking survives neither crashes nor PID reuse. The
 * PID file remains for compatibility with hosts installed before this lock. */
export async function acquireHostOwner(directory: string): Promise<() => void> {
  const db = new DatabaseSync(join(directory, "owner.db"));
  const path = join(directory, "owner.lock");
  const ownerText = JSON.stringify({ version: 2, pid: process.pid, nonce: randomUUID() });
  try {
    try {
      db.exec("BEGIN EXCLUSIVE");
    } catch {
      throw new Error("A host already owns this data directory");
    }
    // The exclusive lease above is the ownership proof, so a damaged sentinel alone carries no
    // authority. It is refused only while its bytes may name a live legacy owner.
    const sentinel = readSentinel(path);
    if (sentinel.status === "corrupt") {
      const pid = recoverLegacyPid(sentinel.text);
      if (pid !== undefined && (await inspectLegacyOwner(pid)) !== "stopped")
        throw new Error("Host lock is incomplete; inspect owner.lock before removing it");
      const evidence = quarantineSentinel(path);
      console.warn(
        `Host owner.lock was unreadable; retained evidence at ${evidence} and replacing it.`,
      );
    } else if (
      sentinel.status === "ok" &&
      sentinel.value.version === 1 &&
      (await inspectLegacyOwner(sentinel.value.pid)) !== "stopped"
    ) {
      throw new Error(
        "A host already owns this data directory, or its owner could not be verified",
      );
    }
    // Version 2 owners hold the SQLite lock we just acquired. Their leftover PID file is
    // therefore stale, regardless of which process owns that PID. Old clients cannot mistake
    // this for a dead PID and take ownership.
    writeFileAtomicSync(path, ownerText, {
      mode: 0o600,
    });
  } catch (error) {
    db.close();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      // A repeated release must not erase a newer owner's compatibility sentinel.
      if (readFileSync(path, "utf8") === ownerText) rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      db.close();
    }
  };
}
