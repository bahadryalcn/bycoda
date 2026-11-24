import { errorText } from "../../../shared/lib/errors";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { PromptField } from "../../../shared/ui/PromptField";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { captureDraft, dropPastedText, insertRestoredText } from "../../../shared/lib/draftRestore";
import { capturePastedTextAttachment, replacePastedText } from "../model/pastedTextAttachment";
import { droppedFileCount } from "../../../shared/lib/externalDrop";
import { useExternalDropFeedback } from "../../../shared/hooks/useExternalDropFeedback";
import { attachmentDropVerdict } from "../model/attachmentDrop";
import {
  clipboardTextWithAttachments,
  isFileReferenceText,
  messageFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  pickAttachments,
  revokeAttachment,
} from "../model/attachments";
import { collectSkippedAttachments } from "../model/attachmentSkips";
import { attachmentDraftTokens, insertAtSelection } from "../model/attachmentTokens";
import { extractChatCitations, withChatCitations, type ChatCitation } from "../model/chatCitation";
import { removeCitationFromText } from "../model/citationTokens";
import { HARNESS_TITLE } from "../model/session";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerCitations } from "./ComposerCitations";
import { ComposerHighlight, type ComposerReferenceContext } from "./ComposerHighlight";
import { ComposerInlineEditor } from "./ComposerInlineEditor";
import { leadingModeCommand, MODE_COMMAND_INDENT } from "./modeCommands";
import {
  QueuedEditSuggestions,
  type QueuedEditSuggestionScope,
  type QueuedEditSuggestionsHandle,
} from "./QueuedEditSuggestions";
import { applyMentionDeletion } from "./composerTextareaEdit";
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
  type QueuedPasteLayout,
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
  references?: ComposerReferenceContext;
  /** Enables the composer's `/` and `@` menus for this chat. */
  suggestions?: QueuedEditSuggestionScope;
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

/** Dispatch may have happened before a callback threw, so a throw keeps the input as unknown. */
function dispatchSave<Input extends object>(
  onSave: (text: string, attachments: Attachment[]) => void,
  next: { text: string; attachments: Attachment[] },
  retained: { update: (input: Input & { disposition: string }) => unknown },
  input: Input,
  outcome: { accepted: () => void; failed: (message: string) => void },
) {
  try {
    onSave(next.text, next.attachments);
    retained.update({ ...input, disposition: "accepted-unknown" });
    outcome.accepted();
  } catch (reason) {
    // The visible error is not an authoritative rejection; keep the original input as unknown.
    retained.update({ ...input, disposition: "dispatch-unknown" });
    outcome.failed(presentRemoteError(reason, { explicit: true }));
  }
}

/** Reads and applies prepared attachments; `release` always runs, as the `finally` of the read. */
async function finishCollect(steps: {
  read: () => Promise<Attachment[]>;
  apply: (incoming: Attachment[]) => unknown;
  isAlive: () => boolean;
  setError: (message: string) => void;
  release: () => void;
}) {
  try {
    steps.apply(await steps.read());
  } catch (reason) {
    if (steps.isAlive()) steps.setError(errorText(reason));
  } finally {
    steps.release();
  }
}

