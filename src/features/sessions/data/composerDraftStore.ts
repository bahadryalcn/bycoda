import { invoke } from "@tauri-apps/api/core";
import {
  composerDraftOf,
  composerDraftRevision,
  restoreComposerDraft,
  subscribeComposerDrafts,
} from "../model/draftCache";
import {
  droppedAttachmentsNotice,
  composerDraftBytes,
  COMPOSER_DRAFT_MAX_BYTES,
  persistableDraft,
  restoreDraft,
  settleRestoredDraft,
  type ComposerDraft,
} from "../model/draftPersistence";
import { existingPaths, isPersistableId } from "./sessionStore";

/**
 * Unsent composer text survives a restart. The in-memory cache (draftCache.ts)
 * stays the source of truth while the app runs; this writes it through to the
 * `composer_drafts` table a moment after the last change, and loads it back
 * once at launch, before the first render, so each composer starts from its
 * own draft.
 *
 * SQLite rather than localStorage: it is where the queue already lives (same
 * attachment rules, same quit path), it takes a draft for a blank chat that
 * has no transcript row yet, and it is not subject to the webview's storage
 * quota with pasted images in it.
 */

export const DRAFT_WRITE_DELAY_MS = 500;
/** Boot waits for the saved drafts no longer than this; a slow store costs the drafts, not the launch. */
const HYDRATE_TIMEOUT_MS = 2_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
/** What was last sent for each session, so an unchanged draft is not written twice. */
const written = new Map<string, string | null>();
/** Reuse produced files across autosaves without replacing the live draft. */
const spilled = new Map<string, Map<string, { data: string; path: string }>>();
/** A successful listing establishes absence; a failed read leaves it unknown. */
let listedSessions: Set<string> | null = null;
/** True only once every saved draft is in the cache. A timeout leaves it false. */
let draftsLoaded = false;

/** Whether the saved drafts are known to be in the cache, so an empty cache means no draft. */
export function composerDraftsLoaded(): boolean {
  return draftsLoaded;
}
/** Marks a row whose content differs from the cache, so the next write always goes out. */
const STALE = "stale";
let installed = false;
const persistedListeners = new Set<
  (sessionId: string, attachments: ComposerDraft["attachments"]) => void
>();
export function subscribePersistedComposerDrafts(
  listener: (sessionId: string, attachments: ComposerDraft["attachments"]) => void,
): () => void {
  persistedListeners.add(listener);
  return () => {
    persistedListeners.delete(listener);
  };
}
function notifyPersisted(sessionId: string, snapshot: ComposerDraft) {
  for (const listener of persistedListeners) listener(sessionId, snapshot.attachments);
}

function sameDraft(a: ComposerDraft, b: ComposerDraft): boolean {
  return (
    a.text === b.text &&
    a.mode === b.mode &&
    (a.attachments === b.attachments || (!a.attachments.length && !b.attachments.length)) &&
    (a.mcpTags === b.mcpTags || (!a.mcpTags.length && !b.mcpTags.length))
  );
}

async function payloadFor(sessionId: string, snapshot: ComposerDraft): Promise<string | null> {
  const bounded = persistableDraft(snapshot);
  if (!bounded) {
    spilled.delete(sessionId);
    return null;
  }
  const files = spilled.get(sessionId) ?? new Map<string, { data: string; path: string }>();
  spilled.set(sessionId, files);
  for (const id of files.keys()) {
    if (!snapshot.attachments.some((file) => file.id === id)) files.delete(id);
  }
  // The serializer identifies inline bytes that do not fit the native row.
  // Spill those before persisting; a failed spill rejects the write and keeps
  // the live draft dirty for retry, never claiming that missing bytes were saved.
  const attachments: ComposerDraft["attachments"] = [];
  for (const [index, file] of snapshot.attachments.entries()) {
    if (!file.data || file.path || !bounded.attachments[index]?.missing) {
      attachments.push(file);
      continue;
    }
    let produced = files.get(file.id);
    if (produced?.data !== file.data) {
      const path = await invoke<string>("write_attachment", { name: file.name, data: file.data });
      if (typeof path !== "string" || !path)
        throw new Error(`Could not preserve draft attachment: ${file.name}.`);
      produced = { data: file.data, path };
      files.set(file.id, produced);
    }
    attachments.push({ ...file, path: produced.path, data: undefined, missing: undefined });
  }
  const draft = persistableDraft({ ...snapshot, attachments });
  if (draft && composerDraftBytes(draft) > COMPOSER_DRAFT_MAX_BYTES) {
    throw new Error(
      "This draft is too large to save. Reduce its text or attachment metadata and retry.",
    );
  }
  return draft ? JSON.stringify(draft) : null;
}

