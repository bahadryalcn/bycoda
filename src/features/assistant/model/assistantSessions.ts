import { useEffect, useState } from "react";
import type { HostSession } from "../../connections/model/protocol";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { shareStructure } from "../../../shared/lib/shareStructure";
import { captureAssistantHostRead, type AssistantHostRead } from "./assistantHostRead";
export type AssistantSessionRecord = HostSession & { environmentId: string };

export async function readAssistantSession(
  sessionId: string,
  projectId: string | readonly string[],
  owner?: AssistantHostRead,
): Promise<AssistantSessionRecord> {
  const reader = owner ?? (await captureAssistantHostRead());
  const result = await reader.session(sessionId);
  if (!result?.session || result.session.id !== sessionId)
    throw new Error("The Host returned no matching session state.");
  if (!(typeof projectId === "string" ? [projectId] : projectId).includes(result.projectId))
    throw new Error("The session project no longer matches this job.");
  if (
    !["idle", "running", "interrupted"].includes(result.status) ||
    !Number.isFinite(result.updatedAt) ||
    result.updatedAt < 0
  )
    throw new Error("The Host returned invalid session status.");
  return { ...result, environmentId: reader.environmentId };
}

type SessionState = {
  record: AssistantSessionRecord | null;
  loading: boolean;
  error: string;
};
type Entry = {
  sessionId: string;
  scope: string[];
  environmentId?: string;
  state: SessionState;
  listeners: Set<(state: SessionState) => void>;
  pending: Promise<void> | null;
  /** False once the last row left; a read that finishes later is dropped. */
  live: boolean;
};

const POLL_MS = 15000;
const INITIAL: SessionState = { record: null, loading: true, error: "" };
/** One entry per (session, project scope, Host) binding, shared by every row that shows it. */
const entries = new Map<string, Entry>();
/** One captured Host read owner per environment, so rows never repeat the capture handshake. */
const owners = new Map<string, Promise<AssistantHostRead>>();
let timer: ReturnType<typeof setInterval> | undefined;

function ownerFor(environmentId?: string) {
  const slot = environmentId ?? "";
  let owner = owners.get(slot);
  if (!owner) {
    owner = captureAssistantHostRead(environmentId);
    owners.set(slot, owner);
    // A failed capture is not cached; the next refresh captures again.
    owner.catch(() => {
      if (owners.get(slot) === owner) owners.delete(slot);
    });
  }
  return owner;
}

/** Notifies only when a field changed, so an identical background poll renders nothing. */
function publish(entry: Entry, next: SessionState) {
  const previous = entry.state;
  if (
    previous.record === next.record &&
    previous.loading === next.loading &&
    previous.error === next.error
  )
    return;
  entry.state = next;
  for (const listener of entry.listeners) listener(next);
}

/**
 * One read per binding at a time. Background polls never flip `loading`; a failed read keeps the last
 * confirmed record for identity (the UI marks its measurement unavailable) and only sets `error`.
 */
function refreshEntry(entry: Entry, explicit: boolean): Promise<void> {
  if (entry.pending) return entry.pending;
  if (explicit) publish(entry, { ...entry.state, loading: true });
  const run = (async () => {
    let patch: Partial<SessionState>;
    try {
      const owner = await ownerFor(entry.environmentId);
      const record = await readAssistantSession(entry.sessionId, entry.scope, owner);
      patch = { record: shareStructure(entry.state.record, record), error: "" };
    } catch (cause) {
      patch = { error: presentRemoteError(cause) ?? entry.state.error };
    } finally {
      entry.pending = null;
    }
    if (entry.live) publish(entry, { ...entry.state, ...patch, loading: false });
  })();
  entry.pending = run;
  return run;
}

function refreshAll() {
  // Skipped while hidden; the visibilitychange listener catches up on return.
  if (document.visibilityState === "hidden") return;
  for (const entry of entries.values()) refreshEntry(entry, false).catch(() => undefined);
}

function startPolling() {
  timer = setInterval(refreshAll, POLL_MS);
  document.addEventListener("visibilitychange", refreshAll);
}

function stopPolling() {
  clearInterval(timer);
  timer = undefined;
  document.removeEventListener("visibilitychange", refreshAll);
}

/** Joins (or starts) the shared read for a binding and reports its state, current value first. */
function watchAssistantSession(
  key: string,
  binding: { sessionId: string; scope: string[]; environmentId?: string },
  listener: (state: SessionState) => void,
) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { ...binding, state: INITIAL, listeners: new Set(), pending: null, live: true };
    entries.set(key, entry);
    if (entries.size === 1) startPolling();
    refreshEntry(entry, false).catch(() => undefined);
  }
  const current = entry;
  current.listeners.add(listener);
  listener(current.state);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.live = false;
    entries.delete(key);
    const slot = current.environmentId ?? "";
    if (![...entries.values()].some((other) => (other.environmentId ?? "") === slot))
      owners.delete(slot);
    if (entries.size === 0) stopPolling();
  };
}

function refreshAssistantSession(key: string): Promise<void> {
  const entry = entries.get(key);
  return entry ? refreshEntry(entry, true) : Promise.resolve();
}

/** Rows showing the same session share one read and one 15 s poll for the whole list; never a supervisor mutation. */
export function useAssistantSession(
  sessionId: string,
  projectId: string | readonly string[],
  environmentId?: string,
) {
  const scopeKey = JSON.stringify(typeof projectId === "string" ? [projectId] : projectId);
  const bindingKey = JSON.stringify([sessionId, scopeKey, environmentId]);
  const [view, setView] = useState<{ key: string; state: SessionState }>({
    key: bindingKey,
    state: INITIAL,
  });
  useEffect(
    // Subscribes to the shared per-binding poller; cleanup releases it when the last row unmounts.
    () =>
      watchAssistantSession(
        bindingKey,
        { sessionId, scope: JSON.parse(scopeKey) as string[], environmentId },
        (state) =>
          setView((current) =>
            current.key === bindingKey && current.state === state
              ? current
              : { key: bindingKey, state },
          ),
      ),
    [bindingKey, sessionId, scopeKey, environmentId],
  );
  // A changed binding never shows the previous Host's or session's record while its read loads.
  const state = view.key === bindingKey ? view.state : INITIAL;
  return { ...state, refresh: () => refreshAssistantSession(bindingKey) };
}
