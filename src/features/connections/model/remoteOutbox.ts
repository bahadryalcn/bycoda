import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import type { HostCommand } from "./protocol";
import { t } from "../../../shared/i18n/core";
import { canonicalJson } from "../../sync/model/canonicalJson";
import {
  readPendingEntry,
  type AttachmentCommand,
  type PendingEntry,
} from "./remoteOutboxValidation";
import {
  remoteRequestPastRetryLimit,
  retryOutboxConflict,
  type OutboxRetry,
} from "./remoteOutboxRetry";
import {
  changeOutboxDatabase,
  readOutboxDatabasePage,
  readOutboxDatabaseRecord,
  readOutboxLegacyPage,
  readOutboxLegacyValue,
  settleOutboxDatabase,
  quarantineOutboxDatabase,
  OversizedOutboxRecordError,
  OutboxConflictError,
} from "./remoteOutboxDatabase";

export {
  REMOTE_REQUEST_RETRY_LIMIT_MS,
  remoteOutcomeUnknownMessage,
  remoteRequestPastRetryLimit,
  type OutboxRetry,
} from "./remoteOutboxRetry";

const PREFIX = "bycoda.remote-command.v1:";
const ARCHIVE_PREFIX = "bycoda.remote-command-quarantine.v1:";
const CHANGE = "bycoda:remote-outbox-change";
let outboxChannel: BroadcastChannel | undefined;
function ensureOutboxChannel() {
  if (outboxChannel || typeof BroadcastChannel === "undefined" || typeof window === "undefined")
    return;
  try {
    outboxChannel = new BroadcastChannel(CHANGE);
    outboxChannel.onmessage = () => window.dispatchEvent(new Event(CHANGE));
  } catch {
    // Authoritative reads still validate revision before an effect.
  }
}
const pendingPrefix = (project: string, environment: string) =>
  `${PREFIX}${JSON.stringify([project, environment])}:`;
export type OutboxIssue = {
  key: string;
  project: string;
  environment: string;
  unavailable?: boolean;
  loading?: boolean;
  oversized?: boolean;
  oversizedRecord?: { key: string; version: number; bytes: number; revision: number };
};
export type RemoteIntentAuthority = { authorityGeneration?: number };
/** Capture only while constructing a new intent. Never derive persisted intent provenance again. */
export function remoteIntentAuthority(
  source: RemoteIntentAuthority | undefined,
): RemoteIntentAuthority {
  const authorityGeneration = source?.authorityGeneration;
  if (authorityGeneration === undefined) return {};
  if (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 1)
    throw new Error(t("Cannot save an invalid remote request."));
  return { authorityGeneration };
}
/** An absent generation is meaningful legacy provenance, never permission to upgrade. */
export function remoteIntentAuthorityMatches(
  intent: RemoteIntentAuthority,
  snapshot: RemoteIntentAuthority | undefined,
): boolean {
  return (
    remoteIntentAuthority(intent).authorityGeneration ===
    remoteIntentAuthority(snapshot).authorityGeneration
  );
}

function scopeForKey(
  key: string,
): { project: string; environment: string; id: string } | undefined {
  if (!key.startsWith(PREFIX)) return;
  // Parse the complete tuple, not a colon-delimited path: paths can contain colons.
  const start = PREFIX.length;
  for (let end = key.indexOf("]:", start); end >= 0; end = key.indexOf("]:", end + 2)) {
    try {
      const scope: unknown = JSON.parse(key.slice(start, end + 1));
      if (Array.isArray(scope) && scope.length === 2 && scope.every((s) => typeof s === "string")) {
        return {
          project: scope[0],
          environment: scope[1],
          id: key.slice(end + 2),
        };
      }
    } catch {
      /* A bracket can also occur inside a project name. */
    }
  }
}

function oversizedSource(record: { key: string }) {
  return record.key.replace(/^(entries|legacy):/, "");
}
function oversizedOutsideScope(
  record: { key: string },
  project?: string,
  environment?: string,
): boolean {
  const scope = scopeForKey(oversizedSource(record));
  return (
    !!scope &&
    ((project !== undefined && scope.project !== project) ||
      (environment !== undefined && scope.environment !== environment))
  );
}

