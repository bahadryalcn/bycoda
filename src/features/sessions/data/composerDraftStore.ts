import { invoke } from "@tauri-apps/api/core";
import {
  composerDraftOf,
  composerDraftRevision,
  restoreComposerDraft,
  subscribeComposerDrafts,
  setComposerDraftSnapshot,
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
import {
  rendererPersistenceDrain,
  type PersistenceScope,
  type PersistenceWork,
} from "./persistenceDrain";

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
type ScheduledDraft = { wake(): void; promise: Promise<void> };
const scheduled = new Map<string, ScheduledDraft>();
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

const failedDrafts = new Set<string>();
const draftPersistence = rendererPersistenceDrain.reuseModuleProducer("composer-drafts", {
  flush: (scope, work) => flushComposerDraftsStrict(scope, work),
  wake: wakeScheduledDrafts,
});

function write(sessionId: string, parent?: PersistenceWork): Promise<void> {
  return draftPersistence
    .run(
      [sessionId],
      "draft",
      async (work) => {
        const active = inFlight.get(sessionId);
        if (active) {
          await active;
          return write(sessionId, work);
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
          if (baseline === payload && !failedDrafts.has(sessionId)) {
            notifyPersisted(sessionId, snapshot);
            if (sameDraft(snapshot, composerDraftOf(sessionId))) dirty.delete(sessionId);
            return;
          }
          await invoke<void>("session_set_draft", {
            sessionId,
            draft: payload === null ? null : JSON.parse(payload),
          });
          work.confirmRecovery();
          failedDrafts.delete(sessionId);
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
      },
      { parent },
    )
    .catch((error: unknown) => {
      failedDrafts.add(sessionId);
      throw error;
    });
}

function schedule(sessionId: string, work?: PersistenceWork) {
  if (!isPersistableId(sessionId)) return;
  draftPersistence.noteMutation([sessionId], work);
  dirty.add(sessionId);
  let slot = scheduled.get(sessionId);
  if (!slot) {
    let start: (() => void) | undefined;
    let woken = false;
    const accepted: ScheduledDraft = {
      promise: Promise.resolve(),
      wake: () => {
        if (scheduled.get(sessionId) !== accepted) return;
        const timer = timers.get(sessionId);
        if (timer) clearTimeout(timer);
        timers.delete(sessionId);
        scheduled.delete(sessionId);
        woken = true;
        start?.();
      },
    };
    scheduled.set(sessionId, accepted);
    try {
      // Own a descendant now, not an original parent token kept across500ms.
      // Its accepted root survives until the actual spill and native row ACK.
      accepted.promise = draftPersistence.run(
        [sessionId],
        "draft",
        (descendant) =>
          new Promise<void>((resolve, reject) => {
            start = () => {
              // Explicit flush historically starts attachment reads immediately.
              // Wake the actual admitted job synchronously, not a later snapshot.
              try {
                void write(sessionId, descendant).then(resolve, reject);
              } catch (error) {
                reject(error);
              }
            };
            if (woken) start();
          }),
        { parent: work },
      );
    } catch (error) {
      scheduled.delete(sessionId);
      throw error;
    }
    // Autosave remains best effort; explicit flush still receives this failure.
    void accepted.promise.catch(() => {});
    slot = accepted;
  }
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.set(sessionId, setTimeout(slot.wake, DRAFT_WRITE_DELAY_MS));
}

function scheduledFor(scope: PersistenceScope): ScheduledDraft[] {
  return [...scheduled]
    .filter(([id]) => scope === "profile" || scope.includes(id))
    .map(([, slot]) => slot);
}

function wakeScheduledDrafts(scope: PersistenceScope): void {
  for (const slot of scheduledFor(scope)) slot.wake();
}

/** Drain scheduled and active writes. Failed drafts remain dirty for retry. */
export async function flushComposerDrafts(): Promise<void> {
  await flushDraftBatch("profile");
}

function flushDraftBatch(scope: PersistenceScope, parent?: PersistenceWork): Promise<void> {
  // Only join slots accepted before this batch. A later slot may be queued
  // behind a new HMR module waiting on this batch; joining it would form a cycle.
  const beforeBatch = scheduledFor(scope);
  for (const slot of beforeBatch) slot.wake();
  // This lease owns the loop's lifetime, not another profile-wide durable
  // intent. Each write owns its exact session's sticky failure/commit receipt.
  // Preserve the caller's rejection without duplicating a child failure onto
  // unrelated sessions in the batch's conservative admission scope.
  return draftPersistence
    .run(
      scope,
      "flush",
      async (work) => {
        try {
          const started = await Promise.allSettled(beforeBatch.map((slot) => slot.promise));
          const failure = started.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          await flushMatchingDrafts(scope, work);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, error };
        }
      },
      { parent },
    )
    .then((result) => {
      if (!result.ok) throw result.error;
    });
}

async function flushMatchingDrafts(scope: PersistenceScope, work?: PersistenceWork): Promise<void> {
  while (true) {
    const pending = [...new Set([...dirty, ...inFlight.keys()])].filter(
      (id) => scope === "profile" || scope.includes(id),
    );
    if (!pending.length) return;
    // Await every write even if one fails, so callers receive a real barrier.
    const results = await Promise.allSettled(pending.map((id) => write(id, work)));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

/** Drains known draft producers only. Mounted composers/native proof are not covered. */
export async function flushComposerDraftsStrict(
  scope: PersistenceScope = "profile",
  current?: PersistenceWork,
): Promise<void> {
  await flushDraftBatch(scope, current);
  await draftPersistence.settle(scope, current);
}

/** Mounted closure/accepted preparation capture; ordinary serializer policy is unchanged. */
export async function persistMountedComposerDraft(
  sessionId: string,
  snapshot: ComposerDraft,
  parent: PersistenceWork,
): Promise<void> {
  if (!isPersistableId(sessionId))
    throw new Error("This composer has no persistable session identity");
  setComposerDraftSnapshot(sessionId, snapshot, parent);
  // A mounted producer can precede hydration/listener installation. Never treat
  // the absence of that listener as an acknowledgement of unpublished bytes.
  dirty.add(sessionId);
  await flushComposerDraftsStrict([sessionId], parent);
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
  await draftPersistence.run("profile", "hydration", async (work) => {
    const startedAt = composerDraftRevision();
    listedSessions = null;
    draftsLoaded = false;
    try {
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS),
      );
      const rows = await Promise.race([
        draftPersistence.run(
          "profile",
          "draft-list",
          async (read) => {
            const result = await invoke<unknown>("session_list_drafts");
            read.confirmRecovery();
            return result;
          },
          { parent: work },
        ),
        timeout,
      ]);
      if (Array.isArray(rows)) {
        listedSessions = new Set(
          rows.flatMap((row) =>
            row && typeof row === "object" && typeof row.sessionId === "string"
              ? [row.sessionId]
              : [],
          ),
        );
        const finished = await Promise.race([
          Promise.all(rows.map((row) => hydrateRow(row, startedAt, work))).then(() => true),
          timeout,
        ]);
        draftsLoaded = finished === true;
        if (draftsLoaded) work.confirmRecovery();
      }
    } catch (error) {
      work.fail(error);
      // Start with no saved drafts.
    }
    install();
  });
}

async function hydrateRow(
  row: unknown,
  startedAt: number,
  parent?: PersistenceWork,
): Promise<void> {
  if (!row || typeof row !== "object") return;
  const { sessionId, draft } = row as { sessionId?: unknown; draft?: unknown };
  if (typeof sessionId !== "string" || !isPersistableId(sessionId)) return;
  await draftPersistence.run(
    [sessionId],
    "draft-hydration",
    async (work) => {
      const restored = restoreDraft(draft);
      if (!restored) return;
      const settled = await settleRestoredDraft(restored, existingPaths).catch((error: unknown) => {
        work.fail(error);
        return { draft: restored, dropped: [] as string[] };
      });
      if (!settled) return;
      if (
        restoreComposerDraft(
          sessionId,
          { ...settled.draft, notice: droppedAttachmentsNotice(settled.dropped) },
          startedAt,
          work,
        )
      ) {
        if (settled.dropped.length > 0) {
          // The row still holds the dropped attachments: replace it, even if
          // nothing is left of the draft.
          written.set(sessionId, STALE);
          schedule(sessionId, work);
        } else {
          // What is on disk is what was just loaded; the next change replaces it.
          const persistable = persistableDraft(composerDraftOf(sessionId));
          if (persistable) written.set(sessionId, JSON.stringify(persistable));
        }
      }
      work.confirmRecovery();
    },
    { parent },
  );
}
