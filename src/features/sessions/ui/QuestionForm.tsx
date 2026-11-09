import { QuestionFields, updateCustomAnswer, nextSelection } from "./QuestionFields";
import { useQuestionFormDraft } from "./useQuestionFormDraft";
import { useQuestionAttachmentRecovery } from "./useQuestionAttachmentRecovery";
import { useQuestionAttachmentReader } from "./useQuestionAttachmentReader";
import { questionFormPresentation } from "./questionFormPresentation";
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
} from "../model/attachments";
import { questionTransportHeld, runQuestionAttachmentEffect } from "../model/questionAttachments";
import { useT } from "../../../shared/i18n";
import { usePresentationVisible } from "./presentationVisibility";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { ChevronLeft, FilePlus, MessageSquare } from "../../../shared/ui/icons";
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
  const recovery = useQuestionAttachmentRecovery(
    draft,
    readingAttachments,
    updateDraft,
    setAttachmentError,
    sessionId,
    questionDraftKey(draftScope, prompt),
    prompt,
    setReadingAttachments,
  );
  const sending = submitting || prompt.delivery === "sending";
  const transportHeld = questionTransportHeld(
    parentClosed,
    sending,
    localUnknown || draft.delivery === "unknown",
    prompt.delivery,
  );
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
  const readAttachments = useQuestionAttachmentReader({
    canAttach,
    held,
    interact,
    attachmentFlight,
    setReadingAttachments,
    setAttachmentError,
    parentChanged,
    draftRef,
    mounted,
    reservation,
    updateDraft,
    sessionId,
    draftScope,
    prompt,
    question,
    t,
  });
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
    ? !Object.values(draft.attachments ?? {})
        .flat()
        .some((file) => file.missing) &&
      (questionIsComplete(question, answers, custom) || (canAttach && files.length > 0))
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
    runQuestionAttachmentEffect(
      all,
      reply.kind === "answered" ? "retain" : "release",
      () => sendNow(reply, action),
      setReadingAttachments,
      setAttachmentError,
      attachmentFlight,
    );
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
    if (
      dismissEntirePrompt ||
      prompt.dismissAction === "cancel" ||
      prompt.dismissAction === "decline"
    ) {
      skipNow();
      return;
    }
    runQuestionAttachmentEffect(
      files,
      "release",
      skipNow,
      setReadingAttachments,
      setAttachmentError,
      attachmentFlight,
    );
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
  const {
    uncertain,
    capacityMessage,
    failed,
    dismissing,
    pendingLabel,
    status,
    StatusIcon,
    SubmitIcon,
    submitLabel,
  } = questionFormPresentation({
    t,
    prompt,
    sending,
    localUnknown,
    draftDelivery: draft.delivery,
    pendingAction: draft.pendingAction,
    capacityIssue,
    last,
  });

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
        {/* Without a separate heading the question itself sits beside the icon; the field
            legend still names the group for assistive technology. */}
        <div className={styles.context} data-prompt={title ? undefined : ""}>
          <MessageSquare className="icon-sm shrink-0" aria-hidden />
          {title ? (
            <span className={styles.contextTitle}>{title}</span>
          ) : (
            <span className={styles.contextPrompt} aria-hidden>
              {question.prompt}
            </span>
          )}
          {total > 1 ? (
            <LiveText className={styles.progress} text={`${index + 1} / ${total}`} />
          ) : null}
        </div>
        <fieldset
          className={styles.body}
          data-inline-prompt={title ? undefined : ""}
          disabled={sending}
        >
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
          {canAttach && files.length ? (
            <div className={styles.attachments} aria-label={t("Attachments")}>
              <QuestionAttachmentList
                files={files}
                held={held}
                questionId={question.id}
                update={updateDraft}
                busy={setReadingAttachments}
                error={setAttachmentError}
                flight={attachmentFlight}
              />
            </div>
          ) : null}
          <QuestionAttachmentError
            message={attachmentError}
            blocked={recovery.blocked}
            retry={recovery.retry}
          />
        </fieldset>
        <div className={styles.footer}>
          {canAttach ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              iconOnly
              label={t("Attach files")}
              startIcon={<FilePlus />}
              disabled={held || files.length >= MAX_ATTACHMENTS}
              loading={readingAttachments}
              onClick={() => readAttachments(() => pickAttachments())}
            />
          ) : null}
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
              {StatusIcon ? <StatusIcon className="icon-sm shrink-0" aria-hidden /> : null}
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