/** Invalid entries remain in place and never become dispatchable requests. */
export function remoteOutboxIssues(project?: string, environment?: string): OutboxIssue[] {
  const issues: OutboxIssue[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const scope = scopeForKey(key);
    if (
      scope &&
      ((project !== undefined && scope.project !== project) ||
        (environment !== undefined && scope.environment !== environment))
    )
      continue;
    const value = localStorage.getItem(key);
    if (value !== null && (!scope || !readPendingEntry(value, scope.id))) {
      issues.push({
        key,
        project: scope?.project ?? "Unknown project",
        environment: scope?.environment ?? "",
      });
    }
  }
  return issues.sort((a, b) => a.key.localeCompare(b.key));
}

const EMPTY_ISSUES: OutboxIssue[] = [];
const emptyIssues = () => EMPTY_ISSUES;

export function useRemoteOutboxIssues(project?: string, environment?: string): OutboxIssue[] {
  const snapshot = useMemo(() => {
    let previous: OutboxIssue[] = [];
    return () => {
      const next = remoteOutboxIssues(project, environment);
      if (
        next.length !== previous.length ||
        next.some(
          (item, index) =>
            item.key !== previous[index].key ||
            item.project !== previous[index].project ||
            item.environment !== previous[index].environment,
        )
      )
        previous = next;
      return previous;
    };
  }, [project, environment]);
  return useSyncExternalStore(subscribeOutbox, snapshot, emptyIssues);
}

