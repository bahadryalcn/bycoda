import type { Session } from "../../sessions/model/session";
import type { RemoteProject } from "./remoteProjects";

export type HostSessionBinding = {
  kind: "local-host";
  machineId: string;
  environmentId: string;
  projectId: string;
  /** Reserved before first send; never substituted following uncertain delivery. */
  sessionId: string;
  /** Null preserves canonical absence for an unfenced fresh Host session. */
  authorityGeneration: number | null;
  /** Receipt acknowledgement is independent of migration authority generation. */
  created: boolean;
};
const PREFIX = "bycoda.host-session-binding.v1:";
/** Unreadable records are moved here (bytes preserved) so they stop breaking every listing. */
const QUARANTINE_PREFIX = "bycoda.host-session-binding.quarantine.v1:";
/** A deleted marker keeps the routing fence this long, then its key is removed. */
export const HOST_SESSION_DELETED_TTL_MS = 30 * 86_400_000;

type StoredHostShell = {
  binding: HostSessionBinding;
  shell: Session;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  deletedAt?: number;
};

// Per-window index: the key scan runs once, each record is parsed once per
// distinct raw string (a listing compares strings, which is cheap), and the
// `storage` event keeps both current when another window writes.
let knownIds: Set<string> | undefined;
const records = new Map<string, { raw: string; record: StoredHostShell | undefined }>();
const warned = new Set<string>();
let storageListening = false;

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

function validRecord(shellId: string, value: unknown): value is StoredHostShell {
  const b = (value as { binding?: Partial<HostSessionBinding> } | null)?.binding;
  return !(
    b?.kind !== "local-host" ||
    ![b.machineId, b.environmentId, b.projectId, b.sessionId].every(
      (v) => typeof v === "string" && !!v,
    ) ||
    (b.authorityGeneration !== null &&
      (!Number.isSafeInteger(b.authorityGeneration) || (b.authorityGeneration as number) < 1)) ||
    typeof b.created !== "boolean" ||
    (value as { shell?: { id?: unknown } }).shell?.id !== shellId
  );
}

function listenForStorage() {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === null) {
      knownIds = undefined;
      records.clear();
      return;
    }
    if (!event.key.startsWith(PREFIX)) return;
    const shellId = event.key.slice(PREFIX.length);
    records.delete(shellId);
    if (event.newValue === null) knownIds?.delete(shellId);
    else knownIds?.add(shellId);
  });
}

function keyIndex(): Set<string> {
  if (knownIds) return knownIds;
  knownIds = new Set();
  if (storageAvailable()) {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) knownIds.add(key.slice(PREFIX.length));
    }
  }
  listenForStorage();
  return knownIds;
}

function forget(shellId: string) {
  records.delete(shellId);
  knownIds?.delete(shellId);
}

/** Set an unreadable record aside, once, without failing the caller. */
function quarantine(shellId: string, raw: string) {
  if (!warned.has(shellId)) {
    warned.add(shellId);
    console.warn(
      `Stored Host session owner for ${shellId} is unreadable and was set aside; reconnect that conversation before sending.`,
    );
  }
  try {
    localStorage.setItem(QUARANTINE_PREFIX + shellId, raw);
    localStorage.removeItem(PREFIX + shellId);
    forget(shellId);
  } catch {
    // No room to move it: remember it as invalid so it is skipped without another parse.
    records.set(shellId, { raw, record: undefined });
  }
}

function read(shellId: string): StoredHostShell | undefined {
  if (!storageAvailable()) return;
  const raw = localStorage.getItem(PREFIX + shellId);
  if (raw === null) {
    forget(shellId);
    return;
  }
  const cached = records.get(shellId);
  if (cached && cached.raw === raw) return cached.record;
  let record: StoredHostShell | undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (validRecord(shellId, value)) record = value;
  } catch {
    record = undefined;
  }
  if (!record) {
    quarantine(shellId, raw);
    return;
  }
  records.set(shellId, { raw, record });
  knownIds?.add(shellId);
  return record;
}

