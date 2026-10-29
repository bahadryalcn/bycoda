import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ComposerPreparation } from "../data/composerClosure";
import type { ParentAdmission, ParentInputHandle } from "../data/parentInputClosure";
import type { useMountedComposerClosure } from "../hooks/useMountedComposerClosure";
import { revokeAttachment } from "../model/attachments";
import { setComposerAttachments } from "../model/draftCache";
import { releaseAttachments } from "../model/releaseAttachments";
import { harnessSupportsAttachments, type Attachment, type HarnessId } from "../model/session";

type MountedClosure = ReturnType<typeof useMountedComposerClosure>;

/** What a finished read may do to the draft; always the latest render's view. */
export type AttachmentSink = {
  attachmentsSupported: boolean;
  remote: boolean;
  addAttachments: (incoming: Attachment[]) => void;
};

/**
 * Keeps the newest sink readable from callbacks that outlive a render (IPC
 * listeners, finished reads) without detaching and re-attaching them.
 */
export function useAttachmentSink({
  attachmentsSupported,
  remote,
  addAttachments,
}: AttachmentSink): RefObject<AttachmentSink> {
  const sinkRef = useRef<AttachmentSink>({ attachmentsSupported, remote, addAttachments });
  useLayoutEffect(() => {
    sinkRef.current = { attachmentsSupported, remote, addAttachments };
  }, [attachmentsSupported, remote, addAttachments]);
  return sinkRef;
}

type LifecycleOptions = {
  sessionId: string | undefined;
  harness: HarnessId;
  attachments: Attachment[];
  attachmentsRef: RefObject<Attachment[]>;
  borrowedAttachmentIdsRef: RefObject<Set<string>>;
  pasteGenerationRef: RefObject<number>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mountedClosure: MountedClosure;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  syncHasText: (text: string) => void;
};

/**
 * The lifetime of the draft's attachment list: its saved copy, its release when
 * the Composer is retired, and its drop when the provider cannot take files.
 * The list, its ref and the send/paste refs stay owned by the Composer.
 */
export function useComposerAttachmentLifecycle({
  sessionId,
  harness,
  attachments,
  attachmentsRef,
  borrowedAttachmentIdsRef,
  pasteGenerationRef,
  inputRef,
  mountedClosure,
  setAttachments,
  syncHasText,
}: LifecycleOptions) {
  const lifecycleRef = useRef(0);

  useEffect(() => {
    // Object URLs die with this pane, so the saved copy keeps none.
    if (sessionId) {
      mountedClosure.publishCache(() =>
        setComposerAttachments(
          sessionId,
          attachments.map(({ previewUrl: _preview, ...file }) => file),
        ),
      );
    }
  }, [sessionId, attachments]);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycleRef.current !== lifecycle) return;
        // Retirement captures refs before teardown and keeps accepted reads and
        // actual Native writes alive. A failed capture keeps its only data owner.
        void mountedClosure.retire().then(
          () => {
            if (lifecycleRef.current !== lifecycle) return;
            pasteGenerationRef.current += 1;
            releaseAttachments(attachmentsRef.current, borrowedAttachmentIdsRef.current);
            attachmentsRef.current = [];
            borrowedAttachmentIdsRef.current.clear();
          },
          () => {},
        );
      });
    };
  }, [mountedClosure]);

  useEffect(() => {
    if (harnessSupportsAttachments(harness)) return;
    const previous = attachmentsRef.current;
    if (previous.length === 0) return;
    mountedClosure.changed();
    releaseAttachments(previous, borrowedAttachmentIdsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    syncHasText(inputRef.current?.value ?? "");
  }, [harness, syncHasText]);
}

type ReadOptions = {
  parentInputRef: RefObject<ParentInputHandle | null>;
  mountedClosure: MountedClosure;
  sinkRef: RefObject<AttachmentSink>;
  /** Nested `apply` depth: lets a finished read mutate while the draft is otherwise closed. */
  attachmentApplyDepth: RefObject<number>;
  pasteGenerationRef: RefObject<number>;
  pasteFailuresRef: RefObject<number>;
  /** Pasted and dropped files still reading; Send waits for it. */
  pasteFlightRef: RefObject<Promise<void> | null>;
  setPasteError: Dispatch<SetStateAction<string | null>>;
};