export async function durableRemoteOutboxIssues(
  project?: string,
  environment?: string,
): Promise<OutboxIssue[]> {
  const issues = new Map<string, OutboxIssue>();
  const owners = new Map<string, OutboxIssue>();
  let revision: number | undefined;
  let after: string | undefined;
  const consider = (key: string, raw: string, force = false) => {
    const scope = scopeForKey(key);
    if (
      scope &&
      ((project !== undefined && scope.project !== project) ||
        (environment !== undefined && scope.environment !== environment))
    )
      return;
    const entry = scope && readPendingEntry(raw, scope.id);
    if (force || !scope || !entry) {
      issues.set(key, {
        key,
        project: scope?.project ?? "Unknown project",
        environment: scope?.environment ?? "",
      });
      return;
    }
    const owner = JSON.stringify([
      scope.project,
      scope.environment,
      entry.command.type === "create"
        ? ["create", entry.shellId ?? null]
        : ["session", entry.command.sessionId],
    ]);
    const issue = { key, project: scope.project, environment: scope.environment };
    const previous = owners.get(owner);
    if (previous && previous.key !== key) {
      issues.set(previous.key, previous);
      issues.set(key, issue);
    } else owners.set(owner, issue);
  };
  do {
    const page = await readOutboxDatabasePage("entries", PREFIX, after);
    if (revision !== undefined && page.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    revision = page.revision;
    if (page.oversized) {
      if (!oversizedOutsideScope(page.oversized, project, environment))
        throw new OversizedOutboxRecordError(page.oversized);
      after = oversizedSource(page.oversized);
      continue;
    }
    for (const item of page.values) consider(item.key, item.raw);
    after = page.next;
  } while (after !== undefined);
  let legacyAfter: string | undefined;
  do {
    const legacyPage = await readOutboxLegacyPage(legacyAfter, revision);
    if (legacyPage.revision !== undefined && legacyPage.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    if (legacyPage.oversized) {
      if (!oversizedOutsideScope(legacyPage.oversized, project, environment))
        throw new OversizedOutboxRecordError(legacyPage.oversized);
      legacyAfter = oversizedSource(legacyPage.oversized);
      continue;
    }
    for (const { key, raw } of legacyPage.values) {
      const scope = scopeForKey(key);
      if (
        scope &&
        ((project !== undefined && scope.project !== project) ||
          (environment !== undefined && scope.environment !== environment))
      )
        continue;
      const record = await readOutboxDatabaseRecord(key);
      if (record.revision !== revision || (await readOutboxLegacyValue(key)) !== raw)
        throw new OutboxConflictError("Pending requests changed; try again.");
      if (record.settlement === raw) continue;
      consider(key, raw, record.entry !== undefined && record.entry !== raw);
    }
    legacyAfter = legacyPage.next;
  } while (legacyAfter !== undefined);
  const check = await readOutboxDatabaseRecord(PREFIX);
  if (check.revision !== revision)
    throw new OutboxConflictError("Pending requests changed; try again.");
  return [...issues.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function useDurableRemoteOutboxIssues(
  project?: string,
  environment?: string,
): OutboxIssue[] {
  const [issues, setIssues] = useState<OutboxIssue[]>([
    { key: "", project: "", environment: "", unavailable: true, loading: true },
  ]);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      void durableRemoteOutboxIssues(project, environment)
        .then((value) => {
          if (active && current === generation) setIssues(value);
        })
        .catch((cause: unknown) => {
          if (active && current === generation) {
            const oversized =
              cause instanceof OversizedOutboxRecordError ? cause.record : undefined;
            const source = oversized?.key.replace(/^(entries|legacy):/, "");
            const owner = source ? scopeForKey(source) : undefined;
            const canExport =
              !!oversized &&
              !!project &&
              !!environment &&
              owner?.project === project &&
              owner.environment === environment;
            setIssues([
              {
                key: "",
                project: "",
                environment: "",
                unavailable: true,
                oversized: !!oversized,
                ...(canExport ? { oversizedRecord: oversized } : {}),
              },
            ]);
          }
        });
    };
    const unsubscribe = subscribeOutbox(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [project, environment]);
  return issues;
}

export async function archiveDurableRemoteOutboxIssue(key: string) {
  if (!(await durableRemoteOutboxIssues()).some((issue) => issue.key === key))
    throw new Error("This request no longer needs recovery.");
  const record = await readOutboxDatabaseRecord(key);
  const legacy = await readOutboxLegacyValue(key);
  if (record.entry === undefined && legacy === null)
    throw new Error("This request no longer needs recovery.");
  if ((await readOutboxLegacyValue(key)) !== legacy)
    throw new Error("The request changed during recovery.");
  await quarantineOutboxDatabase(key, record.entry ?? null, legacy, record.revision);
  changed();
}

export function subscribeOutbox(listener: () => void) {
  ensureOutboxChannel();
  let nativeTimer: number | undefined;
  const unsubscribeNative = isTauri()
    ? listenWindow<{ scope?: string }>("canonical-store-changed", (event) => {
        if (event.payload?.scope !== "remote-outbox.v2") return;
        if (nativeTimer !== undefined) window.clearTimeout(nativeTimer);
        nativeTimer = window.setTimeout(() => {
          nativeTimer = undefined;
          listener();
        }, 100);
      })
    : () => {};
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX) || event.key.startsWith(ARCHIVE_PREFIX))
      listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", listener);
  return () => {
    unsubscribeNative();
    if (nativeTimer !== undefined) window.clearTimeout(nativeTimer);
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", listener);
  };
}
function changed() {
  ensureOutboxChannel();
  window.dispatchEvent(new Event(CHANGE));
  try {
    outboxChannel?.postMessage(null);
  } catch {
    // Notification failure never changes the committed transaction outcome.
  }
}

/** Only called after the person checked the host; archive first, then release. */
export function archiveRemoteOutboxIssue(key: string) {
  if (isTauri()) throw new Error("Use durable remote request recovery.");
  if (!remoteOutboxIssues().some((issue) => issue.key === key))
    throw new Error("This request no longer needs recovery.");
  const value = localStorage.getItem(key);
  if (value === null) return;
  let preserved = localStorage.getItem(`${ARCHIVE_PREFIX}${key}`) === value;
  for (let index = 0; !preserved && index < localStorage.length; index++) {
    const archiveKey = localStorage.key(index);
    if (!archiveKey?.startsWith(`${ARCHIVE_PREFIX}[`)) continue;
    let identity: unknown;
    try {
      identity = JSON.parse(archiveKey.slice(ARCHIVE_PREFIX.length));
    } catch {
      // Keep unknown archive identities untouched.
      continue;
    }
    preserved =
      Array.isArray(identity) &&
      identity.length === 2 &&
      identity[0] === key &&
      typeof identity[1] === "string" &&
      localStorage.getItem(archiveKey) === value;
  }
  if (!preserved) {
    const archiveKey = `${ARCHIVE_PREFIX}${JSON.stringify([key, crypto.randomUUID()])}`;
    if (localStorage.getItem(archiveKey) !== null)
      throw new Error("Cannot safely archive this request. Try recovery again.");
    localStorage.setItem(archiveKey, value);
  }
  if (localStorage.getItem(key) !== value)
    throw new Error("The request changed during recovery. Review it again before continuing.");
  localStorage.removeItem(key);
  changed();
}

export function pendingRemoteFollowup(project: string, environment: string, id: string) {
  const value = localStorage.getItem(`${pendingPrefix(project, environment)}${id}`);
  return value ? readPendingEntry(value, id)?.followup : undefined;
}

/** Validated durable attachment inventory; an unreadable request is never empty. */
export function pendingRemoteAttachmentIds(
  project: string,
  environment: string,
  shellId: string,
): string[] {
  if (remoteOutboxIssues(project, environment).length)
    throw new Error("Attachment ownership is held by an unreadable pending request");
  const prefix = pendingPrefix(project, environment);
  const ids = new Set<string>();
  const collect = (command?: AttachmentCommand) => {
    if (!command) return;
    if ("attachments" in command) for (const file of command.attachments ?? []) ids.add(file.id);
    if (command.type === "create") collect(command.firstTurn);
  };
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const entry = readPendingEntry(localStorage.getItem(key) ?? "", key.slice(prefix.length));
    if (!entry || (entry.shellId && entry.shellId !== shellId)) continue;
    collect(entry.command);
    collect(entry.followup);
  }
  return [...ids];
}

