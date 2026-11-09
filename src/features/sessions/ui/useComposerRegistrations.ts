import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { registerDeviceImageComposer } from "../../devices/deviceImageComposer";
import { registerBrowserComposer } from "../../host-tools/browserComposer";
import { registerLogsComposer } from "../../host-tools/logsComposer";
import { MAX_ATTACHMENTS, mergeAttachments } from "../model/attachments";
import { tokensForIncoming } from "../model/attachmentTokens";
import type { Attachment } from "../model/session";
import { applyTextareaEdit } from "./composerTextareaEdit";

type Options = {
  cwd: string | undefined;
  sessionId: string | undefined;
  disabled: boolean;
  attachmentsSupported: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The Composer's attachment list; this hook only reads and replaces it in handlers. */
  attachmentsRef: RefObject<Attachment[]>;
  draftRevisionRef: RefObject<number>;
  canMutateDraft: () => boolean;
  addAttachments: (incoming: Attachment[]) => void;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setPasteError: Dispatch<SetStateAction<string | null>>;
  syncHasText: (text: string) => void;
};

/**
 * Registers this Composer as the receiver of the Browser, Device and Logs tools
 * for its (cwd, session). Each receiver edits the draft only through the same
 * mutation gate and revision bump as a user edit, and refuses without touching
 * the draft when it cannot accept the whole item.
 */
export function useComposerRegistrations({
  cwd,
  sessionId,
  disabled,
  attachmentsSupported,
  inputRef,
  attachmentsRef,
  draftRevisionRef,
  canMutateDraft,
  addAttachments,
  setAttachments,
  setPasteError,
  syncHasText,
}: Options) {
  useEffect(() => {
    if (!sessionId || !cwd || disabled) return;
    return registerBrowserComposer(cwd, sessionId, (file) => {
      if (!canMutateDraft()) return false;
      if (!attachmentsSupported || attachmentsRef.current.length >= MAX_ATTACHMENTS) return false;
      addAttachments([file]);
      return attachmentsRef.current.some((entry) => entry.id === file.id);
    });
  }, [
    cwd,
    sessionId,
    disabled,
    attachmentsSupported,
    addAttachments,
    attachmentsRef,
    canMutateDraft,
  ]);

  useEffect(() => {
    if (!sessionId || !cwd || disabled) return;
    return registerDeviceImageComposer(cwd, sessionId, (file, context) => {
      if (!canMutateDraft()) return false;
      const el = inputRef.current;
      const previous = attachmentsRef.current;
      if (!el || !attachmentsSupported || previous.length >= MAX_ATTACHMENTS) return false;
      const next = mergeAttachments(previous, [file]);
      if (!next.some((entry) => entry.id === file.id)) return false;
      const token = tokensForIncoming(previous, next.slice(previous.length)).trim();
      const text = `${el.value}${el.value ? "\n\n" : ""}${token}\n${context}`;
      // Accept the image and context in one synchronous draft edit. A refusal
      // above leaves both the existing text and the attachment list untouched.
      applyTextareaEdit(el, text, text.length);
      attachmentsRef.current = next;
      setAttachments(next);
      setPasteError(null);
      draftRevisionRef.current += 1;
      syncHasText(el.value);
      el.focus();
      return true;
    });
  }, [
    cwd,
    sessionId,
    disabled,
    attachmentsSupported,
    attachmentsRef,
    canMutateDraft,
    draftRevisionRef,
    inputRef,
    setAttachments,
    setPasteError,
    syncHasText,
  ]);

  useEffect(() => {
    if (!sessionId || !cwd || disabled) return;
    return registerLogsComposer(cwd, sessionId, (text) => {
      const el = inputRef.current;
      if (!canMutateDraft()) return false;
      if (!el || !text) return false;
      draftRevisionRef.current += 1;
      const next = `${el.value}${el.value ? "\n\n" : ""}${text}`;
      applyTextareaEdit(el, next, next.length);
      syncHasText(el.value);
      el.focus();
      return true;
    });
  }, [cwd, sessionId, disabled, canMutateDraft, draftRevisionRef, inputRef, syncHasText]);
}
