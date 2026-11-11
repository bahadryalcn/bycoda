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
import { MAX_ATTACHMENTS, MAX_EMBED_BYTES, revokeAttachment } from "../model/attachments";
import { setComposerAttachments } from "../model/draftCache";
import { releaseAttachments } from "../model/releaseAttachments";
import { harnessSupportsAttachments, type Attachment, type HarnessId } from "../model/session";
import { t, useT } from "../../../shared/i18n";

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

/** Same file added twice: the merge skips it on purpose, so it is not a loss. */
function sameAttachment(a: Attachment, b: Attachment): boolean {
  return (
    a.id === b.id ||
    !!(a.path && b.path && a.path === b.path && a.hostEnvironmentId === b.hostEnvironmentId)
  );
}

/**
 * Files an add left out because the draft is full. They are released, and the
 * reader is told how many went in, instead of the extra files vanishing.
 */
export function releaseOverLimit(
  previous: Attachment[],
  next: Attachment[],
  incoming: Attachment[],
): string | null {
  const fresh = incoming.filter((file) => !previous.some((item) => sameAttachment(item, file)));
  const left = fresh.filter((file) => !next.includes(file));
  if (left.length === 0) return null;
  // A later duplicate of an attached file is not a loss either.
  const dropped = left.filter((file) => !next.some((item) => sameAttachment(item, file)));
  if (dropped.length === 0) return null;
  dropped.forEach(revokeAttachment);
  return t("Attached {p0} of {p1} files. A message carries up to {p2}.", {
    p0: next.length - previous.length,
    p1: fresh.length,
    p2: MAX_ATTACHMENTS,
  });
}

/**
 * Pasted blobs that could not be read (over the embed limit, or unreadable) are
 * left out by the reader. Says so when every pasted file was a blob.
 */
export function skippedPastedFiles(files: File[], attached: Attachment[]): string | null {
  if (files.some((file) => (file as File & { path?: string }).path?.trim())) return null;
  const skipped = files.length - attached.length;
  if (skipped <= 0) return null;
  return t("{p0} of {p1} pasted files could not be attached (larger than {p2} MB or unreadable).", {
    p0: skipped,
    p1: files.length,
    p2: Math.round(MAX_EMBED_BYTES / (1024 * 1024)),
  });
}

type LifecycleOptions = {
  sessionId: string | undefined;
  harness: HarnessId;
  attachments: Attachment[];
  attachmentsRef: RefObject<Attachment[]>;
  borrowedAttachmentIdsRef: RefObject<Set<string>>;
  pasteGenerationRef: RefObject<number>;
  mountedClosure: MountedClosure;
  setPasteError: Dispatch<SetStateAction<string | null>>;
};

/**
 * The lifetime of the draft's attachment list: its saved copy, its release when
 * the Composer is retired, and the notice when the provider cannot take files.
 * The list, its ref and the send/paste refs stay owned by the Composer.
 */
export function useComposerAttachmentLifecycle({
  sessionId,
  harness,
  attachments,
  attachmentsRef,
  borrowedAttachmentIdsRef,
  pasteGenerationRef,
  mountedClosure,
  setPasteError,
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
    if (attachmentsRef.current.length === 0) return;
    // The files stay in the draft (switching back sends them); Send explains
    // why they are not going out while this provider cannot take them.
    setPasteError(
      t("This provider cannot take attachments. They are kept; remove them or switch provider."),
    );
  }, [harness]);
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

// Module level: React Compiler cannot lower try/finally inside a hook.
function applyAtDepth<T>(depth: { current: number }, mutation: () => T): T {
  depth.current++;
  try {
    return mutation();
  } finally {
    depth.current--;
  }
}

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
  const t = useT();
  const rememberAttachmentRead = useCallback(
    (read: (accepted: ComposerPreparation & { isCurrent(): boolean }) => Promise<void>) => {
      let parentAttempt: ParentAdmission | null = parentInputRef.current?.admit() ?? null;
      if (!parentAttempt) {
        setPasteError(t("Attachments cannot be added while this conversation changes. Try again."));
        return;
      }
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
            attempt.apply(() => accepted.apply(() => applyAtDepth(attachmentApplyDepth, mutation))),
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
    // The ref objects are stable; they are listed so the compiler can keep this memoization.
    [
      mountedClosure,
      setPasteError,
      t,
      pasteFlightRef,
      parentInputRef,
      attachmentApplyDepth,
      pasteGenerationRef,
      pasteFailuresRef,
    ],
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
                  t(
                    "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
                  ),
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
    [rememberAttachmentRead, setPasteError, t, sinkRef],
  );

  return { rememberAttachmentRead, readDroppedAttachments };
}