export function pendingRemoteEnvironmentAttachmentIds(environment: string): string[] {
  if (remoteOutboxIssues(undefined, environment).length)
    throw new Error("Attachment ownership is held by an unreadable pending request");
  const ids = new Set<string>();
  const collect = (command?: AttachmentCommand) => {
    if (!command) return;
    if ("attachments" in command) for (const file of command.attachments ?? []) ids.add(file.id);
    if (command.type === "create") collect(command.firstTurn);
  };
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!;
    const scope = scopeForKey(key);
    if (!scope || scope.environment !== environment) continue;
    const entry = readPendingEntry(localStorage.getItem(key) ?? "", scope.id);
    if (!entry) throw new Error("Could not read pending attachment inventory");
    collect(entry.command);
    collect(entry.followup);
  }
  return [...ids];
}

export function pendingRemoteCommand(
  project: string,
  environment: string,
  sessionId?: string | null,
  shellId?: string,
): HostCommand | undefined {
  const prefix = pendingPrefix(project, environment);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const value = localStorage.getItem(key);
    const entry = value ? readPendingEntry(value, key.slice(prefix.length)) : undefined;
    if (!entry) continue;
    const command = entry.command;
    if (
      sessionId === undefined ||
      (sessionId === null
        ? command.type === "create" && (!entry.shellId || entry.shellId === shellId)
        : command.type !== "create" && command.sessionId === sessionId)
    )
      return command;
  }
}

