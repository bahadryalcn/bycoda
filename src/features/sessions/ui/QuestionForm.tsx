import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import { usePresentationVisible } from "./presentationVisibility";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, MessageSquare } from "../../../shared/ui/icons";
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
  onReply: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction?: (requestId: number) => void;
};

export function QuestionForm({ prompt, onReply, onInteraction }: Props) {
  useLocale();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now);
  const visible = usePresentationVisible();

  useEffect(() => {
    if (prompt.autoResolveAt == null || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prompt.requestId, prompt.autoResolveAt, visible]);

  const interact = () => {
    if (prompt.autoResolveAt != null) onInteraction?.(prompt.requestId);
  };

  useEffect(() => {
    setStep(0);
    setAnswers({});
    setCustom({});
  }, [prompt.requestId]);

  const questions = prompt.questions;
  const total = questions.length;
  const index = Math.min(step, Math.max(total - 1, 0));
  const question = questions[index];
  const last = index >= total - 1;
  const ready = useMemo(
    () => (question ? questionIsComplete(question, answers, custom) : false),
    [answers, custom, question],
  );

  const finish = (nextAnswers = answers, nextCustom = custom) => {
    onReply(prompt.requestId, buildQuestionReply(questions, nextAnswers, nextCustom));
  };

  const skipCurrent = () => {
    if (!question) {
      finish();
      return;
    }
    const nextAnswers = { ...answers };
    const nextCustom = { ...custom };
    delete nextAnswers[question.id];
    delete nextCustom[question.id];
    if (last) {
      finish(nextAnswers, nextCustom);
      return;
    }
    setAnswers(nextAnswers);
    setCustom(nextCustom);
    setStep(index + 1);
  };

  const continueCurrent = () => {
    if (!question || !ready) return;
    if (last) {
      finish();
      return;
    }
    setStep(index + 1);
  };

  if (!question) return null;

  const heading = question.header?.trim() || prompt.title?.trim();
  // Providers may repeat the entire question as their header.
  const title = heading && heading !== question.prompt.trim() ? heading : t("Question");

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
        className="min-w-0 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface)"
        onSubmit={(event) => {
          event.preventDefault();
          continueCurrent();
        }}
      >
        <div className="flex items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2">
          <MessageSquare
            className="size-3.5 shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
          <span
            className="min-w-0 flex-1 truncate text-xs text-(--ui-text-secondary)"
            title={title}
          >
            {title}
          </span>
          {total > 1 ? (
            <span
              className="shrink-0 text-xs text-(--ui-text-secondary) tabular-nums"
              aria-live="polite"
            >
              {index + 1}
              {" / "}
              {total}
            </span>
          ) : null}
        </div>
        <div className="px-3 py-3">
          <QuestionFields
            key={question.id}
            question={question}
            selected={answers[question.id] ?? []}
            custom={custom[question.id] ?? ""}
            onSelect={(optionId) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: nextSelection(question, current[question.id] ?? [], optionId),
              }))
            }
            onCustom={(value) => {
              setCustom((current) => ({ ...current, [question.id]: value }));
              setAnswers((current) => {
                const selected = current[question.id] ?? [];
                if (question.multiSelect) {
                  const without = selected.filter((id) => !isCustomId(question, id));
                  return {
                    ...current,
                    [question.id]: [...without, customOptionId(question)],
                  };
                }
                return {
                  ...current,
                  [question.id]: [customOptionId(question)],
                };
              });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-(--ui-tone-neutral-border) px-3 py-2">
          {prompt.autoResolveAt != null ? (
            <span
              className="min-w-0 flex-1 text-xs text-(--ui-text-secondary) tabular-nums"
              title={t("Interact to keep this question open.")}
            >
              {prompt.autoResolveAt - now > 60_000
                ? t("Optional question")
                : t("Continues without an answer in {p0}s", {
                    p0: Math.max(0, Math.ceil((prompt.autoResolveAt - now) / 1000)),
                  })}
            </span>
          ) : null}
          <Button variant="ghost" type="button" onClick={skipCurrent}>
            {t("Skip")}
          </Button>
          {index > 0 ? (
            <Button
              variant="ghost"
              type="button"
              className="shrink-0"
              onClick={() => setStep(index - 1)}
            >
              {t("Back")}
            </Button>
          ) : null}
          <Button variant="primary" type="submit" disabled={!ready}>
            {t("Continue")}
          </Button>
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
}: {
  question: UserQuestion;
  selected: string[];
  custom: string;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => void;
}) {
  useLocale();
  const options = displayOptions(question);
  const customSelected = selected.some((id) => isCustomId(question, id));
  const [highlighted, setHighlighted] = useState(() => {
    const selectedIndex = options.findIndex((option) => selected.includes(option.id));
    return selectedIndex >= 0 ? selectedIndex : 0;
  });
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const customInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (customSelected) customInput.current?.focus({ preventScroll: true });
  }, [customSelected]);

  const highlight = (index: number) => {
    setHighlighted(index);
    optionButtons.current[index]?.focus();
  };

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      highlight((index + offset + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : options.length - 1);
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
    <fieldset className="min-w-0">
      <legend className="w-full text-sm font-medium leading-snug wrap-anywhere text-(--ui-tone-neutral-fg)">
        {question.prompt}
      </legend>
      {question.multiSelect ? (
        <p className="[margin-block-start:0.5rem] text-xs text-(--ui-text-secondary)">
          {t("Select all that apply")}
        </p>
      ) : null}
      {options.length === 0 && question.allowCustom ? (
        <TextField
          hideLabel
          label={t("Type your answer")}
          value={custom}
          onChange={(event) => onCustom(event.target.value)}
          placeholder={t("Type your answer")}
          fieldClassName="[margin-block-start:0.75rem] w-full"
        />
      ) : (
        <div
          className="[margin-block-start:0.75rem] flex max-h-52 flex-col gap-1 overflow-y-auto overscroll-contain"
          role="group"
          aria-label={question.prompt}
        >
          {options.map((option, optionIndex) => {
            const active = selected.includes(option.id);
            return (
              <Button
                key={option.id}
                className="w-full text-start"
                fullWidth
                layout="stacked"
                selected={active}
                variant="item"
                ref={(button) => {
                  optionButtons.current[optionIndex] = button;
                }}
                type="button"
                aria-pressed={active}
                aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                data-highlighted={highlighted === optionIndex ? "true" : undefined}
                tabIndex={highlighted === optionIndex ? 0 : -1}
                onFocus={() => setHighlighted(optionIndex)}
                onKeyDown={(event) => onOptionKeyDown(event, optionIndex)}
                onClick={() => {
                  setHighlighted(optionIndex);
                  onSelect(option.id);
                }}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden
                    className={`[margin-block-start:0.125rem] inline-flex size-4 shrink-0 items-center justify-center border border-(--ui-tone-neutral-border) ${question.multiSelect ? "rounded-sm" : "rounded-full"}`}
                  >
                    {active ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug wrap-anywhere text-(--ui-tone-neutral-fg)">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="[margin-block-start:0.25rem] block text-xs leading-snug wrap-anywhere text-(--ui-text-secondary)">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      )}
      {options.length > 0 && customSelected ? (
        <TextField
          hideLabel
          label={t("Type your answer")}
          ref={customInput}
          value={custom}
          onChange={(event) => onCustom(event.target.value)}
          aria-label={t("Type your answer")}
          placeholder={t("Type your answer")}
          fieldClassName="[margin-block-start:0.75rem] w-full"
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