function isQuotaError(error: unknown): boolean {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

function storageError(error: unknown): Error {
  if (isQuotaError(error))
    return new Error(
      "Browser storage is full, so this Host conversation could not be saved locally. Delete old Host conversations or pending requests and try again.",
    );
  return new Error(
    `Could not save this Host conversation locally: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** Removes deleted markers older than their TTL; returns how many keys were freed. */
function expireDeletedMarkers(now = Date.now()): number {
  let freed = 0;
  for (const shellId of [...keyIndex()]) {
    const stored = read(shellId);
    if (!stored?.deleted || now - (stored.deletedAt ?? stored.updatedAt) < HOST_SESSION_DELETED_TTL_MS)
      continue;
    try {
      localStorage.removeItem(PREFIX + shellId);
      forget(shellId);
      freed++;
    } catch {
      // Still present; the next listing tries again.
    }
  }
  return freed;
}

function write(shellId: string, record: StoredHostShell): void {
  const raw = JSON.stringify(record);
  try {
    localStorage.setItem(PREFIX + shellId, raw);
  } catch (error) {
    // Out of room: free expired deleted markers and retry once before giving up.
    if (!isQuotaError(error) || expireDeletedMarkers() === 0) throw storageError(error);
    try {
      localStorage.setItem(PREFIX + shellId, raw);
    } catch (retryError) {
      throw storageError(retryError);
    }
  }
  records.set(shellId, { raw, record });
  knownIds?.add(shellId);
}

export function hostSessionBinding(
  session: Pick<Session, "id" | "hostBinding">,
): HostSessionBinding | undefined {
  return read(session.id)?.binding ?? session.hostBinding;
}

/** Must succeed before making the new tab available. No transcript is written
 * into Native's authoritative store; this is only a local display/default cache.
 * A full browser storage surfaces as a clear error, never a raw exception. */
export function saveHostSessionBinding(shell: Session, binding: HostSessionBinding): Session {
  const next = { ...shell, hostBinding: binding };
  const previous = read(shell.id);
  if (previous?.deleted) throw new Error("This Host conversation was deleted.");
  if (
    previous &&
    ["environmentId", "machineId", "projectId", "sessionId"].some(
      (key) =>
        previous.binding[key as keyof HostSessionBinding] !==
        binding[key as keyof HostSessionBinding],
    )
  )
    throw new Error("The session owner changed while the request was in flight.");
  if (
    previous?.binding.authorityGeneration !== undefined &&
    previous.binding.authorityGeneration !== null &&
    (binding.authorityGeneration === null ||
      binding.authorityGeneration < previous.binding.authorityGeneration)
  )
    throw new Error("The session authority changed while the request was in flight.");
  if (previous?.binding.created && !binding.created)
    throw new Error("An acknowledged Host conversation cannot become uncreated.");
  write(shell.id, {
    ...previous,
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    binding,
    shell: { ...next, blocks: [] },
  });
  return next;
}

/**
 * The binding a Host receipt or snapshot acknowledges. Pure validation with no
 * storage write: it throws when the owner changed, the Host returned another
 * session, or its authority generation moved backwards. Callers that also
 * project a display session from the receipt persist the result once through
 * `saveHostSessionBinding`, so a rejected owner leaves storage untouched.
 */
export function acknowledgedHostSessionBinding(
  shell: Session,
  sessionId: string,
  authorityGeneration: number | undefined,
): HostSessionBinding | undefined {
  const binding = hostSessionBinding(shell);
  if (!binding) return undefined;
  const expected = shell.hostBinding;
  if (
    expected &&
    ["environmentId", "machineId", "projectId", "sessionId"].some(
      (key) =>
        binding[key as keyof HostSessionBinding] !== expected[key as keyof HostSessionBinding],
    )
  )
    throw new Error("The session owner changed while the request was in flight.");
  if (
    binding.sessionId !== sessionId ||
    (authorityGeneration !== undefined &&
      (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 1)) ||
    (binding.authorityGeneration !== null &&
      (authorityGeneration === undefined || authorityGeneration < binding.authorityGeneration))
  )
    throw new Error("The Host returned a different session owner.");
  return { ...binding, created: true, authorityGeneration: authorityGeneration ?? null };
}

export function acknowledgeHostSessionBinding(
  shell: Session,
  sessionId: string,
  authorityGeneration: number | undefined,
): void {
  const binding = acknowledgedHostSessionBinding(shell, sessionId, authorityGeneration);
  if (binding) saveHostSessionBinding(shell, binding);
}

export function restoreHostSessionShell(shellId: string): Session | undefined {
  const stored = read(shellId);
  return stored ? { ...stored.shell, hostBinding: stored.binding, blocks: [] } : undefined;
}

export function hostSessionShellSummaries() {
  const summaries: Array<
    Pick<
      Session,
      | "id"
      | "cwd"
      | "title"
      | "harness"
      | "model"
      | "runtimeMode"
      | "worktreeCwd"
      | "branch"
      | "linkedWorkItem"
    > & {
      createdAt: number;
      updatedAt: number;
      archived?: boolean;
      pinned?: boolean;
    }
  > = [];
  if (!storageAvailable()) return summaries;
  const now = Date.now();
  for (const shellId of [...keyIndex()]) {
    const stored = read(shellId);
    if (!stored) continue;
    if (stored.deleted) {
      if (now - (stored.deletedAt ?? stored.updatedAt) >= HOST_SESSION_DELETED_TTL_MS) {
        try {
          localStorage.removeItem(PREFIX + shellId);
          forget(shellId);
        } catch {
          // Still present; the next listing tries again.
        }
      }
      continue;
    }
    if (!stored.binding.created) continue;
    const { shell, createdAt, updatedAt, archived, pinned } = stored;
    summaries.push({
      id: shell.id,
      cwd: shell.cwd,
      title: shell.title,
      harness: shell.harness,
      model: shell.model,
      runtimeMode: shell.runtimeMode,
      worktreeCwd: shell.worktreeCwd,
      branch: shell.branch,
      linkedWorkItem: shell.linkedWorkItem,
      createdAt,
      updatedAt,
      archived,
      pinned,
    });
  }
  return summaries;
}

export function patchHostSessionShellMetadata(
  shellId: string,
  patch: { archived?: boolean; pinned?: boolean },
): void {
  const stored = read(shellId);
  if (!stored) throw new Error("Missing session owner");
  write(shellId, { ...stored, ...patch });
}

export function forgetHostSessionShell(shellId: string): void {
  // A stale saved workspace must retain the routing fence after deletion; the
  // marker expires after HOST_SESSION_DELETED_TTL_MS.
  const stored = read(shellId);
  if (stored) write(shellId, { ...stored, deleted: true, deletedAt: Date.now() });
}

export function hostExecutionProject(shell: Session): RemoteProject | undefined {
  const binding = hostSessionBinding(shell);
  return binding
    ? {
        key: shell.cwd,
        cwd: shell.cwd,
        environmentId: binding.environmentId,
        projectId: binding.projectId,
      }
    : undefined;
}
