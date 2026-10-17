import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { FilePlus } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { isImeComposition } from "../../../shared/lib/keyboard";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  pickAttachments,
  revokeAttachment,
} from "../model/attachments";
import { attachmentTokens } from "../model/attachmentTokens";
import {
  addDraftAttachments,
  applyQueuedEdit,
  deleteDraftTokenAtCaret,
  editDraftText,
  hasQueuedEditChanges,
  isQueuedEditEmpty,
  queuedEditDraft,
  removeDraftAttachment,
  type QueuedEditDraft,
} from "../model/queuedMessageEdit";
import type { Attachment, QueuedMessage } from "../model/session";
import { AttachmentChip } from "./AttachmentChip";

type Props = {
  message: QueuedMessage;
  /** False when the harness cannot take attachments: chips can then only be removed. */
  canAttach: boolean;
  onSave: (text: string, attachments: Attachment[]) => void;
  /** Take the message out of the queue; offered when nothing would be left to send. */
  onRemove: () => void;
  onCancel: () => void;
};

/** Edits a queued message's text and attachments in a dialog instead of the queue row. */
export function QueuedMessageEditDialog({ message, canAttach, onSave, onRemove, onCancel }: Props) {
  useLocale();
  const [draft, setDraft] = useState<QueuedEditDraft>(() => queuedEditDraft(message));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(0);
  const pendingAttachments = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Where the caret goes once the next draft is rendered. */
  const pendingCaret = useRef<number | null>(null);
  /** Attachments added here: theirs to release if the edit does not keep them. */
  const added = useRef(new Map<string, Attachment>());
  const saved = useRef(false);
  const alive = useRef(true);
  const canAttachRef = useRef(canAttach);
  canAttachRef.current = canAttach;

  const updateDraft = (next: QueuedEditDraft) => {
    draftRef.current = next;
    setDraft(next);
  };

  const empty = isQueuedEditEmpty(message, draft);
  const dirty = hasQueuedEditChanges(message, draft);
  const tokens = attachmentTokens(draft.attachments);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    alive.current = true;
    const files = added.current;
    return () => {
      alive.current = false;
      const keep = saved.current
        ? new Set(draftRef.current.attachments.map((file) => file.id))
        : new Set<string>();
      for (const file of files.values()) {
        if (!keep.has(file.id)) revokeAttachment(file);
      }
    };
  }, []);

  // Grow with the text up to the CSS max height, then scroll.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [draft.text]);

  const requestClose = useCallback(() => {
    if (confirmingDiscard) setConfirmingDiscard(false);
    else if (dirty || loadingAttachments > 0) setConfirmingDiscard(true);
    else onCancel();
  }, [confirmingDiscard, dirty, loadingAttachments, onCancel]);

  const save = () => {
    if (empty || pendingAttachments.current > 0) return;
    const next = applyQueuedEdit(message, draft);
    saved.current = true;
    onSave(next.text, next.attachments);
  };

  const change = (text: string, caret: number) => {
    const edit = editDraftText(draftRef.current, text, caret);
    pendingCaret.current = edit.caret;
    setError(null);
    updateDraft(edit.draft);
  };

  const attach = (incoming: Attachment[]) => {
    if (!alive.current || saved.current || !canAttachRef.current) {
      incoming.forEach(revokeAttachment);
      return;
    }
    if (incoming.length === 0) return;
    const el = field.current;
    const selection = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    const result = addDraftAttachments(draftRef.current, incoming, selection);
    for (const file of incoming) {
      if (result.draft.attachments.includes(file)) {
        added.current.set(file.id, file);
      } else revokeAttachment(file);
    }
    pendingCaret.current = result.caret;
    updateDraft(result.draft);
    el?.focus();
  };

  const remove = (id: string) => {
    const file = draftRef.current.attachments.find((item) => item.id === id);
    if (file && added.current.delete(id)) revokeAttachment(file);
    updateDraft(removeDraftAttachment(draftRef.current, id));
    field.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
      return;
    }
    const back = event.key === "Backspace";
    if (!back && event.key !== "Delete") return;
    const el = event.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const edit = deleteDraftTokenAtCaret(
      draftRef.current,
      el.selectionStart,
      back ? "back" : "forward",
    );
    if (!edit) return;
    event.preventDefault();
    pendingCaret.current = edit.caret;
    updateDraft(edit.draft);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    const messageFiles = messageFilesFromClipboard(data);
    const files = messageFiles ?? filesFromClipboard(data);
    if (files.length > 0) {
      event.preventDefault();
      if (!canAttach) return;
      void collect(() => attachmentsFromFiles(files));
      return;
    }
    // A webview reports a pasted screenshot or copied file as text only (or
    // nothing); both live on the native clipboard.
    const text = data.getData("text/plain");
    if (!canAttach || (text && !isFileReferenceText(text))) return;
    event.preventDefault();
    void collect(async () => {
      const { files: pasted, warning } = await nativeClipboardAttachments(text);
      if (alive.current && warning) setError(warning);
      return pasted;
    });
  };

  const collect = async (read: () => Promise<Attachment[]>) => {
    pendingAttachments.current += 1;
    setLoadingAttachments(pendingAttachments.current);
    setError(null);
    try {
      attach(await read());
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingAttachments.current -= 1;
      if (alive.current) setLoadingAttachments(pendingAttachments.current);
    }
  };

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  return (
    <Modal title={t("Edit queued message")} size="md" fitViewport onClose={requestClose}>
      <div
        className="flex flex-col gap-3 p-4"
        onDragOver={(event) => {
          if (!canAttach || !hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          if (!canAttach) return;
          const files = [...event.dataTransfer.files];
          void collect(() => attachmentsFromFiles(files));
        }}
      >
        <div className="rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) focus-within:border-(--ui-tone-neutral-border)">
          {draft.attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {draft.attachments.map((file, index) => (
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  token={tokens[index]}
                  onRemove={() => remove(file.id)}
                />
              ))}
            </div>
          ) : null}
          <TextareaField
            hideLabel
            label=""
            ref={field}
            aria-label={t("Queued message text")}
            value={draft.text}
            rows={5}
            spellCheck={false}
            placeholder={t("Message")}
            onChange={(event) =>
              change(event.target.value, event.target.selectionStart ?? event.target.value.length)
            }
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            fieldClassName="block w-full"
            className="resize-none"
          />
          {canAttach ? (
            <div className="flex px-2 pb-2">
              <Button
                iconOnly
                label={t("Add files or images")}
                variant="ghost"
                type="button"
                title={t("Add files or images")}
                aria-label={t("Add files or images")}
                onClick={() => void collect(pickAttachments)}
              >
                <FilePlus className="size-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          ) : null}
        </div>

        {loadingAttachments > 0 ? <p role="status">{t("Loading…")}</p> : null}

        {draft.attachments.some((file) => file.missing) ? (
          <p className="text-[11px] leading-4 text-(--ui-tone-warning-fg)">
            {t("Missing files are dropped from the message when you save.")}
          </p>
        ) : null}
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}

        {confirmingDiscard ? (
          <Alert tone="info" role="alert">
            <span className="mr-auto">{t("Discard your changes?")}</span>
            <Button variant="ghost" type="button" onClick={() => setConfirmingDiscard(false)}>
              {t("Keep editing")}
            </Button>
            <Button variant="ghost" type="button" onClick={onCancel}>
              {t("Discard")}
            </Button>
          </Alert>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {empty ? (
              <Button variant="ghost" type="button" onClick={onRemove} className="mr-auto">
                {t("Remove from queue")}
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={requestClose}>
              {t("Cancel")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={empty || loadingAttachments > 0}
              onClick={save}
              title={t("Save (Ctrl/Cmd+Enter)")}
            >
              {t("Save")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
