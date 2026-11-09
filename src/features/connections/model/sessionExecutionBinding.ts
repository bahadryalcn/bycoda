import type { Session } from "../../sessions";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteProject } from "./remoteProjects";
import {
  readBindingEvidencePage,
  writeBindingEvidence,
  preserveBindingSource,
  readBindingEvidence,
  skipImportedNativeBindingLegacy,
  type StoredBindingEvidence,
} from "./hostSessionBindingDatabase";
import { newRequestId } from "../../../shared/lib/id/requestId";

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
const canonical = new Map<string, StoredBindingEvidence>();
let hydrated = false;
let hydrating: Promise<void> | undefined;
const writes: Array<{ previous: StoredBindingEvidence | undefined; next: StoredBindingEvidence }> =
  [];
let saving: Promise<void> | undefined;
let canonicalEpoch = false;
let migrationOperationId: string | undefined;
const MIGRATION_SCOPE = "host-session-bindings-migration.v1";
const MIGRATION_KEY = "legacy-import";

async function bindingEpoch(): Promise<{
  active: boolean;
  claim?: { pageToken: string; operationId: string };
}> {
  if (!isTauri()) return { active: false };
  // Missing or failed readiness is unknown, never an authorization to cut over.
  const ready = await invoke<boolean>("canonical_store_session_guard_ready");
  if (ready !== true && ready !== false)
    throw new Error("Session ownership guard readiness is unknown.");
  if (!ready) return { active: false };
  const marker = await invoke<{ version: number; value: unknown } | null>("canonical_store_get", {
    scope: MIGRATION_SCOPE,
    key: MIGRATION_KEY,
  });
  if (marker?.value === true) {
    skipImportedNativeBindingLegacy();
    return { active: true };
  }
  if (marker) throw new Error("Invalid session owner migration marker.");
  const pageToken = await invoke<string>("canonical_store_page_token");
  const operationId = (migrationOperationId ??= crypto.randomUUID());
  let acquired = await invoke<{ owned: boolean; operationId: string }>("canonical_store_claim", {
    scope: MIGRATION_SCOPE,
    key: MIGRATION_KEY,
    operationId,
    pageToken,
  });
  if (!acquired.owned) {
    const recovered = await invoke<boolean>("canonical_store_recover", {
      scope: MIGRATION_SCOPE,
      key: MIGRATION_KEY,
      operationId: acquired.operationId,
      pageToken,
    });
    if (recovered)
      acquired = await invoke("canonical_store_claim", {
        scope: MIGRATION_SCOPE,
        key: MIGRATION_KEY,
        operationId,
        pageToken,
      });
  }
  if (!acquired.owned)
    throw new Error("Session owner migration is already in progress. Retry loading.");
  return { active: true, claim: { pageToken, operationId } };
}

async function finishBindingEpoch(claim: {
  pageToken: string;
  operationId: string;
}): Promise<void> {
  const result = await invoke<{ applied: boolean }>("canonical_store_transaction", {
    scope: MIGRATION_SCOPE,
    pageToken: claim.pageToken,
    operationId: newRequestId(),
    checks: [{ key: MIGRATION_KEY, version: null }],
    writes: [{ key: MIGRATION_KEY, value: true }],
    legacy: [],
    expectedRevision: null,
    claim: { key: MIGRATION_KEY, operationId: claim.operationId, mode: "require" },
  });
  if (!result.applied) throw new Error("Session owner migration was not confirmed.");
  if (
    !(await invoke<boolean>("canonical_store_settle", {
      scope: MIGRATION_SCOPE,
      key: MIGRATION_KEY,
      ...claim,
    }))
  )
    throw new Error("Session owner migration settlement is unknown.");
  skipImportedNativeBindingLegacy();
}

/** Synchronous acceptance can retain the draft while publication is pending. */
export function hostSessionBindingsPending(): boolean {
  return !hydrated || writes.length > 0;
}

/** Resolve every stored routing fence before absence can authorize Native execution. */
export function hydrateHostSessionBindings(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    const epoch = await bindingEpoch();
    const loaded = new Map<string, StoredBindingEvidence>();
    let after: string | undefined;
    for (;;) {
      const page = await readBindingEvidencePage(after);
      for (const row of page) loaded.set(row.shellId, row);
      if (page.length < 128) break;
      after = page[page.length - 1].shellId;
    }
    for (let index = 0; (!epoch.active || epoch.claim) && index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const shellId = key.slice(PREFIX.length);
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      if (loaded.has(shellId)) {
        await preserveBindingSource(shellId, raw);
        if (localStorage.getItem(key) !== raw)
          throw new Error("Session owner migration source changed.");
        continue;
      }
      const row = { shellId, raw, legacyRaw: raw };
      await writeBindingEvidence(undefined, row);
      if (localStorage.getItem(key) !== raw)
        throw new Error("Session owner migration source changed.");
      loaded.set(shellId, row);
    }
    if (epoch.claim) await finishBindingEpoch(epoch.claim);
    if (epoch.active) {
      // Native evidence and its recovery bytes committed before releasing quota.
      // Never remove a source that changed during migration or in another page.
      for (const row of loaded.values()) {
        if (row.legacyRaw !== null && localStorage.getItem(PREFIX + row.shellId) === row.legacyRaw)
          localStorage.removeItem(PREFIX + row.shellId);
      }
    }
    canonical.clear();
    for (const [id, row] of loaded) canonical.set(id, row);
    canonicalEpoch = epoch.active;
    hydrated = true;
  })().finally(() => {
    hydrating = undefined;
  });
  return hydrating;
}