export function savePendingRemoteCommand(
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
) {
  if (isTauri()) throw new Error("Use durable remote request admission.");
  if (remoteOutboxIssues(project, environment).length)
    throw new Error(
      t(
        "An unfinished request needs recovery. Check the host and review the request above before sending again.",
      ),
    );
  const existingRaw = localStorage.getItem(
    `${pendingPrefix(project, environment)}${command.commandId}`,
  );
  const existing = readPendingEntry(existingRaw ?? "", command.commandId);
  if (
    existing &&
    (canonicalJson(existing.command) !== canonicalJson(command) ||
      (followup !== undefined &&
        canonicalJson(existing.followup ?? null) !== canonicalJson(followup)))
  )
    throw new Error(
      t("The pending request changed. Recover the original request before sending again."),
    );
  const entry: PendingEntry = {
    v: 1,
    savedAt: existing?.savedAt ?? Date.now(),
    command: existing?.command ?? command,
    shellId: existing?.shellId ?? shellId,
    stopRequested: remoteCommandWasStopped(project, environment, command.commandId) || undefined,
    followup: followup ?? pendingRemoteFollowup(project, environment, command.commandId),
  };
  const json = JSON.stringify(entry);
  if (existing && existingRaw && canonicalJson(JSON.parse(existingRaw)) === canonicalJson(entry))
    return;
  if (json.length * 2 > 2 * 1024 * 1024)
    throw new Error(t("Remote request is too large to save safely."));
  let pendingBytes = 0;
  let pendingCount = 0;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (
      !(key?.startsWith(PREFIX) || key?.startsWith(ARCHIVE_PREFIX)) ||
      key === `${pendingPrefix(project, environment)}${command.commandId}`
    )
      continue;
    pendingCount++;
    pendingBytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
  }
  const pendingKey = `${pendingPrefix(project, environment)}${command.commandId}`;
  // Budget the legacy store below the ~5 MB origin quota so a full outbox is refused here, with
  // recovery guidance, instead of failing inside setItem.
  if (pendingCount >= 100 || pendingBytes + (pendingKey.length + json.length) * 2 > 4 * 1024 * 1024)
    throw new Error(t("Remote outbox is full. Recover pending requests before sending more."));
  if (!readPendingEntry(json, command.commandId))
    throw new Error(t("Cannot save an invalid remote request."));
  try {
    localStorage.setItem(`${pendingPrefix(project, environment)}${command.commandId}`, json);
  } catch {
    throw new Error(t("Cannot save your request locally. Free up app storage before sending."));
  }
  changed();
}

/** Legacy entries have no retry age; a missing receipt is not proof that their
 * external effect never happened. Keep them for explicit recovery. */
export function remoteCommandNeedsVerification(
  project: string,
  environment: string,
  commandId: string,
): boolean {
  const entry = readPendingEntry(
    localStorage.getItem(`${pendingPrefix(project, environment)}${commandId}`) ?? "",
    commandId,
  );
  return !entry?.savedAt || remoteRequestPastRetryLimit(commandId);
}
/** Persist Stop until the accepted command's exact run can be reconciled. */
export function markRemoteCommandStopped(
  project: string,
  environment: string,
  commandId: string,
): void {
  if (isTauri()) throw new Error("Use durable remote request settlement.");
  const key = `${pendingPrefix(project, environment)}${commandId}`;
  const entry = readPendingEntry(localStorage.getItem(key) ?? "", commandId);
  if (!entry) return;
  localStorage.setItem(key, JSON.stringify({ ...entry, stopRequested: true }));
  changed();
}
export function remoteCommandWasStopped(
  project: string,
  environment: string,
  commandId: string,
): boolean {
  return !!readPendingEntry(
    localStorage.getItem(`${pendingPrefix(project, environment)}${commandId}`) ?? "",
    commandId,
  )?.stopRequested;
}
export function clearPendingRemoteCommand(project: string, environment: string, commandId: string) {
  if (isTauri()) throw new Error("Use durable remote request settlement.");
  localStorage.removeItem(`${pendingPrefix(project, environment)}${commandId}`);
  changed();
}

/** Read durable and legacy evidence against one IDB revision. Unknown data holds sending. */
export function readDurableRemoteCommand(
  project: string,
  environment: string,
  sessionId?: string | null,
  shellId?: string,
  retry?: OutboxRetry,
): Promise<{ command?: HostCommand; revision: number }> {
  return retryOutboxConflict(
    () => readDurableRemoteCommandOnce(project, environment, sessionId, shellId),
    retry,
  );
}