/** Edits a queued message's text and attachments in a dialog instead of the queue row. */
function QueueEditContent({
  parentSessionId,
  message,
  canAttach,
  references,
  suggestions,
  onSave,
  onRemove,
  onCancel,
}: Props) {
  const t = useT();
  const parentClosed = useParentInputsClosed(parentSessionId);
  // Quotes live beside the text, as in the composer; the row's text keeps them serialized.
  const [source] = useState(() => extractChatCitations(message.text));
  const body = { ...message, text: source.text };
  const [citations, setCitations] = useState<ChatCitation[]>(source.citations);
  const [inlineAttachments, setInlineAttachments] = useState<ReadonlySet<string> | null>(null);
  const inlineActive = inlineAttachments !== null;
  const menus = useRef<QueuedEditSuggestionsHandle>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<QueuedEditDraft>(() => queuedEditDraft(body));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(0);
  const pendingAttachments = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const dropBox = useRef<HTMLDivElement>(null);
  const dropFeedback = useExternalDropFeedback();
  const draftRef = useRef(draft);
  /** Where the caret goes once the next draft is rendered. */
  const pendingCaret = useRef<number | null>(null);
  /** Attachments added here: theirs to release if the edit does not keep them. */
  const added = useRef(new Map<string, Attachment>());
  const saved = useRef(false);
  const alive = useRef(true);
  const canAttachRef = useRef(canAttach);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- publishes the committed draft and attach flag to handlers and parent-input snapshots that read the refs outside render
  useLayoutEffect(() => {
    draftRef.current = draft;
    canAttachRef.current = canAttach;
  }, [draft, canAttach]);
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

  const empty = citations.length === 0 && isQueuedEditEmpty(body, draft);
  const dirty =
    hasQueuedEditChanges(body, draft) ||
    JSON.stringify(citations) !== JSON.stringify(source.citations);
  const tokens = attachmentDraftTokens(draft.attachments);
  const skillPrefix =
    suggestions && !suggestions.remote
      ? suggestions.harness === "codex"
        ? ("$" as const)
        : ("/" as const)
      : undefined;
  const skillNames = references?.names ?? new Set<string>();
  const leadingMode = leadingModeCommand(draft.text, skillNames, { shell: true });

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
  }, [draft.text, inlineActive]);

  const requestClose = () => {
    parentChanged();
    if (confirmingDiscard) setConfirmingDiscard(false);
    else if (dirty || loadingAttachments > 0) setConfirmingDiscard(true);
    else onCancel();
  };

  const save = () =>
    mutateParentInput(parentChanged, () => {
      if (empty || pendingAttachments.current > 0) return;
      const edited = applyQueuedEdit(body, draft);
      const next = { ...edited, text: withChatCitations(edited.text, citations) };
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
      dispatchSave(onSave, next, retained, input, {
        accepted: () => {
          saved.current = true;
          parentChanged();
          setError(null);
        },
        failed: (message) => setError(message),
      });
    });

  const change = (text: string, caret: number) => {
    if (!parentChanged.canMutate()) return;
    const edit = editDraftText(draftRef.current, text, caret);
    pendingCaret.current = edit.caret;
    setError(null);
    updateDraft(edit.draft);
  };

  const attach = (incoming: Attachment[], pasteLayout?: QueuedPasteLayout) => {
    if (!alive.current || saved.current || !canAttachRef.current) {
      incoming.forEach(revokeAttachment);
      return;
    }
    if (incoming.length === 0) return;
    const el = field.current;
    const caret = pendingCaret.current;
    const selection = caret === null ? captureDraft(el) : { start: caret, end: caret };
    const result = addDraftAttachments(draftRef.current, incoming, selection, pasteLayout);
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

  const insertToken = (token: string) => {
    const el = field.current;
    if (!el) return;
    const edit = insertAtSelection(el.value, captureDraft(el), token);
    change(edit.text, edit.caret);
    el.focus();
  };

  const changeCitations = (next: ChatCitation[], removed?: number) => {
    if (!parentChanged.canMutate()) return;
    const current = draftRef.current.text;
    const text = removeCitationFromText(current, citations.length, removed ?? -1);
    setCitations(next);
    if (text !== current) change(text, Math.min(field.current?.selectionStart ?? 0, text.length));
    else parentChanged();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (!parentChanged.canMutate()) return;
    if (event.key === "Escape" && menus.current?.dismiss()) {
      event.preventDefault();
      return;
    }
    if (menus.current?.keyDown(event)) return;
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
    if (
      edit.mentionEnd !== undefined &&
      applyMentionDeletion(el, { text: edit.draft.text, caret: edit.caret, end: edit.mentionEnd })
    )
      return;
    pendingCaret.current = edit.caret;
    updateDraft(edit.draft);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!parentChanged.canMutate()) {
      event.preventDefault();
      return;
    }
    const data = event.clipboardData;
    const message = messageFromClipboard(data);
    const files = message?.files ?? filesFromClipboard(data);
    if (files.length > 0) {
      event.preventDefault();
      const { value, selectionStart, selectionEnd } = event.currentTarget;
      if (message?.text) {
        change(
          value.slice(0, selectionStart) + message.text + value.slice(selectionEnd),
          selectionStart + message.text.length,
        );
      }
      if (!canAttach) return;
      const pastedDraft = draftRef.current;
      const end = message?.text ? (pendingCaret.current ?? selectionStart) : selectionEnd;
      const start = message?.text ? end - message.text.length : selectionStart;
      void attachBlobs(files, (incoming) =>
        message?.referenceText && draftRef.current === pastedDraft && start >= 0
          ? {
              range: { start, end },
              textWithAttachments: (attachments) =>
                clipboardTextWithAttachments(message, incoming, attachments),
            }
          : undefined,
      );
      return;
    }
    // A webview reports a pasted screenshot or copied file as text only (or
    // nothing); both live on the native clipboard.
    const text = data.getData("text/plain");
    const paste =
      canAttach && !message && !isFileReferenceText(text)
        ? capturePastedTextAttachment(event.currentTarget, text)
        : undefined;
    if (paste) {
      event.preventDefault();
      const { value, selectionStart, selectionEnd } = event.currentTarget;
      change(
        value.slice(0, selectionStart) + paste.text + value.slice(selectionEnd),
        selectionStart + paste.text.length,
      );
      void attachBlobs([paste.file], (incoming) => {
        const value = draftRef.current.text;
        const range = paste.range(value);
        if (!range) return null;
        return {
          range,
          textWithAttachments: (attachments) => {
            const index = attachments.findIndex((file) => file.id === incoming[0]?.id);
            if (index < 0) return value.slice(range.start, range.end);
            const edit = replacePastedText(value, range, attachmentDraftTokens(attachments)[index]);
            return edit.text.slice(range.start, edit.caret);
          },
        };
      });
      return;
    }
    if (!canAttach || (text && !isFileReferenceText(text))) return;
    event.preventDefault();
    const captured = isFileReferenceText(text) ? captureDraft(event.currentTarget) : null;
    void collect(
      async () => {
        const { files: pasted, warning } = await nativeClipboardAttachments(text);
        if (alive.current && warning) setError(warning);
        return pasted;
      },
      (pasted) => {
        if (!captured) return;
        if (pasted.length) dropPastedText(captured, text);
        else insertRestoredText(captured, text);
      },
    );
  };

  const collect = async (
    read: () => Promise<Attachment[]>,
    restore?: (incoming: Attachment[]) => void,
    pasteLayout?: (incoming: Attachment[]) => QueuedPasteLayout | null | undefined,
  ) => {
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
      await finishCollect({
        read,
        apply: (incoming) =>
          admitted.apply(() => {
            restore?.(incoming);
            const layout = pasteLayout?.(incoming);
            if (layout === null) incoming.forEach(revokeAttachment);
            else attach(incoming, layout);
          }),
        isAlive: () => alive.current,
        setError,
        release: () => {
          pendingAttachments.current -= 1;
          parentChanged();
          pending.release();
          if (alive.current) setLoadingAttachments(pendingAttachments.current);
        },
      });
    });
  };

  /** Pasted and dropped files: valid ones attach, skipped blobs are named instead of vanishing. */
  const attachBlobs = (
    files: File[],
    pasteLayout?: (incoming: Attachment[]) => QueuedPasteLayout | null | undefined,
  ) =>
    collect(
      async () => {
        const skips = collectSkippedAttachments();
        const attached = await attachmentsFromFiles(files, { onSkipped: skips.onSkipped });
        const notice = skips.notice();
        if (alive.current && notice) setError(notice);
        return attached;
      },
      undefined,
      pasteLayout,
    );

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  return (
    <Modal
      title={t("Edit queued message")}
      size="md"
      fitViewport
      onClose={requestClose}
      onEscape={() => {
        if (!menus.current?.dismiss()) requestClose();
      }}
      footer={
        confirmingDiscard ? (
          <ModalActions
            start={
              <Text size="body" tone="secondary" role="status">
                {t("Discard your changes?")}
              </Text>
            }
          >
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
              variant="primary"
              tone="danger"
              type="button"
              onClick={() => {
                parentChanged();
                onCancel();
              }}
            >
              {t("Discard")}
            </Button>
          </ModalActions>
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
              shortcut="Mod+Enter"
            >
              {t("Save")}
            </Button>
          </ModalActions>
        )
      }
    >
      <div
        className="flex flex-col gap-3"
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
          void attachBlobs(files);
        }}
      >
        {/* One field frame like the composer: attachments on top, the attach action below. */}
        <PromptField
          ref={field}
          label={t("Queued message text")}
          readOnly={parentClosed}
          hidden={inlineActive}
          aria-hidden={inlineActive || undefined}
          value={draft.text}
          indent={leadingMode ? MODE_COMMAND_INDENT : undefined}
          overlay={
            inlineActive ? undefined : (
              <ComposerHighlight
                text={draft.text}
                mode={leadingMode}
                names={skillNames}
                skillParts={references?.skillParts ?? ((text) => [{ text }])}
                mentions={references?.mentions ?? new Map()}
                mcpTags={references?.mcpTags ?? []}
                {...references}
                attachments={draft.attachments}
                citations={citations.length}
                field={field}
              />
            )
          }
          minRows={5}
          maxRows={14}
          spellCheck={false}
          placeholder={t("Message")}
          // The inline editor writes the field's value directly, so React's change tracking misses it.
          onChange={() => {}}
          onInput={(event) => {
            const el = event.currentTarget;
            change(el.value, el.selectionStart ?? el.value.length);
            menus.current?.sync(el);
          }}
          onClick={(event) => menus.current?.sync(event.currentTarget)}
          onKeyUp={(event) => menus.current?.sync(event.currentTarget, true)}
          onSelect={(event) => menus.current?.sync(event.currentTarget, true)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          frameProps={{ ref: dropBox }}
          frameClassName="[--composer-draft-max-height:20rem]"
          header={
            citations.length > 0 || draft.attachments.length > 0 ? (
              <>
                <ComposerCitations
                  citations={citations}
                  disabled={parentClosed}
                  onChange={changeCitations}
                />
                {draft.attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                    {draft.attachments.map((file, index) => (
                      <AttachmentChip
                        key={file.id}
                        attachment={file}
                        token={tokens[index]}
                        draft={suggestions ? { projectRoot: suggestions.executionCwd } : undefined}
                        onInsertToken={
                          inlineAttachments?.has(file.id)
                            ? undefined
                            : () => insertToken(tokens[index])
                        }
                        onRemove={() => remove(file.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null
          }
          toolbarLeading={
            canAttach || skillPrefix ? (
              <ComposerAddMenu
                open={addOpen}
                onOpenChange={setAddOpen}
                align="start"
                disabled={parentClosed}
                uploadUnavailable={
                  canAttach || !suggestions
                    ? undefined
                    : t("{p0} does not support attachments", {
                        p0: HARNESS_TITLE[suggestions.harness],
                      })
                }
                skillPrefix={skillPrefix}
                onUpload={() => void collect(pickAttachments)}
                onSkills={() => menus.current?.openSkills()}
              />
            ) : undefined
          }
        >
          <ComposerInlineEditor
            field={field}
            text={draft.text}
            attachmentProjectRoot={suggestions?.executionCwd}
            references={{
              names: skillNames,
              skillParts: references?.skillParts ?? ((text) => [{ text }]),
              skillGroups: references?.skillGroups,
              skillDetails: references?.skillDetails,
              mentions: references?.mentions ?? new Map(),
              mcpTags: references?.mcpTags ?? [],
              attachments: draft.attachments,
              citations: citations.length,
              modeEnd: leadingMode?.end ?? 0,
              onOpenFile: references?.onOpenFile,
            }}
            label={t("Queued message text")}
            placeholder={t("Message")}
            readOnly={parentClosed}
            disabled={false}
            spellCheck={false}
            hasSubagents={false}
            onInlineAttachments={setInlineAttachments}
            onRemoveAttachment={remove}
          />
        </PromptField>
        {suggestions ? (
          <QueuedEditSuggestions
            ref={menus}
            scope={suggestions}
            parentSessionId={parentSessionId}
            field={field}
            anchor={dropBox}
            canEdit={parentChanged.canMutate}
            onEdit={change}
            onError={setError}
          />
        ) : null}

        {loadingAttachments > 0 ? <LoadingText delay={false}>{t("Loading…")}</LoadingText> : null}

        {draft.attachments.some((file) => file.missing) ? (
          <Text as="p" size="micro" tone="warning">
            {t("Missing files are dropped from the message when you save.")}
          </Text>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {parentClosed ? (
          <p role="status">{t("Preparing session checkpoint. Your draft is kept.")}</p>
        ) : null}
      </div>
    </Modal>
  );
}
