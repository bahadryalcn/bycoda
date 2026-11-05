import { QuestionFields, updateCustomAnswer, nextSelection } from "./QuestionFields";
import { useQuestionFormDraft } from "./useQuestionFormDraft";
import { useQuestionAttachmentRecovery } from "./useQuestionAttachmentRecovery";
import { QuestionAttachmentError } from "./QuestionAttachmentError";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import styles from "./QuestionForm.module.css";
import { LiveText } from "../../../shared/ui/LiveText";
import { QuestionAttachmentList } from "./QuestionAttachmentList";
import { useComposerFileDrop } from "./useComposerFileDrop";
import { useAttachmentSink } from "./useComposerAttachments";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  pickAttachments,
  MAX_ATTACHMENTS,
  revokeAttachment,
} from "../model/attachments";
import {
  pendingQuestionAttachment,
  prepareOwnedQuestionAttachments,
  prepareQuestionAttachments,
  questionAttachmentIdentity,
  questionTransportHeld,
  runQuestionAttachmentEffect,
} from "../model/questionAttachments";
import type { Attachment } from "../model/session";
import { useT } from "../../../shared/i18n";
import { usePresentationVisible } from "./presentationVisibility";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleX,
  Clock,
  CornerDownRight,
  MessageSquare,
  Play,
  FilePlus,
  RefreshCw,
  X,
} from "../../../shared/ui/icons";
import { questionDraftKey, type QuestionDraft } from "../model/questionDrafts";
import {
  buildQuestionReply,
  questionIsComplete,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../model/userQuestion";

type Props = {
  prompt: UserQuestionPrompt;
  /** Session identity; unfinished answers stay separate across sessions. */
  draftScope?: string;
  /** Actual logical root; draftScope may instead be a remote cache namespace. */
  parentSessionId?: string;
  sessionId?: string;
  /** Alternate wording for a non-destructive skip, such as a retained owner question. */
  dismissLabel?: string;
  /** A retained owner card can postpone the whole prompt without answering earlier fields. */
  dismissEntirePrompt?: boolean;
  attachmentsSupported?: boolean;
  remote?: boolean;
  onReply: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction?: (requestId: number) => void;
};

export function QuestionForm(props: Props) {
  return <QuestionFormContent key={questionDraftKey(props.draftScope, props.prompt)} {...props} />;
}

function QuestionFormContent({
  prompt,
  draftScope,
  parentSessionId,
  sessionId,
  dismissLabel,
  dismissEntirePrompt,
  attachmentsSupported = true,
  remote = false,
  onReply,
  onInteraction,
}: Props) {
  const t = useT();
  const {
    draft,
    draftRef,
    setDraft,
    submitted,
    submitting,
    setSubmitting,
    localUnknown,
    setLocalUnknown,
    form,
    parentClosed,
    parentChanged,
    reserved,
    reservation,
    mounted,
    capacityIssue,
    updateDraft,
  } = useQuestionFormDraft(prompt, draftScope, parentSessionId);
  const { step, answers, custom } = draft;
  const statusId = useId();
  const [now, setNow] = useState(Date.now);
  const visible = usePresentationVisible();
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const attachmentFlight = useRef(false);
  const recovery = useQuestionAttachmentRecovery(draft, readingAttachments, updateDraft, setAttachmentError, sessionId, questionDraftKey(draftScope, prompt), prompt, setReadingAttachments);
  const sending = submitting || prompt.delivery === "sending";
  const transportHeld = questionTransportHeld(parentClosed, sending, localUnknown || draft.delivery === "unknown", prompt.delivery);
  const held = transportHeld || !reserved || readingAttachments || recovery.blocked;

  useEffect(() => {
    if (prompt.autoResolveAt == null || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prompt.requestId, prompt.autoResolveAt, visible]);

  const interact = () => {
    if (!reserved || !reservation.current?.current() || !parentChanged.canMutate()) return;
    if (prompt.autoResolveAt != null) onInteraction?.(prompt.requestId);
  };

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const canAttach =
    attachmentsSupported && !!question?.allowCustom && !question.preserveCustomWhitespace;
  const files = draft.attachments?.[question?.id ?? ""] ?? [];
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  const readAttachments = (read: () => Promise<Attachment[]>) => {
    if (!canAttach || held || attachmentFlight.current || !parentChanged.canMutate()) return;
    const admission = parentChanged.admit();
    if (!admission) return;
    interact();
    attachmentFlight.current = true;
    setReadingAttachments(true);
    setAttachmentError(null);
    void (async () => {
      let incoming: Attachment[] = [];
      try {
        incoming = await read();
        if (
          Object.values(draftRef.current.attachments ?? {}).flat().length + incoming.length >
          MAX_ATTACHMENTS
        )
          throw new Error(t("A message carries up to {p0} attachments.", { p0: MAX_ATTACHMENTS }));
        if (!sessionId && incoming.some((file) => !file.path?.trim()))
          throw new Error(t("Question attachment session identity is unavailable"));
        const pending = sessionId
          ? incoming.map((file) => pendingQuestionAttachment(file, questionDraftKey(draftScope, prompt), sessionId, questionAttachmentIdentity(prompt, question.id)))
          : [];
        let staged = !sessionId;
        if (sessionId) admission.apply(() => {
          staged = updateDraft((current) => ({
            ...current,
            attachments: { ...current.attachments, [question.id]: [...(current.attachments?.[question.id] ?? []), ...pending] },
          }));
        });
        if (!staged) return;
        const prepared = sessionId
          ? await prepareOwnedQuestionAttachments(incoming, pending, (error) => { if (mounted.current) setAttachmentError(String(error instanceof Error ? error.message : error)); })
          : await prepareQuestionAttachments(incoming);
        admission.apply(() => {
          if (!mounted.current || !reservation.current?.current()) return;
          updateDraft((current) => ({
            ...current,
            attachments: {
              ...current.attachments,
              [question.id]: sessionId
                ? (current.attachments?.[question.id] ?? []).map((file) => prepared.find((item) => item.id === file.id) ?? file)
                : [...(current.attachments?.[question.id] ?? []), ...prepared],
            },
          }));
        });
      } catch (error) {
        if (mounted.current)
          setAttachmentError(String(error instanceof Error ? error.message : error));
      } finally {
        incoming.forEach(revokeAttachment);
        attachmentFlight.current = false;
        if (mounted.current) setReadingAttachments(false);
        admission.finish();
      }
    })();
  };
  const sink = useAttachmentSink({
    attachmentsSupported: canAttach,
    remote,
    addAttachments: () => {},
  });
  useComposerFileDrop({
    enabled: canAttach,
    disabled: held,
    attachmentsSupported: canAttach,
    boxRef: form,
    sinkRef: sink,
    attachmentsRef: filesRef,
    persistBlobs: false,
    readDroppedAttachments: readAttachments,
    setPasteError: setAttachmentError,
  });
  const last = index >= total - 1;
  const ready = question
    ? !Object.values(draft.attachments ?? {}).flat().some((file) => file.missing) && (questionIsComplete(question, answers, custom) || (canAttach && files.length > 0))
    : false;

  const sendNow = (
    reply: UserQuestionReply,
    pendingAction: QuestionDraft["pendingAction"] = "answer",
  ) => {
    if (submitted.current || held) return;
    const originalReservation = reservation.current;
    if (!originalReservation?.current()) return;
    const admitted = parentChanged.admit();
    if (!admitted) return;
    try {
      admitted.apply(() => {
        if (!updateDraft((current) => ({ ...current, delivery: "sending", pendingAction }))) return;
        submitted.current = true;
        setSubmitting(true);
        setLocalUnknown(false);
        parentChanged();
        try {
          onReply(prompt.requestId, reply);
        } catch {
          if (mounted.current) setSubmitting(false);
          // A callback can throw after dispatch. Only an authoritative failed
          // transport update can establish that sending again is safe.
          if (mounted.current) setLocalUnknown(true);
          // This is the original synchronous admitted continuation, including
          // when dispatch retired the view. It records uncertainty, never retries.
          const original = originalReservation.read();
          if (original) {
            const retained = originalReservation.write({ ...original, delivery: "unknown" });
            if (retained.ok && mounted.current && reservation.current === originalReservation) {
              draftRef.current = retained.value;
              setDraft(retained.value);
              parentChanged();
            }
          }
        }
      });
    } finally {
      admitted.finish();
    }
  };
  const send = (reply: UserQuestionReply, action: QuestionDraft["pendingAction"] = "answer") => {
    const all = Object.values(draftRef.current.attachments ?? {}).flat();
    if (held || (reply.kind === "answered" && all.some((file) => file.missing))) return;
    runQuestionAttachmentEffect(all, reply.kind === "answered" ? "retain" : "release", () => sendNow(reply, action), setReadingAttachments, setAttachmentError, attachmentFlight);
  };
  const finish = (
    nextAnswers = answers,
    nextCustom = custom,
    pendingAction: QuestionDraft["pendingAction"] = "answer",
  ) =>
    send(
      buildQuestionReply(
        questions,
        nextAnswers,
        nextCustom,
        draftRef.current.attachments,
        draftRef.current.notes,
      ),
      pendingAction,
    );

  const skipNow = () => {
    if (held || submitted.current) return;
    if (
      dismissEntirePrompt ||
      prompt.dismissAction === "cancel" ||
      prompt.dismissAction === "decline"
    ) {
      send({ kind: "skipped" }, "dismiss");
      return;
    }
    if (!question) {
      finish(answers, custom, "dismiss");
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    const nextAttachments = { ...draftRef.current.attachments };
    delete nextAttachments[question.id];
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    const nextNotes = { ...draftRef.current.notes };
    delete nextNotes[question.id];
    if (last) {
      if (
        !updateDraft((current) => ({
          ...current,
          notes: nextNotes,
          answers: nextAnswers,
          custom: nextCustom,
          attachments: nextAttachments,
        }))
      )
        return;
      finish(nextAnswers, nextCustom, "dismiss");
      return;
    }
    updateDraft(() => ({
      notes: nextNotes,
      answers: nextAnswers,
      custom: nextCustom,
      attachments: nextAttachments,
      step: index + 1,
    }));
  };

  const skipCurrent = () => {
    if (held || submitted.current) return;
    if (dismissEntirePrompt || prompt.dismissAction === "cancel" || prompt.dismissAction === "decline") { skipNow(); return; }
    runQuestionAttachmentEffect(files, "release", skipNow, setReadingAttachments, setAttachmentError, attachmentFlight);
  };
  const continueCurrent = () => {
    if (!question || !ready || held || submitted.current) return;
    if (last) {
      finish();
      return;
    }
    updateDraft((current) => ({ ...current, step: index + 1 }));
  };

  if (!question) return null;

  const heading = question.header?.trim() || prompt.title?.trim();
  // Providers may repeat the entire question as their header.
  const title = heading && heading !== question.prompt.trim() ? heading : undefined;
  const queued = prompt.delivery === "queued";
  const uncertain =
    !queued && (prompt.delivery === "unknown" || localUnknown || draft.delivery === "unknown" || capacityIssue === "pending");
  const capacityMessage =
    capacityIssue === "capacity"
      ? t(
          "Question capacity is full. Your saved answers are kept. Resolve or discard another question to continue.",
        )
      : capacityIssue === "size"
        ? t("This question or answer is too large to keep locally. Your previous answer is kept.")
        : capacityIssue && capacityIssue !== "pending" && capacityIssue !== "closed"
          ? t("Question state changed. Your saved answer is kept.")
          : undefined;
  const failed = !sending && prompt.delivery === "failed";
  const dismissing = sending && draft.pendingAction === "dismiss";
  const pendingLabel = dismissing
    ? prompt.dismissAction === "cancel"
      ? t("Cancelling…")
      : t("Sending…")
    : t("Sending answer…");
  const status =
    prompt.delivery === "queued"
      ? t("Answer saved · waiting to continue")
      : uncertain
        ? prompt.error
          ? t(prompt.error)
          : t(
              "Answer delivery could not be confirmed. Wait for the connection to recover before sending again.",
            )
        : sending
          ? pendingLabel
          : failed
            ? prompt.error
              ? t(prompt.error)
              : t("Answer was not sent. Your answer is kept; try again.")
            : prompt.behavior === "blocking"
              ? t("Waiting for your answer")
              : prompt.behavior === "nonBlocking"
                ? t("Work may continue while this question is open")
                : t("Question open");
  const StatusIcon =
    uncertain || failed
      ? CircleAlert
      : sending || queued || prompt.behavior === "blocking"
        ? Clock
        : prompt.behavior === "nonBlocking"
          ? Play
          : MessageSquare;
  const DismissIcon =
    prompt.dismissAction === "cancel"
      ? X
      : prompt.dismissAction === "decline"
        ? CircleX
        : CornerDownRight;
  const SubmitIcon = uncertain
    ? CircleAlert
    : queued
      ? Clock
      : !last
        ? ChevronRight
        : failed
          ? RefreshCw
          : ArrowUp;
  const submitLabel = queued
    ? t("Waiting")
    : uncertain
      ? t("Connection issue")
      : sending && !dismissing
        ? pendingLabel
        : !last
          ? t("Next")
          : failed
            ? t("Send again")
            : t("Send answer");

  return (
    <div
      className="px-1.5 pb-1.5"
      data-question-form
      onPointerDownCapture={interact}
      onClickCapture={interact}
      onKeyDownCapture={interact}
      onPasteCapture={interact}
      onChangeCapture={interact}
    >
      <form
        ref={form}
        className={`bycoda-arc ${styles.form}`}
        aria-label={t("Question")}
        aria-busy={sending}
        onPaste={(event) => {
          const pasted = filesFromClipboard(event.clipboardData);
          if (!canAttach || !pasted.length) return;
          event.preventDefault();
          event.stopPropagation();
          readAttachments(async () => {
            const attached = await attachmentsFromFiles(pasted, { persistBlobs: false });
            if (attached.length !== pasted.length)
              throw new Error(t("Some files could not be attached. Try attaching them again."));
            return attached;
          });
        }}
        onSubmit={(event) => {
          event.preventDefault();
          continueCurrent();
        }}
      >
        {title || total > 1 ? (
          <div className={styles.context}>
            <MessageSquare className="icon-sm shrink-0 text-(--ui-text-secondary)" aria-hidden />
            {title ? (
              <span className={styles.contextTitle}>{title}</span>
            ) : (
              <span className="sr-only">{t("Question")}</span>
            )}
            {total > 1 ? (
              <LiveText className={styles.progress} text={`${index + 1} / ${total}`} />
            ) : null}
          </div>
        ) : null}
        <fieldset className={styles.body} disabled={sending}>
          <QuestionFields
            key={question.id}
            question={question}
            selected={answers[question.id] ?? []}
            custom={custom[question.id] ?? ""}
            note={draft.notes?.[question.id] ?? ""}
            onNote={(value) =>
              updateDraft((current) => ({
                ...current,
                notes: { ...current.notes, [question.id]: value },
              }))
            }
            locked={held}
            onSelect={(optionId) =>
              updateDraft((current) => ({
                ...current,
                answers: {
                  ...current.answers,
                  [question.id]: nextSelection(
                    question,
                    current.answers[question.id] ?? [],
                    optionId,
                  ),
                },
              }))
            }
            onCustom={(value) =>
              updateDraft((current) => updateCustomAnswer(current, question, value))
            }
            onRejectedInput={() => {
              if (mounted.current) parentChanged();
            }}
          />
          {canAttach ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                startIcon={<FilePlus />}
                className="self-start"
                disabled={held || files.length >= MAX_ATTACHMENTS}
                loading={readingAttachments}
                onClick={() => readAttachments(() => pickAttachments())}
              >
                {t("Attach files")}
              </Button>
              {files.length ? (
                <div className="flex flex-wrap gap-2" aria-label={t("Attachments")}>
                  <QuestionAttachmentList files={files} held={held} questionId={question.id} update={updateDraft} busy={setReadingAttachments} error={setAttachmentError} flight={attachmentFlight} />
                </div>
              ) : null}
            </div>
          ) : null}
          <QuestionAttachmentError message={attachmentError} blocked={recovery.blocked} retry={recovery.retry} />
        </fieldset>
        <div className={styles.footer}>
          <div className={styles.feedback}>
            {parentClosed ? (
              <LiveText text={t("Preparing session checkpoint. Your draft is kept.")} />
            ) : null}
            {capacityMessage ? <InlineError>{capacityMessage}</InlineError> : null}
            <p
              role={failed || uncertain ? "alert" : "status"}
              className={styles.status}
              id={statusId}
              data-error={failed ? "true" : undefined}
            >
              <StatusIcon className="icon-sm shrink-0" />
              <span>{status}</span>
            </p>
            {prompt.autoResolveAt != null && !transportHeld ? (
              <span
                className="text-ui-caption text-(--ui-text-secondary) tabular-nums"
                title={t("Interact to keep this question open.")}
              >
                {prompt.autoResolveAt - now > 60_000
                  ? t("Optional question")
                  : t("Continues without an answer in {p0}s", {
                      p0: Math.max(0, Math.ceil((prompt.autoResolveAt - now) / 1000)),
                    })}
              </span>
            ) : null}
          </div>
          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={held}
              loading={dismissing}
              loadingLabel={pendingLabel}
              startIcon={<DismissIcon />}
              reserveLabels={[prompt.dismissAction === "cancel" ? t("Cancelling…") : t("Sending…")]}
              aria-describedby={held ? statusId : undefined}
              onClick={skipCurrent}
            >
              {dismissing
                ? pendingLabel
                : prompt.dismissAction === "cancel"
                  ? t("Cancel question")
                  : prompt.dismissAction === "decline"
                    ? t("Decline")
                    : (dismissLabel ?? t("Skip"))}
            </Button>
            {index > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="shrink-0"
                disabled={held}
                startIcon={<ChevronLeft />}
                onClick={() => updateDraft((current) => ({ ...current, step: index - 1 }))}
              >
                {t("Back")}
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!ready || held}
              loading={sending && !dismissing}
              loadingLabel={pendingLabel}
              startIcon={<SubmitIcon />}
              reserveLabels={[t("Sending answer…"), t("Send again"), t("Connection issue")]}
              aria-describedby={statusId}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