async function readDurableRemoteCommandOnce(
  project: string,
  environment: string,
  sessionId?: string | null,
  shellId?: string,
): Promise<{ command?: HostCommand; revision: number }> {
  const prefix = pendingPrefix(project, environment);
  let after: string | undefined;
  let revision: number | undefined;
  let command: HostCommand | undefined;
  const consider = (key: string, raw: string) => {
    const scope = scopeForKey(key);
    if (!scope) throw new Error("An unreadable pending request requires recovery.");
    if (scope.project !== project || scope.environment !== environment) return;
    const entry = readPendingEntry(raw, scope.id);
    if (!entry) throw new Error("An unreadable pending request requires recovery.");
    if (
      sessionId === undefined ||
      (sessionId === null
        ? entry.command.type === "create" && (!entry.shellId || entry.shellId === shellId)
        : entry.command.type !== "create" && entry.command.sessionId === sessionId)
    ) {
      if (
        sessionId !== undefined &&
        command &&
        canonicalJson(command) !== canonicalJson(entry.command)
      )
        throw new Error("Multiple pending requests require recovery.");
      command ??= entry.command;
    }
  };
  do {
    const page = await readOutboxDatabasePage("entries", PREFIX, after);
    if (revision !== undefined && page.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    revision = page.revision;
    if (page.oversized) {
      if (!oversizedOutsideScope(page.oversized, project, environment))
        throw new OversizedOutboxRecordError(page.oversized);
      after = oversizedSource(page.oversized);
      continue;
    }
    for (const value of page.values) consider(value.key, value.raw);
    after = page.next;
  } while (after !== undefined);
  let legacyAfter: string | undefined;
  do {
    const legacyPage = await readOutboxLegacyPage(legacyAfter, revision);
    if (legacyPage.revision !== undefined && legacyPage.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    if (legacyPage.oversized) {
      if (!oversizedOutsideScope(legacyPage.oversized, project, environment))
        throw new OversizedOutboxRecordError(legacyPage.oversized);
      legacyAfter = oversizedSource(legacyPage.oversized);
      continue;
    }
    for (const { key, raw } of legacyPage.values) {
      const scope = scopeForKey(key);
      if (scope && (scope.project !== project || scope.environment !== environment)) continue;
      const record = await readOutboxDatabaseRecord(key);
      if (record.revision !== revision || (await readOutboxLegacyValue(key)) !== raw)
        throw new OutboxConflictError("Pending requests changed; try again.");
      if (record.settlement === raw) continue;
      if (record.entry !== undefined && record.entry !== raw)
        throw new Error("A pending request has conflicting saved versions.");
      if (record.entry === undefined) consider(key, raw);
    }
    legacyAfter = legacyPage.next;
  } while (legacyAfter !== undefined);
  const check = await readOutboxDatabaseRecord(prefix);
  if (check.revision !== revision)
    throw new OutboxConflictError("Pending requests changed; try again.");
  return { command, revision: revision ?? 0 };
}

/**
 * Persist the immutable command before any Host dispatch. A concurrent write to another
 * request re-runs the admission; the same request's admitted bytes are reused, never duplicated.
 */
export function admitDurableRemoteCommand(
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
  retry?: OutboxRetry,
): Promise<void> {
  return retryOutboxConflict(
    () => admitDurableRemoteCommandOnce(project, environment, command, shellId, followup),
    retry,
  );
}

async function admitDurableRemoteCommandOnce(
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
): Promise<void> {
  const sessionId = command.type === "create" ? null : command.sessionId;
  const observed = await readDurableRemoteCommandOnce(project, environment, sessionId, shellId);
  if (observed.command && canonicalJson(observed.command) !== canonicalJson(command))
    throw new Error(
      "The pending request changed. Recover the original request before sending again.",
    );
  const key = `${pendingPrefix(project, environment)}${command.commandId}`;
  const record = await readOutboxDatabaseRecord(key);
  const legacy = await readOutboxLegacyValue(key);
  if (record.revision !== observed.revision)
    throw new OutboxConflictError("Pending requests changed; try again.");
  if (record.entry === undefined && record.resolved)
    throw new Error("This request identity has already been resolved.");
  const existingRaw = record.entry ?? (record.settlement === legacy ? null : legacy);
  const existing = existingRaw ? readPendingEntry(existingRaw, command.commandId) : undefined;
  if (existingRaw && !existing) throw new Error("An unreadable pending request requires recovery.");
  if (
    existing &&
    (canonicalJson(existing.command) !== canonicalJson(command) ||
      (followup !== undefined &&
        canonicalJson(existing.followup ?? null) !== canonicalJson(followup)))
  )
    throw new Error(
      "The pending request changed. Recover the original request before sending again.",
    );
  const entry: PendingEntry = {
    v: 1,
    savedAt: existing?.savedAt ?? Date.now(),
    command: existing?.command ?? command,
    shellId: existing?.shellId ?? shellId,
    stopRequested: existing?.stopRequested,
    followup: followup ?? existing?.followup,
  };
  const raw = JSON.stringify(entry);
  if (raw.length * 2 > 2 * 1024 * 1024 || !readPendingEntry(raw, command.commandId))
    throw new Error("Cannot save an invalid or oversized remote request.");
  if ((await readOutboxLegacyValue(key)) !== legacy)
    throw new OutboxConflictError("Pending requests changed; try again.");
  await changeOutboxDatabase(
    key,
    record.entry ?? null,
    raw,
    legacy ?? undefined,
    observed.revision,
  );
  changed();
}

/** Definitive receipt settlement keeps the legacy bytes and, for creates, atomically saves the follow-up. */
export async function settleDurableRemoteCommand(
  project: string,
  environment: string,
  command: HostCommand,
  followup?: HostCommand,
  shellId?: string,
): Promise<void> {
  const key = `${pendingPrefix(project, environment)}${command.commandId}`;
  let record = await readOutboxDatabaseRecord(key);
  const legacy = await readOutboxLegacyValue(key);
  const original =
    record.entry ?? (record.settlement === legacy ? undefined : (legacy ?? undefined));
  const entry = original ? readPendingEntry(original, command.commandId) : undefined;
  if (!entry || canonicalJson(entry.command) !== canonicalJson(command))
    throw new Error("The pending request changed; check the host before continuing.");
  if (record.entry === undefined) {
    await changeOutboxDatabase(key, null, original!, legacy ?? undefined, record.revision);
    record = await readOutboxDatabaseRecord(key);
  }
  if (!record.entry || record.entry !== original || (await readOutboxLegacyValue(key)) !== legacy)
    throw new Error("The pending request changed; check the host before continuing.");
  let next: { key: string; raw: string } | undefined;
  if (followup) {
    const nextEntry: PendingEntry = { v: 1, savedAt: Date.now(), command: followup, shellId };
    const raw = JSON.stringify(nextEntry);
    if (raw.length * 2 > 2 * 1024 * 1024 || !readPendingEntry(raw, followup.commandId))
      throw new Error("Cannot save the follow-up request safely.");
    next = { key: `${pendingPrefix(project, environment)}${followup.commandId}`, raw };
    if ((await readOutboxLegacyValue(next.key)) !== null)
      throw new Error("The follow-up request has an existing saved identity.");
  }
  await settleOutboxDatabase(key, record.entry, legacy ?? undefined, next, record.revision);
  changed();
}

export async function readDurableRemoteEntry(
  project: string,
  environment: string,
  commandId: string,
) {
  const key = `${pendingPrefix(project, environment)}${commandId}`;
  const record = await readOutboxDatabaseRecord(key);
  const legacy = await readOutboxLegacyValue(key);
  if (
    legacy !== null &&
    record.settlement !== legacy &&
    record.entry !== undefined &&
    record.entry !== legacy
  )
    throw new Error("A pending request has conflicting saved versions.");
  const raw = record.entry ?? (record.settlement === legacy ? undefined : (legacy ?? undefined));
  const entry = raw ? readPendingEntry(raw, commandId) : undefined;
  if (raw && !entry) throw new Error("An unreadable pending request requires recovery.");
  if ((await readOutboxLegacyValue(key)) !== legacy)
    throw new OutboxConflictError("Pending requests changed; try again.");
  return { key, record, legacy, entry };
}

export async function markDurableRemoteCommandStopped(
  project: string,
  environment: string,
  commandId: string,
) {
  const { key, record, legacy, entry } = await readDurableRemoteEntry(
    project,
    environment,
    commandId,
  );
  if (!entry) throw new Error("The pending request changed; check the host before continuing.");
  if (entry.stopRequested) return;
  const raw = JSON.stringify({ ...entry, stopRequested: true });
  await changeOutboxDatabase(key, record.entry ?? null, raw, legacy ?? undefined, record.revision);
  changed();
}

/** Attachment cleanup requires a complete, stable durable inventory. */
export async function durableRemoteAttachmentIds(
  environment: string,
  project?: string,
  shellId?: string,
) {
  const ids = new Set<string>();
  let revision: number | undefined;
  let after: string | undefined;
  const collectCommand = (command?: AttachmentCommand) => {
    if (!command) return;
    if ("attachments" in command)
      for (const attachment of command.attachments ?? []) ids.add(attachment.id);
    if (command.type === "create") collectCommand(command.firstTurn);
  };
  const consider = (key: string, raw: string) => {
    const scope = scopeForKey(key);
    if (!scope) throw new Error("Attachment ownership is held by an unreadable pending request");
    if (scope.environment !== environment || (project !== undefined && scope.project !== project))
      return;
    const entry = readPendingEntry(raw, scope.id);
    if (!entry) throw new Error("Attachment ownership is held by an unreadable pending request");
    if (shellId && entry.shellId && entry.shellId !== shellId) return;
    collectCommand(entry.command);
    collectCommand(entry.followup);
  };
  do {
    const page = await readOutboxDatabasePage("entries", PREFIX, after);
    if (revision !== undefined && page.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    revision = page.revision;
    if (page.oversized) {
      if (!oversizedOutsideScope(page.oversized, project, environment))
        throw new OversizedOutboxRecordError(page.oversized);
      after = oversizedSource(page.oversized);
      continue;
    }
    for (const item of page.values) consider(item.key, item.raw);
    after = page.next;
  } while (after !== undefined);
  let legacyAfter: string | undefined;
  do {
    const legacyPage = await readOutboxLegacyPage(legacyAfter, revision);
    if (legacyPage.revision !== undefined && legacyPage.revision !== revision)
      throw new OutboxConflictError("Pending requests changed; try again.");
    if (legacyPage.oversized) {
      if (!oversizedOutsideScope(legacyPage.oversized, project, environment))
        throw new OversizedOutboxRecordError(legacyPage.oversized);
      legacyAfter = oversizedSource(legacyPage.oversized);
      continue;
    }
    for (const { key, raw } of legacyPage.values) {
      const scope = scopeForKey(key);
      if (
        scope &&
        (scope.environment !== environment || (project !== undefined && scope.project !== project))
      )
        continue;
      const record = await readOutboxDatabaseRecord(key);
      if (record.revision !== revision || (await readOutboxLegacyValue(key)) !== raw)
        throw new OutboxConflictError("Pending requests changed; try again.");
      if (record.settlement === raw) continue;
      if (record.entry !== undefined && record.entry !== raw)
        throw new Error("A pending request has conflicting saved versions.");
      if (record.entry === undefined) consider(key, raw);
    }
    legacyAfter = legacyPage.next;
  } while (legacyAfter !== undefined);
  const check = await readOutboxDatabaseRecord(PREFIX);
  if (check.revision !== revision)
    throw new OutboxConflictError("Pending requests changed; try again.");
  return [...ids];
}