/**
 * Admits asynchronous file reads (paste, pick, drop) as retained Parent and
 * Composer preparations. A read that outlives its draft, or fails, cannot land
 * on a later draft. The generation, failure and flight refs belong to the
 * Composer's send path, which also reads them; this hook only advances them.
 */
export function useComposerAttachmentReads({
  parentInputRef,
  mountedClosure,
  sinkRef,
  attachmentApplyDepth,
  pasteGenerationRef,
  pasteFailuresRef,
  pasteFlightRef,
  setPasteError,
}: ReadOptions) {
  const rememberAttachmentRead = useCallback(
    (read: (accepted: ComposerPreparation & { isCurrent(): boolean }) => Promise<void>) => {
      let parentAttempt: ParentAdmission | null = parentInputRef.current?.admit() ?? null;
      if (!parentAttempt) return;
      const initialParentAttempt = parentAttempt;
      let generation = pasteGenerationRef.current;
      let failures = pasteFailuresRef.current;
      const work = mountedClosure.prepare((accepted) => {
        if (parentAttempt!.settled) parentAttempt = parentAttempt!.resume();
        const attempt = parentAttempt;
        if (!attempt) throw new Error("Parent preparation owner changed.");
        void accepted.whenSettled?.().then(attempt.finish, attempt.finish);
        // Another failed read still cancels ordinary pending reads/Send, but
        // cannot silently turn this retained selection into a different draft.
        // Only non-failure generation transitions invalidate explicit retry.
        if (pasteGenerationRef.current - generation !== pasteFailuresRef.current - failures)
          throw new Error("Attachment preparation belongs to an earlier draft.");
        generation = pasteGenerationRef.current;
        failures = pasteFailuresRef.current;
        return read({
          ...accepted,
          isCurrent: () => pasteGenerationRef.current === generation,
          apply: (mutation) =>
            attempt.apply(() =>
              accepted.apply(() => {
                attachmentApplyDepth.current++;
                try {
                  return mutation();
                } finally {
                  attachmentApplyDepth.current--;
                }
              }),
            ),
        });
      });
      void work.then(initialParentAttempt.finish, initialParentAttempt.finish);
      const flight = work.then(
        () => undefined,
        (reason: unknown) => {
          if (pasteGenerationRef.current !== generation) return;
          // Abort a Send already waiting on this failed read, retaining its text.
          pasteGenerationRef.current += 1;
          pasteFailuresRef.current += 1;
          // The retained intent owns this failure transition only. A genuine
          // later reset/send still makes its explicit retry stale before work.
          generation = pasteGenerationRef.current;
          failures = pasteFailuresRef.current;
          setPasteError(reason instanceof Error ? reason.message : String(reason));
        },
      );
      const previous = pasteFlightRef.current;
      const joined = previous ? previous.then(() => flight) : flight;
      pasteFlightRef.current = joined;
      void joined.finally(() => {
        if (pasteFlightRef.current === joined) pasteFlightRef.current = null;
      });
    },
    [mountedClosure],
  );

  const readDroppedAttachments = useCallback(
    (read: () => Promise<Attachment[]>) => {
      setPasteError(null);
      rememberAttachmentRead((accepted) =>
        Promise.resolve()
          .then(read)
          .then((incoming) =>
            accepted.apply(() => {
              if (!accepted.isCurrent() || !sinkRef.current.attachmentsSupported) {
                incoming.forEach(revokeAttachment);
                return;
              }
              if (incoming.length === 0) {
                setPasteError(
                  "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
                );
                return;
              }
              sinkRef.current.addAttachments(incoming);
            }),
          )
          .catch((reason: unknown) => {
            if (!accepted.isCurrent()) return;
            accepted.fail(reason);
            setPasteError(reason instanceof Error ? reason.message : String(reason));
          }),
      );
    },
    [rememberAttachmentRead],
  );

  return { rememberAttachmentRead, readDroppedAttachments };
}
