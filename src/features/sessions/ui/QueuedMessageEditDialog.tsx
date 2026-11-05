import { Alert } from "../../../shared/ui/Alert";
import { PromptField } from "../../../shared/ui/PromptField";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
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
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { droppedFileCount } from "../../../shared/lib/externalDrop";
import { useExternalDropFeedback } from "../../../shared/hooks/useExternalDropFeedback";
import { attachmentDropVerdict } from "../model/attachmentDrop";
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
import { installAttachmentSelectionPolicy } from "./attachmentSelectionPolicy";
import {
  retainParentInput,
  useParentInputClosure,
  useParentInputsClosed,
  mutateParentInput,
} from "../data/parentInputClosure";

type Props = {
  parentSessionId?: string;
  message: QueuedMessage;
  /** False when the harness cannot take attachments: chips can then only be removed. */
  canAttach: boolean;
  onSave: (text: string, attachments: Attachment[]) => void;
  /** Take the message out of the queue; offered when nothing would be left to send. */
  onRemove: () => void;
  onCancel: () => void;
};

/** Root/message ownership changes retire the old refs and admitted file reads. */
export function QueuedMessageEditDialog(props: Props) {
  return (
    <QueueEditContent
      key={JSON.stringify([props.parentSessionId ?? null, props.message.id])}
      {...props}
    />
  );
}

