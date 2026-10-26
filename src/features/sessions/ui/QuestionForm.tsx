import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Checkbox } from "../../../shared/ui/Checkbox";
import styles from "./QuestionForm.module.css";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useT } from "../../../shared/i18n";
import { usePresentationVisible } from "./presentationVisibility";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
  RefreshCw,
  X,
} from "../../../shared/ui/icons";
import {
  questionDraftKey,
  readQuestionDraft,
  writeQuestionDraft,
  type QuestionDraft,
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

type Props = {
  prompt: UserQuestionPrompt;
  /** Session identity; unfinished answers stay separate across sessions. */
  draftScope?: string;
  onReply: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction?: (requestId: number) => void;
};

export function QuestionForm(props: Props) {
  return <QuestionFormContent key={questionDraftKey(props.draftScope, props.prompt)} {...props} />;
}

function QuestionFormContent({ prompt, draftScope, onReply, onInteraction }: Props) {
  const t = useT();
  const statusId = useId();
  const [draft, setDraft] = useState<QuestionDraft>(
    () => readQuestionDraft(draftScope, prompt) ?? { step: 0, answers: {}, custom: {} },
  );
  const { step, answers, custom } = draft;
  const submitted = useRef(!!draft.delivery);
  const [submitting, setSubmitting] = useState(draft.delivery === "sending");
  const [localUnknown, setLocalUnknown] = useState(draft.delivery === "unknown");
  const [now, setNow] = useState(Date.now);
  const visible = usePresentationVisible();
  const sending = submitting || prompt.delivery === "sending";
  const held =
    sending || localUnknown || prompt.delivery === "unknown" || prompt.delivery === "queued";

  const updateDraft = (update: (current: QuestionDraft) => QuestionDraft) => {
    setDraft((current) => {
      const next = update(current);
      writeQuestionDraft(draftScope, prompt, next);
      return next;
    });
  };

  useEffect(() => {
    if (prompt.delivery === "failed") {
      submitted.current = false;
      setSubmitting(false);
      setLocalUnknown(false);
      setDraft((current) => {
        if (!current.delivery) return current;
        const next = { ...current, delivery: undefined, pendingAction: undefined };
        writeQuestionDraft(draftScope, prompt, next);
        return next;
      });
    } else if (prompt.delivery === "unknown" || prompt.delivery === "queued") {
      setSubmitting(false);
    }
  }, [prompt]);

  useEffect(() => {
    if (prompt.autoResolveAt == null || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prompt.requestId, prompt.autoResolveAt, visible]);

  const interact = () => {
    if (prompt.autoResolveAt != null) onInteraction?.(prompt.requestId);
  };

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const last = index >= total - 1;
  const ready = useMemo(
    () => (question ? questionIsComplete(question, answers, custom) : false),
    [answers, custom, question],
  );

  const send = (
    reply: UserQuestionReply,
    pendingAction: QuestionDraft["pendingAction"] = "answer",
  ) => {
    if (submitted.current || held) return;
    submitted.current = true;
    setSubmitting(true);
    setLocalUnknown(false);
    updateDraft((current) => ({ ...current, delivery: "sending", pendingAction }));
    try {
      onReply(prompt.requestId, reply);
    } catch {
      setSubmitting(false);
      // A callback can throw after dispatch. Only an authoritative failed
      // transport update can establish that sending again is safe.
      setLocalUnknown(true);
      updateDraft((current) => ({ ...current, delivery: "unknown" }));
    }
  };
  const finish = (
    nextAnswers = answers,
    nextCustom = custom,
    pendingAction: QuestionDraft["pendingAction"] = "answer",
  ) => send(buildQuestionReply(questions, nextAnswers, nextCustom), pendingAction);

  const skipCurrent = () => {
    if (held || submitted.current) return;
    if (prompt.dismissAction === "cancel" || prompt.dismissAction === "decline") {
      send({ kind: "skipped" }, "dismiss");
      return;
    }
    if (!question) {
      finish(answers, custom, "dismiss");
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    if (last) {
      updateDraft((current) => ({ ...current, answers: nextAnswers, custom: nextCustom }));
      finish(nextAnswers, nextCustom, "dismiss");
      return;
    }
    updateDraft(() => ({ answers: nextAnswers, custom: nextCustom, step: index + 1 }));
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
  const uncertain = !queued && (prompt.delivery === "unknown" || localUnknown);
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
        className={`bycoda-arc ${styles.form}`}
        aria-label={t("Question")}
        aria-busy={sending}
        onSubmit={(event) => {
          event.preventDefault();
          continueCurrent();
        }}
      >
        {title || total > 1 ? (
          <div className={styles.context}>
            <MessageSquare
              className="size-3.5 shrink-0 text-(--ui-text-secondary)"
              strokeWidth={1.75}
            />
            {title ? (
              <span className={styles.contextTitle}>{title}</span>
            ) : (
              <span className="sr-only">{t("Question")}</span>
            )}
            {total > 1 ? (
              <span className={styles.progress} aria-live="polite">
                {index + 1}
                {" / "}
                {total}
              </span>
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
              updateDraft((current) => {
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
                  answers: { ...current.answers, [question.id]: [customOptionId(question)] },
                };
              });
            }}
          />
        </fieldset>
        <div className={styles.footer}>
          <div className={styles.feedback}>
            <p
              role={
                failed || uncertain
                  ? "alert"
                  : "status"
              }
              className={styles.status}
              id={statusId}
              data-error={failed ? "true" : undefined}
            >
              <StatusIcon className="size-3.5 shrink-0" />
              <span>{status}</span>
            </p>
            {prompt.autoResolveAt != null && !held ? (
              <span
                className="text-xs text-(--ui-text-secondary) tabular-nums"
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
              aria-describedby={held ? statusId : undefined}
              onClick={skipCurrent}
            >
              {dismissing
                ? pendingLabel
                : prompt.dismissAction === "cancel"
                  ? t("Cancel question")
                  : prompt.dismissAction === "decline"
                    ? t("Decline")
                    : t("Skip")}
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
  locked = false,
}: {
  question: UserQuestion;
  selected: string[];
  custom: string;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => void;
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
    if (customSelected && !locked) customInput.current?.focus({ preventScroll: true });
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
        <p className="[margin-block-start:0.5rem] text-xs text-(--ui-text-secondary)">
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
          onChange={(event) => onCustom(event.target.value)}
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
          onChange={(event) => onCustom(event.target.value)}
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
