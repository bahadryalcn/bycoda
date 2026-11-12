import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
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
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Toast, ToastCard, ToastSlot } from "../../../shared/ui/ToastRegion";
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
  return (
    <>
      {capacityUnavailable ? (
        <Toast
          tone="info"
          title={t("Input capacity is unavailable")}
          message={t("Existing input is kept. Copy retained text to keep a separate copy.")}
        />
      ) : null}
      {privateInputs.map((input) => (
        <PrivateInputRecovery key={input.id} input={input} />
      ))}
      {visibleFailed.map(([id, draft]) => (
        <Toast
          key={id}
          tone={retryingDrafts.has(id) ? "info" : "danger"}
          title={t(retryingDrafts.has(id) ? "Retrying save…" : "Could not save note")}
          action={{
            label: t("Retry save"),
            pending: retryingDrafts.has(id),
            disabled: !!draft.unadmittedInputs?.length,
            onClick: () => void retryDraft(id, draft),
          }}
        >
          <Text as="p" size="secondary" tone="inherit" weight="medium" className="wrap-anywhere">
            {(draft.edits.current.title ?? draft.saved?.title ?? draft.base.title).trim() ||
              t("Untitled")}
          </Text>
          {draft.error ? (
            <Text as="p" size="caption" tone="inherit" className="wrap-anywhere">
              {draft.error}
            </Text>
          ) : null}
          <Text as="p" size="caption" tone="inherit">
            {t("Your draft is retained for this app session.")}
          </Text>
        </Toast>
      ))}
    </>
  );
}

function PrivateInputRecovery({ input }: { input: NotePrivateRecovery }) {
  const copied = useCopyFeedback({ resetKeys: [input.id, input.text] });
  return (
    <ToastSlot>
      <div data-note-private-recovery={input.id}>
        <ToastCard tone="info" title={t("Retained note input")}>
          <Text as="p" size="inherit" tone="inherit" weight="medium" className="wrap-anywhere">
            {input.title || t("Untitled")}
          </Text>
          <Text as="p" size="caption" tone="inherit">
            {t(
              input.field === "tags"
                ? "Tags input"
                : input.field === "title"
                  ? "Title input"
                  : "Document input",
            )}
          </Text>
          <Text as="p" size="caption" tone="inherit">
            {t("Check the note before reusing this input.")}
          </Text>
          {input.text === null ? (
            <p>{t("The original input could not be read.")}</p>
          ) : (
            <Disclosure size="sm" summary={t("View retained input")}>
              {input.text === "" ? <p>{t("Empty input")}</p> : null}
              <TextareaField label={t("Retained input")} value={input.text} readOnly rows={2} />
            </Disclosure>
          )}
          {copied.copied || copied.failed ? (
            <Text as="p" size="caption" tone="inherit" role="status">
              {copied.failed ? copied.error : t("Exact text copied")}
            </Text>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-1">
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
        </ToastCard>
      </div>
    </ToastSlot>
  );
}