/** Await durable owner publication before command admission or Native fallback. */
export async function flushHostSessionBindings(shellId?: string): Promise<void> {
  await hydrateHostSessionBindings();
  do {
    await drain();
    if (shellId !== undefined) {
      const latest = await readBindingEvidence(shellId);
      if (writes.length) continue;
      if (latest) canonical.set(shellId, latest);
      else canonical.delete(shellId);
    } else {
      // Canonical-only writers no longer emit localStorage change fences. Read
      // every owner before a caller uses this window's synchronous projection.
      const latest = new Map<string, StoredBindingEvidence>();
      let after: string | undefined;
      for (;;) {
        const page = await readBindingEvidencePage(after);
        for (const row of page) latest.set(row.shellId, row);
        if (page.length < 128) break;
        after = page[page.length - 1].shellId;
      }
      if (writes.length) continue;
      canonical.clear();
      for (const [id, row] of latest) canonical.set(id, row);
    }
  } while (writes.length);
}

function drain(): Promise<void> {
  if (saving) return saving;
  saving = (async () => {
    while (writes.length) {
      const { previous, next } = writes[0];
      await writeBindingEvidence(previous, next);
      writes.shift();
    }
  })().finally(() => {
    saving = undefined;
  });
  return saving;
}

/** True when the legacy key already holds `raw`; an unreadable store counts as different so the write still runs and reports its own error. */
function sameLegacyRaw(key: string, raw: string): boolean {
  try {
    return localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

function publish(shellId: string, raw: string): void {
  if (isTauri() && !hydrated) throw new Error("Session owner storage is still loading.");
  // Keep the old routing fence until every admission reads native authority.
  if (!canonicalEpoch && !sameLegacyRaw(PREFIX + shellId, raw))
    localStorage.setItem(PREFIX + shellId, raw);
  if (!hydrated) return;
  const previous = canonical.get(shellId);
  const next = { shellId, raw, legacyRaw: canonicalEpoch ? (previous?.legacyRaw ?? null) : raw };
  canonical.set(shellId, next);
  writes.push({ previous, next });
  void drain().catch(() => {});
}

type StoredHostShell = {
  binding: HostSessionBinding;
  shell: Session;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  pinned?: boolean;
  deleted?: boolean;
};
class InvalidStoredSessionOwner extends Error {
  constructor() {
    super("Invalid stored session owner; reconnect this conversation before sending.");
  }
}
function read(shellId: string): StoredHostShell | undefined {
  if (typeof localStorage === "undefined") return;
  const legacy = canonicalEpoch ? null : localStorage.getItem(PREFIX + shellId);
  const evidence = canonical.get(shellId);
  if (!canonicalEpoch && hydrated && evidence && legacy !== evidence.legacyRaw)
    throw new Error("The stored session owner changed. Reload before continuing.");
  if (!hydrated && typeof indexedDB !== "undefined")
    throw new Error("Session owner storage is still loading. Sending is held.");
  if (!canonicalEpoch && hydrated && !evidence && legacy !== null)
    throw new Error("A session owner appeared in another window. Reload before continuing.");
  const raw = hydrated ? (evidence?.raw ?? null) : legacy;
  if (raw === null) return;
  let value: ReturnType<typeof JSON.parse>;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidStoredSessionOwner();
  }
  const b = value?.binding;
  if (
    b?.kind !== "local-host" ||
    ![b.machineId, b.environmentId, b.projectId, b.sessionId].every(
      (v) => typeof v === "string" && !!v,
    ) ||
    (b.authorityGeneration !== null &&
      (!Number.isSafeInteger(b.authorityGeneration) || b.authorityGeneration < 1)) ||
    typeof b.created !== "boolean" ||
    value?.shell?.id !== shellId
  )
    throw new InvalidStoredSessionOwner();
  return value;
}

/** A malformed owner remains a fence for list projection, never an unowned row. */
export function hasHostSessionOwnerFence(shellId: string): boolean {
  try {
    return !!read(shellId);
  } catch (error) {
    if (error instanceof InvalidStoredSessionOwner) return true;
    throw error;
  }
}

export function hostSessionBinding(
  session: Pick<Session, "id" | "hostBinding">,
): HostSessionBinding | undefined {
  const stored = read(session.id);
  if (hydrated && !stored && session.hostBinding)
    throw new Error("The session owner has no durable record. Reconnect before sending.");
  return stored?.binding ?? session.hostBinding;
}

/** Must succeed before making the new tab available. No transcript is written
 * into Native's authoritative store; this is only a local display/default cache. */
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
  publish(
    shell.id,
    JSON.stringify({
      ...previous,
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      binding,
      shell: { ...next, blocks: [] },
    }),
  );
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
  if (typeof localStorage === "undefined") return summaries;
  const keys = hydrated
    ? [...canonical.keys()].map((id) => PREFIX + id)
    : Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(PREFIX)) continue;
    let stored: StoredHostShell | undefined;
    try {
      stored = read(key.slice(PREFIX.length));
    } catch (error) {
      if (error instanceof InvalidStoredSessionOwner) continue;
      throw error;
    }
    if (!stored?.binding.created || stored.deleted || !isUserConversation(stored.shell)) continue;
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
  publish(shellId, JSON.stringify({ ...stored, ...patch }));
}

export function forgetHostSessionShell(shellId: string): void {
  // A stale saved workspace must retain the routing fence after deletion.
  const stored = read(shellId);
  if (stored) publish(shellId, JSON.stringify({ ...stored, deleted: true }));
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
