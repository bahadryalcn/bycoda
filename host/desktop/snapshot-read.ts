import type { HostSession } from "../../src/features/connections/model/protocol";
import { realpathSync, statSync } from "node:fs";
import type { SessionReadProcesses } from "../session-read-process";
import { SessionReadError } from "../sessions/read-errors";
import type { DesktopSnapshotRecord, DesktopStampRow } from "./desktopSessions";

/** Internal read provenance, never included in a public session response. */
export type DesktopReadSource = {
  database: string;
  physicalId: string;
  cwd: string;
  harness: string;
};

export function desktopReadSource(
  path: string,
  physicalId: string,
  cwd: string,
  harness: string,
): DesktopReadSource {
  const database = realpathSync(path);
  const file = statSync(database, { bigint: true });
  if (`${file.dev}:${file.ino}:${file.birthtimeNs}` !== physicalId)
    throw new SessionReadError("source-changed");
  return { database, physicalId, cwd, harness };
}

export async function readDesktopSnapshot(options: {
  reads: Pick<SessionReadProcesses, "read">;
  paths(): string[];
  platform: NodeJS.Platform;
  id: string;
  projectId: string;
  expectedProjectCwd?: string;
  signal: AbortSignal;
  assertCurrent(): void;
  isRunning(stored: boolean): boolean;
}): Promise<HostSession | undefined> {
  const { signal, id, projectId, expectedProjectCwd } = options;
  const request = {
    kind: "desktop" as const,
    paths: options.paths(),
    platform: options.platform,
    sessionId: id,
  };
  signal.throwIfAborted();
  const record = await options.reads.read<DesktopSnapshotRecord | undefined>(
    { ...request, method: "snapshot", projectId, expectedProjectCwd },
    signal,
  );
  options.assertCurrent();
  signal.throwIfAborted();
  if (!record) return undefined;
  const rows = await options.reads.read<DesktopStampRow[]>(
    { ...request, paths: options.paths(), method: "stamp" },
    signal,
  );
  options.assertCurrent();
  signal.throwIfAborted();
  // Match the earliest-created owning copy, preserving database order on ties.
  const owner = rows.reduce<DesktopStampRow | undefined>(
    (old, row) =>
      Number.isFinite(row.createdAt) &&
      (!old || !Number.isFinite(old.createdAt) || row.createdAt < old.createdAt)
        ? row
        : old,
    undefined,
  );
  const source = record.source;
  if (
    !owner ||
    !source ||
    !owner.source ||
    source.database !== owner.source.database ||
    source.physicalId !== owner.source.physicalId ||
    source.cwd !== owner.source.cwd ||
    source.harness !== owner.source.harness ||
    record.value.session.id !== id ||
    record.value.projectId !== projectId ||
    !Number.isFinite(record.value.revision) ||
    !Number.isFinite(owner.updatedAt) ||
    owner.updatedAt < record.value.revision ||
    (owner.createdAt || owner.updatedAt) !== record.value.createdAt
  )
    throw new SessionReadError("source-changed");
  // A later commit by the same owner does not invalidate this coherent read.
  // Return its actual revision so the next poll can request the later changes.
  const running = options.isRunning(record.stored);
  const { busy: _busy, ...session } = record.value.session;
  return {
    ...record.value,
    status: running ? "running" : "idle",
    session: { ...session, ...(running ? { busy: true } : {}) },
  };
}
