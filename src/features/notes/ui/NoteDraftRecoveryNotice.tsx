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
  draftInputOwner,
} from "../noteDrafts";
import { NOTES_CHANGED_EVENT, noteTitle, upsertNote } from "../notes";
import { LAYER } from "../../../shared/lib/layers";
import { TextareaField } from "../../../shared/ui/TextareaField";
import {
  getNotePrivateRecoveries,
  notePrivateInputCapacityUnavailable,
  subscribeNotePrivateRecoveries,
  type NotePrivateRecovery,
} from "../notesInputOwners";
import { requestOpenNoteLibrary } from "../noteNavigation";
import { copyText } from "../../../platform/tauri/clipboard";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";

const retryingDrafts = new Set<string>();

async function retryDraft(id: string, draft: Draft) {
  if (retryingDrafts.has(id) || draft.unadmittedInputs?.length) return;
  const work = draftInputOwner(draft).operation("recovery-retry");
  if (!work) return;
  retryingDrafts.add(id);
  draft.error = null;
  notifyDrafts();
  try {
    await enqueueNoteSave(
      id,
      async (latest, queued) => {
        if (draft.skipSave.current) return;
        const current = latest ?? draft.saved ?? draft.base;
        const changes = draft.edits.current;
        const project = draft.project.current;
        try {
          const body = changes.body ?? current.body;
          const saved = await upsertNote(
            {
              id,
              expectedUpdatedAt: current.updatedAt,
              title: (changes.title ?? current.title).trim() || noteTitle(body),
              body,
              tags: changes.tags ?? current.tags,
              ...(project ? { sourceCwd: project.path } : {}),
            },
            queued,
          );
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
      },
      work,
    );
  } finally {
    retryingDrafts.delete(id);
    pruneDraft(id, draft);
    notifyDrafts();
    work();
  }
}

/** Mounted with the app so an unmount-time save failure stays discoverable. */
export function NoteDraftRecoveryNotice() {
  useLocale();
  const [, update] = useState(0);
  useEffect(() => {
    const changed = () => update((value) => value + 1);
    window.addEventListener(DRAFT_CHANGED_EVENT, changed);
    const privateChanged = subscribeNotePrivateRecoveries(changed);
    return () => {
      window.removeEventListener(DRAFT_CHANGED_EVENT, changed);
      privateChanged();
    };
  }, []);
  const failed = [...drafts].filter(([id, draft]) => draft.error || retryingDrafts.has(id));
  const privateInputs = getNotePrivateRecoveries();
  const capacityUnavailable = notePrivateInputCapacityUnavailable();
  const visibleFailed = isNotesViewOpen() ? [] : failed;
  if (!visibleFailed.length && !privateInputs.length && !capacityUnavailable) return null;
  return createPortal(
    <div
      style={{ zIndex: LAYER.toast }}
      className="fixed right-3 bottom-3 flex max-h-[calc(100dvh-24px)] w-80 max-w-[calc(100vw-24px)] flex-col gap-2 overflow-y-auto"
    >
      {capacityUnavailable ? (
        <Alert tone="info" title={t("Input capacity is unavailable")}>
          {t("Existing input is kept. Copy retained text to keep a separate copy.")}
        </Alert>
      ) : null}
      {privateInputs.map((input) => (
        <PrivateInputRecovery key={input.id} input={input} />
      ))}
      {visibleFailed.map(([id, draft]) => (
        <Alert
          key={id}
          tone={retryingDrafts.has(id) ? "info" : "danger"}
          role={retryingDrafts.has(id) ? "status" : "alert"}
          title={t(retryingDrafts.has(id) ? "Retrying save…" : "Could not save note")}
          action={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              loading={retryingDrafts.has(id)}
              disabled={!!draft.unadmittedInputs?.length}
              onClick={() => void retryDraft(id, draft)}
            >
              {t("Retry save")}
            </Button>
          }
        >
          <p className="wrap-anywhere text-ui-secondary font-medium">
            {(draft.edits.current.title ?? draft.saved?.title ?? draft.base.title).trim() ||
              t("Untitled")}
          </p>
          {draft.error ? <p className="wrap-anywhere text-ui-caption">{draft.error}</p> : null}
          <p className="text-ui-caption">{t("Your draft is retained for this app session.")}</p>
        </Alert>
      ))}
    </div>,
    document.body,
  );
}

function PrivateInputRecovery({ input }: { input: NotePrivateRecovery }) {
  const copied = useCopyFeedback({ resetKeys: [input.id, input.text] });
  return (
    <Alert
      tone="info"
      title={t("Retained note input")}
      data-note-private-recovery={input.id}
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            loading={copied.pending}
            disabled={input.text === null}
            onClick={() => {
              if (input.text !== null) copied.copy(() => copyText(input.text!));
            }}
          >
            {t("Copy exact text")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => requestOpenNoteLibrary({ id: input.noteId })}
          >
            {t("Open note")}
          </Button>
        </div>
      }
    >
      <p className="wrap-anywhere font-medium">{input.title || t("Untitled")}</p>
      <p className="text-ui-caption">
        {t(
          input.field === "tags"
            ? "Tags input"
            : input.field === "title"
              ? "Title input"
              : "Document input",
        )}
      </p>
      <p className="text-ui-caption">{t("Check the note before reusing this input.")}</p>
      {input.text === null ? (
        <p>{t("The original input could not be read.")}</p>
      ) : (
        <details>
          <summary>{t("View retained input")}</summary>
          {input.text === "" ? <p>{t("Empty input")}</p> : null}
          <TextareaField label={t("Retained input")} value={input.text} readOnly rows={2} />
        </details>
      )}
      {copied.copied || copied.failed ? (
        <p role="status" className="text-ui-caption">
          {copied.failed ? copied.error : t("Exact text copied")}
        </p>
      ) : null}
    </Alert>
  );
}