async function write(sessionId: string): Promise<void> {
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.delete(sessionId);
  const active = inFlight.get(sessionId);
  if (active) {
    await active;
    return write(sessionId);
  }
  if (!isPersistableId(sessionId)) return;
  const snapshot = composerDraftOf(sessionId);
  const pending = (async () => {
    const payload = await payloadFor(sessionId, snapshot);
    const baseline = written.has(sessionId)
      ? written.get(sessionId)
      : listedSessions && !listedSessions.has(sessionId)
        ? null
        : undefined;
    if (baseline === payload) {
      notifyPersisted(sessionId, snapshot);
      if (sameDraft(snapshot, composerDraftOf(sessionId))) dirty.delete(sessionId);
      return;
    }
    await invoke<void>("session_set_draft", {
      sessionId,
      draft: payload === null ? null : JSON.parse(payload),
    });
    written.set(sessionId, payload);
    notifyPersisted(sessionId, snapshot);
    if (sameDraft(snapshot, composerDraftOf(sessionId))) dirty.delete(sessionId);
  })();
  inFlight.set(sessionId, pending);
  try {
    await pending;
  } finally {
    inFlight.delete(sessionId);
  }
}

function schedule(sessionId: string) {
  if (!isPersistableId(sessionId)) return;
  dirty.add(sessionId);
  const pending = timers.get(sessionId);
  if (pending) clearTimeout(pending);
  timers.set(
    sessionId,
    setTimeout(() => void write(sessionId).catch(() => {}), DRAFT_WRITE_DELAY_MS),
  );
}

/** Drain scheduled and active writes. Failed drafts remain dirty for retry. */
export async function flushComposerDrafts(): Promise<void> {
  while (dirty.size || inFlight.size) {
    const pending = [...new Set([...dirty, ...inFlight.keys()])];
    // Await every write even if one fails, so callers receive a real barrier.
    const results = await Promise.allSettled(pending.map(write));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

function install() {
  if (installed) return;
  installed = true;
  subscribeComposerDrafts(schedule);
  if (typeof window === "undefined") return;
  const flush = () => void flushComposerDrafts().catch(() => {});
  window.addEventListener("blur", flush);
  // Leaving the composer (or any field) settles what was typed in it.
  document.addEventListener("focusout", flush);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * Load the saved drafts into the cache and start saving. Best effort: a draft
 * that cannot be read costs that draft, never the launch.
 */
export async function hydrateComposerDrafts(): Promise<void> {
  const startedAt = composerDraftRevision();
  listedSessions = null;
  draftsLoaded = false;
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS),
    );
    const rows = await Promise.race([invoke<unknown>("session_list_drafts"), timeout]);
    if (Array.isArray(rows)) {
      listedSessions = new Set(
        rows.flatMap((row) =>
          row && typeof row === "object" && typeof row.sessionId === "string"
            ? [row.sessionId]
            : [],
        ),
      );
      const finished = await Promise.race([
        Promise.all(rows.map((row) => hydrateRow(row, startedAt))).then(() => true),
        timeout,
      ]);
      draftsLoaded = finished === true;
    }
  } catch {
    // Start with no saved drafts.
  }
  install();
}

async function hydrateRow(row: unknown, startedAt: number): Promise<void> {
  if (!row || typeof row !== "object") return;
  const { sessionId, draft } = row as { sessionId?: unknown; draft?: unknown };
  if (typeof sessionId !== "string" || !isPersistableId(sessionId)) return;
  const restored = restoreDraft(draft);
  if (!restored) return;
  const settled = await settleRestoredDraft(restored, existingPaths).catch(() => ({
    draft: restored,
    dropped: [] as string[],
  }));
  if (!settled) return;
  if (
    restoreComposerDraft(
      sessionId,
      { ...settled.draft, notice: droppedAttachmentsNotice(settled.dropped) },
      startedAt,
    )
  ) {
    if (settled.dropped.length > 0) {
      // The row still holds the dropped attachments: replace it, even if
      // nothing is left of the draft.
      written.set(sessionId, STALE);
      schedule(sessionId);
    } else {
      // What is on disk is what was just loaded; the next change replaces it.
      const persistable = persistableDraft(composerDraftOf(sessionId));
      if (persistable) written.set(sessionId, JSON.stringify(persistable));
    }
  }
}