/** Edits a queued message's text and attachments in a dialog instead of the queue row. */
function QueueEditContent({
  parentSessionId,
  message,
  canAttach,
  onSave,
  onRemove,
  onCancel,
}: Props) {
  const t = useT();
  const parentClosed = useParentInputsClosed(parentSessionId);
  const [draft, setDraft] = useState<QueuedEditDraft>(() => queuedEditDraft(message));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(0);
  const pendingAttachments = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const dropBox = useRef<HTMLDivElement>(null);
  const dropFeedback = useExternalDropFeedback();
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
  const parentChanged = useParentInputClosure(
    {
      kind: "queue-edit",
      sessionId: parentSessionId,
      snapshot: () => ({
        message,
        draft: draftRef.current,
        actualText: field.current?.value ?? draftRef.current.text,
        confirmingDiscard,
        error,
        pendingAttachments: pendingAttachments.current,
        addedAttachments: [...added.current.values()],
        saved: saved.current,
        alive: alive.current,
        canAttach: canAttachRef.current,
      }),
    },
    field,
  );

  const updateDraft = (next: QueuedEditDraft) => {
    if (!parentChanged.canMutate()) return;
    parentChanged();
    draftRef.current = next;
    setDraft(next);
  };

  const empty = isQueuedEditEmpty(message, draft);
  const dirty = hasQueuedEditChanges(message, draft);
  const tokens = attachmentTokens(draft.attachments);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    return installAttachmentSelectionPolicy(el, () => draftRef.current.attachments);
  }, []);

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
    parentChanged();
    if (confirmingDiscard) setConfirmingDiscard(false);
    else if (dirty || loadingAttachments > 0) setConfirmingDiscard(true);
    else onCancel();
  }, [confirmingDiscard, dirty, loadingAttachments, onCancel]);

  const save = () =>
    mutateParentInput(parentChanged, () => {
      if (empty || pendingAttachments.current > 0) return;
      const next = applyQueuedEdit(message, draft);
      const input = {
        source: "queue-edit-save-intent",
        message,
        draft: draftRef.current,
        next,
      };
      const retained = retainParentInput({
        kind: "queue-edit",
        sessionId: parentSessionId,
        snapshot: () => input,
      });
      try {
        onSave(next.text, next.attachments);
        retained.update({ ...input, disposition: "accepted-unknown" });
        saved.current = true;
        parentChanged();
        setError(null);
      } catch (reason) {
        // Dispatch may have happened before a callback threw. Keep the original
        // input as unknown; the visible error is not an authoritative rejection.
        retained.update({ ...input, disposition: "dispatch-unknown" });
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

  const change = (text: string, caret: number) => {
    if (!parentChanged.canMutate()) return;
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
    if (!parentChanged.canMutate()) return;
    const file = draftRef.current.attachments.find((item) => item.id === id);
    if (file && added.current.delete(id)) revokeAttachment(file);
    updateDraft(removeDraftAttachment(draftRef.current, id));
    field.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (!parentChanged.canMutate()) return;
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
    if (!parentChanged.canMutate()) {
      event.preventDefault();
      return;
    }
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
    const admitted = parentChanged.admit();
    if (!admitted) return;
    return admitted.run(async () => {
      const pending = retainParentInput({
        kind: "queue-edit",
        sessionId: parentSessionId,
        snapshot: () => ({
          source: "queue-edit-attachment-preparation",
          messageId: message.id,
          draft: draftRef.current,
          status: "pending",
        }),
      });
      pendingAttachments.current += 1;
      parentChanged();
      setLoadingAttachments(pendingAttachments.current);
      setError(null);
      try {
        const incoming = await read();
        admitted.apply(() => attach(incoming));
      } catch (reason) {
        if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        pendingAttachments.current -= 1;
        parentChanged();
        pending.release();
        if (alive.current) setLoadingAttachments(pendingAttachments.current);
      }
    });
  };

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  return (
    <Modal
      title={t("Edit queued message")}
      size="md"
      fitViewport
      onClose={requestClose}
      footer={
        confirmingDiscard ? (
          <div className="min-w-0 flex-1">
            <Alert tone="warning" role="alert">
              <span className="mr-auto">{t("Discard your changes?")}</span>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  parentChanged();
                  setConfirmingDiscard(false);
                }}
              >
                {t("Keep editing")}
              </Button>
              <Button
                variant="secondary"
                tone="danger"
                type="button"
                onClick={() => {
                  parentChanged();
                  onCancel();
                }}
              >
                {t("Discard")}
              </Button>
            </Alert>
          </div>
        ) : (
          <ModalActions
            start={
              empty ? (
                <Button
                  variant="ghost"
                  tone="danger"
                  type="button"
                  disabled={parentClosed}
                  onClick={() => mutateParentInput(parentChanged, onRemove)}
                >
                  {t("Remove from queue")}
                </Button>
              ) : undefined
            }
          >
            <Button variant="ghost" type="button" onClick={requestClose}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={parentClosed || empty || loadingAttachments > 0}
              onClick={save}
              tooltip={t("Save")}
              shortcut="Mod+Enter"
            >
              {t("Save")}
            </Button>
          </ModalActions>
        )
      }
    >
      <div
        className="flex flex-col gap-3 p-4"
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          const block = !canAttach
            ? "unsupported"
            : !parentChanged.canMutate()
              ? "unavailable"
              : null;
          event.dataTransfer.dropEffect = block ? "none" : "copy";
          dropFeedback.show(
            dropBox.current,
            attachmentDropVerdict(
              droppedFileCount(event.dataTransfer),
              draftRef.current.attachments.length,
              block,
            ),
            event,
          );
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          dropFeedback.hide();
        }}
        onDrop={(event) => {
          dropFeedback.hide();
          if (!parentChanged.canMutate()) {
            event.preventDefault();
            return;
          }
          if (!hasFiles(event)) return;
          event.preventDefault();
          if (!canAttach) return;
          const files = [...event.dataTransfer.files];
          void collect(() => attachmentsFromFiles(files));
        }}
      >
        {/* One field frame like the composer: attachments on top, the attach action below. */}
        <PromptField
          ref={field}
          label={t("Queued message text")}
          readOnly={parentClosed}
          value={draft.text}
          minRows={5}
          maxRows={14}
          spellCheck={false}
          placeholder={t("Message")}
          onChange={(event) =>
            change(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          frameProps={{ ref: dropBox }}
          header={
            draft.attachments.length > 0 ? (
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
            ) : null
          }
          toolbarLeading={
            canAttach ? (
              <Button
                iconOnly
                label={t("Add files or images")}
                variant="ghost"
                type="button"
                tooltip={t("Add files or images")}
                aria-label={t("Add files or images")}
                disabled={parentClosed}
                onClick={() => void collect(pickAttachments)}
              >
                <FilePlus className="icon-sm" />
              </Button>
            ) : undefined
          }
        />

        {loadingAttachments > 0 ? <p role="status">{t("Loading…")}</p> : null}

        {draft.attachments.some((file) => file.missing) ? (
          <p className="text-ui-micro leading-4 text-(--ui-tone-warning-fg)">
            {t("Missing files are dropped from the message when you save.")}
          </p>
        ) : null}
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}

        {parentClosed ? (
          <p role="status">{t("Preparing session checkpoint. Your draft is kept.")}</p>
        ) : null}
      </div>
    </Modal>
  );
}
