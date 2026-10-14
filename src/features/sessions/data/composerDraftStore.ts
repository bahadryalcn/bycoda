import { invoke } from "@tauri-apps/api/core";
import {
  composerDraftOf,
  restoreComposerDraft,
  subscribeComposerDrafts,
} from "../model/draftCache";
import {
  droppedAttachmentsNotice,
  persistableDraft,
  restoreDraft,
  settleRestoredDraft,
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
/** What was last sent for each session, so an unchanged draft is not written twice. */
const written = new Map<string, string>();
/** Marks a row whose content differs from the cache, so the next write always goes out. */
const STALE = "stale";
let installed = false;

function payloadFor(sessionId: string): string | null {
  const draft = persistableDraft(composerDraftOf(sessionId));
  return draft ? JSON.stringify(draft) : null;
}

async function write(sessionId: string): Promise<void> {
  timers.delete(sessionId);
  if (!isPersistableId(sessionId)) return;
  const payload = payloadFor(sessionId);
  if ((written.get(sessionId) ?? null) === payload) return;
  // Nothing saved and nothing to save: no row to create or clear.
  if (payload === null && !written.has(sessionId)) return;
  const previous = written.get(sessionId);
  if (payload === null) written.delete(sessionId);
  else written.set(sessionId, payload);
  try {
    await invoke<void>("session_set_draft", {
      sessionId,
      draft: payload === null ? null : JSON.parse(payload),
    });
  } catch {
    // Retry on the next change instead of trusting a write that failed.
    if (previous === undefined) written.delete(sessionId);
    else written.set(sessionId, previous);
  }
}

function schedule(sessionId: string) {
  if (!isPersistableId(sessionId)) return;
  const pending = timers.get(sessionId);
  if (pending) clearTimeout(pending);
  timers.set(
    sessionId,
    setTimeout(() => void write(sessionId), DRAFT_WRITE_DELAY_MS),
  );
}

/** Write every draft that is waiting for its timer. Used on blur, hide and quit. */
export async function flushComposerDrafts(): Promise<void> {
  const pending = [...timers.keys()];
  for (const sessionId of pending) {
    const timer = timers.get(sessionId);
    if (timer) clearTimeout(timer);
  }
  await Promise.all(pending.map(write));
}

function install() {
  if (installed) return;
  installed = true;
  subscribeComposerDrafts(schedule);
  if (typeof window === "undefined") return;
  const flush = () => void flushComposerDrafts();
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
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS),
    );
    const rows = await Promise.race([invoke<unknown>("session_list_drafts"), timeout]);
    if (Array.isArray(rows)) {
      await Promise.race([Promise.all(rows.map(hydrateRow)), timeout]);
    }
  } catch {
    // Start with no saved drafts.
  }
  install();
}

async function hydrateRow(row: unknown): Promise<void> {
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
    restoreComposerDraft(sessionId, {
      ...settled.draft,
      notice: droppedAttachmentsNotice(settled.dropped),
    })
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
