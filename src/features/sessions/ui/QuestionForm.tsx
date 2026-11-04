import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Checkbox } from "../../../shared/ui/Checkbox";
import styles from "./QuestionForm.module.css";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { LiveText } from "../../../shared/ui/LiveText";
import { AttachmentChip } from "./AttachmentChip";
import { useComposerFileDrop } from "./useComposerFileDrop";
import { useAttachmentSink } from "./useComposerAttachments";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  pickAttachments,
  MAX_ATTACHMENTS,
  revokeAttachment,
} from "../model/attachments";
import { prepareQuestionAttachments } from "../model/questionAttachments";
import type { Attachment } from "../model/session";
import { t, useT } from "../../../shared/i18n";
import { usePresentationVisible } from "./presentationVisibility";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import {
  questionDraftKey,
  readQuestionDraft,
  reserveQuestionDraft,
  subscribeQuestionDraftCapacity,
  getQuestionDraftCapacitySnapshot,
  type QuestionDraft,
  type QuestionDraftFailure,
  type QuestionDraftReservation,
} from "../model/questionDrafts";
import {
  CUSTOM_OPTION_ID,
  buildQuestionReply,
  isOtherOption,
  questionIsComplete,
  type UserQuestion,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../model/userQuestion";
import { useParentInputClosure, useParentInputsClosed } from "../data/parentInputClosure";

type Props = {
  prompt: UserQuestionPrompt;
  /** Session identity; unfinished answers stay separate across sessions. */
  draftScope?: string;
  /** Actual logical root; draftScope may instead be a remote cache namespace. */
  parentSessionId?: string;
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
  dismissLabel,
  dismissEntirePrompt,
  attachmentsSupported = true,
  remote = false,
  onReply,
  onInteraction,
}: Props) {
  const t = useT();
  const parentScope = parentSessionId ? undefined : "profile";
  const parentClosed = useParentInputsClosed(parentSessionId, parentScope);
  const capacityEpoch = useSyncExternalStore(
    subscribeQuestionDraftCapacity,
    getQuestionDraftCapacitySnapshot,
    getQuestionDraftCapacitySnapshot,
  );
  const reservation = useRef<QuestionDraftReservation | undefined>(undefined);
  const privateMountOwner = useRef({});
  const everReserved = useRef(false);
  const mounted = useRef(false);
  const [reserved, setReserved] = useState(false);
  const [capacityIssue, setCapacityIssue] = useState<QuestionDraftFailure | undefined>(undefined);
  const statusId = useId();
  const [draft, setDraft] = useState<QuestionDraft>(
    () =>
      readQuestionDraft(draftScope, prompt) ?? {
        step: 0,
        answers: {},
        custom: {},
      },
  );
  const { step, answers, custom } = draft;
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const submitted = useRef(!!draft.delivery);
  const [submitting, setSubmitting] = useState(draft.delivery === "sending");
  const [localUnknown, setLocalUnknown] = useState(draft.delivery === "unknown");
  const [now, setNow] = useState(Date.now);
  const visible = usePresentationVisible();
  const form = useRef<HTMLFormElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const attachmentFlight = useRef(false);
  const parentChanged = useParentInputClosure(
    {
      kind: "question-draft",
      sessionId: parentSessionId,
      scope: parentScope,
      snapshot: () => ({
        source: "mounted-question-form",
        draftScope,
        questionKey: questionDraftKey(draftScope, prompt),
        prompt,
        draft: draftRef.current,
        submitted: submitted.current,
        submitting,
        localUnknown,
        customInputs: Array.from(
          form.current?.querySelectorAll("textarea") ?? [],
          (field) => field.value,
        ),
        optionInputs: Array.from(
          form.current?.querySelectorAll<HTMLInputElement>("input") ?? [],
          (field) => ({ value: field.value, checked: field.checked }),
        ),
      }),
    },
    form,
  );
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reservation.current?.release();
      reservation.current = undefined;
      everReserved.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const current = reservation.current;
    if (current) {
      if (!current.current()) {
        setReserved(false);
        setCapacityIssue("retired");
        return;
      }
      const refreshed = current.refresh(prompt);
      if (!refreshed.ok) {
        setReserved(false);
        setCapacityIssue(refreshed.reason);
        return;
      }
      setReserved(true);
      return;
    }
    if (everReserved.current) return;
    const result = reserveQuestionDraft(
      draftScope,
      prompt,
      parentSessionId,
      privateMountOwner.current,
    );
    if (!result.ok) {
      setReserved(false);
      setCapacityIssue(result.reason);
      return;
    }
    reservation.current = result.value;
    everReserved.current = true;
    const retained = result.value.read();
    if (retained) {
      draftRef.current = retained;
      setDraft(retained);
      submitted.current = !!retained.delivery;
      setSubmitting(retained.delivery === "sending");
      setLocalUnknown(retained.delivery === "unknown");
    }
    setReserved(true);
    setCapacityIssue(undefined);
  }, [draftScope, prompt, parentSessionId, capacityEpoch]);
  const sending = submitting || prompt.delivery === "sending";
  const transportHeld =
    parentClosed ||
    sending ||
    localUnknown ||
    prompt.delivery === "unknown" ||
    prompt.delivery === "queued";
  const held = transportHeld || !reserved || readingAttachments;

  const persistDraft = (next: QuestionDraft, external = false) => {
    const result = reservation.current?.write(next, external);
    if (!result?.ok) {
      if (mounted.current) setCapacityIssue(result?.reason ?? "retired");
      return false;
    }
    draftRef.current = result.value;
    if (mounted.current) {
      setDraft(result.value);
      setCapacityIssue(undefined);
      parentChanged();
    }
    return true;
  };
  const updateDraft = (update: (current: QuestionDraft) => QuestionDraft) => {
    if (!mounted.current || !reservation.current?.current() || !parentChanged.canMutate())
      return false;
    return persistDraft(update(draftRef.current));
  };

  useEffect(() => {
    if (prompt.delivery === "failed") {
      const current = draftRef.current;
      if (
        current.delivery &&
        !persistDraft({ ...current, delivery: undefined, pendingAction: undefined }, true)
      )
        return;
      submitted.current = false;
      setSubmitting(false);
      setLocalUnknown(false);
    } else if (prompt.delivery === "unknown" || prompt.delivery === "queued") {
      setSubmitting(false);
    }
  }, [prompt, reserved]);

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
        const prepared = await prepareQuestionAttachments(incoming);
        admission.apply(() => {
          if (!mounted.current || !reservation.current?.current()) return;
          updateDraft((current) => ({
            ...current,
            attachments: {
              ...current.attachments,
              [question.id]: [...(current.attachments?.[question.id] ?? []), ...prepared],
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
    readDroppedAttachments: readAttachments,
    setPasteError: setAttachmentError,
  });
  const last = index >= total - 1;
  const ready = useMemo(
    () =>
      question
        ? questionIsComplete(question, answers, custom) || (canAttach && files.length > 0)
        : false,
    [answers, custom, question, canAttach, files.length],
  );

  const send = (
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
  const finish = (
    nextAnswers = answers,
    nextCustom = custom,
    pendingAction: QuestionDraft["pendingAction"] = "answer",
  ) =>
    send(
      buildQuestionReply(questions, nextAnswers, nextCustom, draftRef.current.attachments),
      pendingAction,
    );

  const skipCurrent = () => {
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
    if (last) {
      if (
        !updateDraft((current) => ({
          ...current,
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
      answers: nextAnswers,
      custom: nextCustom,
      attachments: nextAttachments,
      step: index + 1,
    }));
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
    !queued && (prompt.delivery === "unknown" || localUnknown || capacityIssue === "pending");
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
            const attached = await attachmentsFromFiles(pasted);
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
            onCustom={(value) => {
              return updateDraft((current) => {
                const selected = current.answers[question.id] ?? [];
                if (question.multiSelect) {
                  const without = selected.filter((id) => !isCustomId(question, id));
                  return {
                    ...current,
                    custom: { ...current.custom, [question.id]: value },
                    answers: {
                      ...current.answers,
                      [question.id]: [...without, customOptionId(question)],
                    },
                  };
                }
                return {
                  ...current,
                  custom: { ...current.custom, [question.id]: value },
                  answers: {
                    ...current.answers,
                    [question.id]: [customOptionId(question)],
                  },
                };
              });
            }}
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
                  {files.map((file) => (
                    <AttachmentChip
                      key={file.id}
                      attachment={file}
                      onRemove={
                        held
                          ? undefined
                          : () =>
                              updateDraft((current) => ({
                                ...current,
                                attachments: {
                                  ...current.attachments,
                                  [question.id]: (current.attachments?.[question.id] ?? []).filter(
                                    (item) => item.id !== file.id,
                                  ),
                                },
                              }))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {attachmentError ? <InlineError>{attachmentError}</InlineError> : null}
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

function QuestionFields({
  question,
  selected,
  custom,
  onSelect,
  onCustom,
  onRejectedInput,
  locked = false,
}: {
  question: UserQuestion;
  selected: string[];
  custom: string;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => boolean;
  onRejectedInput: () => void;
  locked?: boolean;
}) {
  const t = useT();
  const options = displayOptions(question);
  const customSelected = selected.some((id) => isCustomId(question, id));
  const [highlighted, setHighlighted] = useState(() => {
    const selectedIndex = options.findIndex((option) => selected.includes(option.id));
    return selectedIndex >= 0 ? selectedIndex : 0;
  });
  const fields = useRef<HTMLFieldSetElement | null>(null);
  const optionInputs = () =>
    Array.from(
      fields.current?.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"]',
      ) ?? [],
    );
  const customInput = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!customSelected || locked) return;
    customInput.current?.focus({ preventScroll: true });
    // Some engines (Linux WebKit) finish a label click by focusing its radio after the change
    // handlers ran; hand focus back once, but only from this question's own option inputs.
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && fields.current?.contains(active))
        customInput.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [customSelected, locked]);

  const highlight = (index: number) => {
    setHighlighted(index);
    optionInputs()[index]?.focus();
  };

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLFieldSetElement>, index: number) => {
    if (locked) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + offset + options.length) % options.length;
      highlight(next);
      if (!question.multiSelect) onSelect(options[next].id);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : options.length - 1;
      highlight(next);
      if (!question.multiSelect) onSelect(options[next].id);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(options[index].id);
      return;
    }

    const shortcut = Number(event.key);
    if (Number.isInteger(shortcut) && shortcut >= 1 && shortcut <= Math.min(options.length, 9)) {
      event.preventDefault();
      const shortcutIndex = shortcut - 1;
      highlight(shortcutIndex);
      onSelect(options[shortcutIndex].id);
    }
  };

  return (
    <fieldset
      className={styles.fields}
      ref={fields}
      onKeyDownCapture={(event) => {
        const index = optionInputs().indexOf(event.target as HTMLInputElement);
        if (index >= 0) onOptionKeyDown(event, index);
      }}
    >
      {question.multiSelect || options.length === 0 ? <legend>{question.prompt}</legend> : null}
      {question.multiSelect ? (
        <p className="[margin-block-start:0.5rem] text-ui-caption text-(--ui-text-secondary)">
          {t("Select all that apply")}
        </p>
      ) : null}
      {options.length === 0 && question.allowCustom ? (
        <TextareaField
          hideLabel
          label={t("Type your answer")}
          value={custom}
          rows={3}
          readOnly={locked}
          onChange={(event) => {
            if (!onCustom(event.currentTarget.value)) {
              event.currentTarget.value = custom;
              onRejectedInput();
            }
          }}
          placeholder={t("Type your answer")}
          fieldClassName={styles.answer}
        />
      ) : (
        <div className={styles.options} role="group" aria-label={question.prompt}>
          {!question.multiSelect ? (
            <RadioGroup
              compact
              className={styles.radio}
              label={question.prompt}
              name={question.id}
              value={selected[0] ?? ""}
              disabled={locked}
              options={options.map((option) => ({
                value: option.id,
                label: option.label,
                description: option.description,
              }))}
              onValueChange={onSelect}
            />
          ) : (
            options.map((option, optionIndex) => (
              <label key={option.id} className={styles.option}>
                <Checkbox
                  disabled={locked}
                  checked={selected.includes(option.id)}
                  aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                  tabIndex={highlighted === optionIndex ? 0 : -1}
                  onFocus={() => setHighlighted(optionIndex)}
                  onChange={() => onSelect(option.id)}
                />
                <span className={styles.copy}>
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </label>
            ))
          )}
        </div>
      )}
      {options.length > 0 && customSelected ? (
        <TextareaField
          hideLabel
          label={t("Type your answer")}
          ref={customInput}
          value={custom}
          rows={3}
          readOnly={locked}
          onChange={(event) => {
            if (!onCustom(event.currentTarget.value)) {
              event.currentTarget.value = custom;
              onRejectedInput();
            }
          }}
          aria-label={t("Type your answer")}
          placeholder={t("Type your answer")}
          fieldClassName={styles.answer}
        />
      ) : null}
    </fieldset>
  );
}

function displayOptions(question: UserQuestion): UserQuestion["options"] {
  if (question.options.length === 0) return question.options;
  if (question.options.some(isOtherOption) || !question.allowCustom) {
    return question.options;
  }
  return [
    ...question.options,
    {
      id: CUSTOM_OPTION_ID,
      get label() {
        return t("Other");
      },
    },
  ];
}

function customOptionId(question: UserQuestion): string {
  return question.options.find(isOtherOption)?.id ?? CUSTOM_OPTION_ID;
}

function isCustomId(question: UserQuestion, optionId: string): boolean {
  return optionId === CUSTOM_OPTION_ID || optionId === customOptionId(question);
}

function nextSelection(question: UserQuestion, current: string[], optionId: string): string[] {
  if (!question.multiSelect) return [optionId];
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  if (isCustomId(question, optionId)) {
    return [...current.filter((id) => !isCustomId(question, id)), optionId];
  }
  return [...current, optionId];
}
