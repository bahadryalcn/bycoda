import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { runPowerShell } from "./windows";
import { readStateFileSync, writeFileAtomicSync } from "./storage/atomic-write";

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
    const state = readStateFileSync(join(directory, "owner.lock"), parseOwner, {
      quarantine: false,
    });
    if (state.status === "corrupt") return "unknown";
    if (state.status === "missing") return "stopped";
    if (state.value.version === 2) return hasDatabase ? "stopped" : "unknown";
    return await inspectLegacyOwner(state.value.pid);
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
    const state = readStateFileSync(path, parseOwner, { quarantine: true });
    if (state.status === "corrupt") {
      // The exclusive SQLite lock above proves no version 2 owner is alive, so a corrupt
      // sentinel carries no authority. Keep its bytes as evidence and replace it.
      console.warn(
        `Host owner.lock was unreadable; retained evidence at ${state.quarantined ?? "an unavailable path"} and replacing it.`,
      );
    }
    if (state.status === "ok") {
      // Version 2 owners hold the SQLite lock we just acquired. Their leftover
      // PID file is therefore stale, regardless of which process owns that PID.
      if (state.value.version === 1 && (await inspectLegacyOwner(state.value.pid)) !== "stopped")
        throw new Error(
          "A host already owns this data directory, or its owner could not be verified",
        );
    }
    // Old clients cannot mistake this for a dead PID and take ownership.
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
