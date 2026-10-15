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

async function retryDraft(id: string, draft: Draft) {
  draft.error = null;
  notifyDrafts();
  await enqueueNoteSave(id, async (latest) => {
    if (draft.skipSave.current) return;
    const current = latest ?? draft.saved ?? draft.base;
    const changes = draft.edits.current;
    const project = draft.project.current;
    try {
      const body = changes.body ?? current.body;
      const saved = await upsertNote({
        id,
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
  pruneDraft(id, draft);
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
  const failed = [...drafts].filter(([, draft]) => draft.error);
  if (!failed.length || isNotesViewOpen()) return null;
  return createPortal(
    <div
      role="alert"
      style={{ zIndex: LAYER.toast }}
      className="fixed right-3 bottom-3 max-w-[min(360px,calc(100vw-24px))] rounded-xl border border-stroke bg-background-base p-3 text-[12px] text-content shadow-xl"
    >
      {failed.map(([id, draft]) => (
        <div key={id} className="flex flex-col gap-1">
          <span>
            {t("Could not save “")}
            {draft.edits.current.title ?? draft.base.title}”: {draft.error}
          </span>
          <span>{t("Your draft is retained for this app session.")}</span>
          <button
            type="button"
            className="self-start underline"
            onClick={() => void retryDraft(id, draft)}
          >
            {t("Retry save")}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
