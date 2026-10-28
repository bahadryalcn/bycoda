import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  drafts,
  DRAFT_CHANGED_EVENT,
  enqueueNoteSave,
  notifyDrafts,
  isNotesViewOpen,
  pruneDraft,
  type Draft,
} from "../noteDrafts";
import { NOTES_CHANGED_EVENT, noteTitle, upsertNote } from "../notes";
import { LAYER } from "../../../shared/lib/layers";

const retryingDrafts = new Set<string>();

async function retryDraft(id: string, draft: Draft) {
  if (retryingDrafts.has(id)) return;
  retryingDrafts.add(id);
  draft.error = null;
  notifyDrafts();
  try {
    await enqueueNoteSave(id, async (latest) => {
      if (draft.skipSave.current) return;
      const current = latest ?? draft.saved ?? draft.base;
      const changes = draft.edits.current;
      const project = draft.project.current;
      try {
        const body = changes.body ?? current.body;
        const saved = await upsertNote({
          id,
          expectedUpdatedAt: current.updatedAt,
          title: (changes.title ?? current.title).trim() || noteTitle(body),
          body,
          tags: changes.tags ?? current.tags,
          ...(project ? { sourceCwd: project.path } : {}),
        });
        const remaining = { ...draft.edits.current };
        if (remaining.title === changes.title) delete remaining.title;
        if (remaining.body === changes.body) delete remaining.body;
        if (remaining.tags === changes.tags) delete remaining.tags;
        draft.edits.current = remaining;
        if (draft.project.current === project) draft.project.current = null;
        draft.saved = saved;
        draft.error = null;
        notifyDrafts();
        window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
        return saved;
      } catch (error: unknown) {
        draft.error = error instanceof Error ? error.message : String(error);
        notifyDrafts();
      }
    });
  } finally {
    retryingDrafts.delete(id);
    pruneDraft(id, draft);
    notifyDrafts();
  }
}

/** Mounted with the app so an unmount-time save failure stays discoverable. */
export function NoteDraftRecoveryNotice() {
  useLocale();
  const [, update] = useState(0);
  useEffect(() => {
    const changed = () => update((value) => value + 1);
    window.addEventListener(DRAFT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(DRAFT_CHANGED_EVENT, changed);
  }, []);
  const failed = [...drafts].filter(([id, draft]) => draft.error || retryingDrafts.has(id));
  if (!failed.length || isNotesViewOpen()) return null;
  return createPortal(
    <div
      style={{ zIndex: LAYER.toast }}
      className="fixed right-3 bottom-3 flex max-h-[calc(100dvh-24px)] w-80 max-w-[calc(100vw-24px)] flex-col gap-2 overflow-y-auto"
    >
      {failed.map(([id, draft]) => (
        <Alert key={id} tone={retryingDrafts.has(id) ? "info" : "danger"}
          role={retryingDrafts.has(id) ? "status" : "alert"}
          title={t(retryingDrafts.has(id) ? "Retrying save…" : "Could not save note")}
          action={
            <Button variant="ghost" size="sm" type="button" loading={retryingDrafts.has(id)}
              onClick={() => void retryDraft(id, draft)}>
              {t("Retry save")}
            </Button>
          }>
          <p className="wrap-anywhere text-ui-secondary font-medium">
            {(draft.edits.current.title ?? draft.saved?.title ?? draft.base.title).trim() || t("Untitled")}
          </p>
          {draft.error ? <p className="wrap-anywhere text-ui-caption">{draft.error}</p> : null}
          <p className="text-ui-caption">{t("Your draft is retained for this app session.")}</p>
        </Alert>
      ))}
    </div>,
    document.body,
  );
}
