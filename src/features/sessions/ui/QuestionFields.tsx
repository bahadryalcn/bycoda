import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Plus } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { CUSTOM_OPTION_ID, isOtherOption, type UserQuestion } from "../model/userQuestion";
import styles from "./QuestionForm.module.css";
import type { QuestionDraft } from "../model/questionDrafts";

export function updateCustomAnswer(
  current: QuestionDraft,
  question: UserQuestion,
  value: string,
): QuestionDraft {
  const selected = current.answers[question.id] ?? [];
  return {
    ...current,
    custom: { ...current.custom, [question.id]: value },
    answers: {
      ...current.answers,
      [question.id]: question.multiSelect
        ? [...selected.filter((id) => !isCustomId(question, id)), customOptionId(question)]
        : [customOptionId(question)],
    },
  };
}
export function QuestionFields({
  question,
  selected,
  custom,
  note,
  onNote,
  onSelect,
  onCustom,
  onRejectedInput,
  locked = false,
}: {
  question: UserQuestion;
  selected: string[];
  custom: string;
  note: string;
  onNote: (value: string) => boolean;
  onSelect: (optionId: string) => void;
  onCustom: (value: string) => boolean;
  onRejectedInput: () => void;
  locked?: boolean;
}) {
  const t = useT();
  const options = displayOptions(question, t("Other"));
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
  const noteInput = useRef<HTMLTextAreaElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(() => note.trim() !== "");
  const focusNote = useRef(false);
  useEffect(() => {
    if (!noteOpen || !focusNote.current) return;
    focusNote.current = false;
    noteInput.current?.focus({ preventScroll: true });
  }, [noteOpen]);

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
    <FieldGroup
      variant="bare"
      legend={question.multiSelect || options.length === 0 ? question.prompt : undefined}
      className={styles.fields}
      ref={fields}
      onKeyDownCapture={(event) => {
        const index = optionInputs().indexOf(event.target as HTMLInputElement);
        if (index >= 0) onOptionKeyDown(event, index);
      }}
    >
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
        // The radio group or the field legend already names this set with the prompt.
        <div className={styles.options}>
          {!question.multiSelect ? (
            <RadioGroup
              variant="list"
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
              <Checkbox
                key={option.id}
                className={styles.option}
                disabled={locked}
                checked={selected.includes(option.id)}
                aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                tabIndex={highlighted === optionIndex ? 0 : -1}
                onFocus={() => setHighlighted(optionIndex)}
                onChange={() => onSelect(option.id)}
                label={
                  <span className={styles.copy}>
                    <span>{option.label}</span>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                }
              />
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
      {options.length > 0 &&
      selected.some((id) => !isCustomId(question, id)) &&
      question.allowCustom &&
      !question.preserveCustomWhitespace ? (
        noteOpen ? (
          <TextareaField
            label={t("Additional note (optional)")}
            ref={noteInput}
            value={note}
            rows={2}
            readOnly={locked}
            onChange={(event) => {
              if (!onNote(event.currentTarget.value)) {
                event.currentTarget.value = note;
                onRejectedInput();
              }
            }}
            fieldClassName={styles.answer}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className={styles.addNote}
            startIcon={<Plus />}
            disabled={locked}
            onClick={() => {
              focusNote.current = true;
              setNoteOpen(true);
            }}
          >
            {t("Add a note")}
          </Button>
        )
      ) : null}
    </FieldGroup>
  );
}

function displayOptions(question: UserQuestion, otherLabel: string): UserQuestion["options"] {
  if (question.options.length === 0) return question.options;
  if (question.options.some(isOtherOption) || !question.allowCustom) {
    return question.options;
  }
  return [
    ...question.options,
    {
      id: CUSTOM_OPTION_ID,
      label: otherLabel,
    },
  ];
}

export function customOptionId(question: UserQuestion): string {
  return question.options.find(isOtherOption)?.id ?? CUSTOM_OPTION_ID;
}

export function isCustomId(question: UserQuestion, optionId: string): boolean {
  return optionId === CUSTOM_OPTION_ID || optionId === customOptionId(question);
}

export function nextSelection(
  question: UserQuestion,
  current: string[],
  optionId: string,
): string[] {
  if (!question.multiSelect) return [optionId];
  if (current.includes(optionId)) {
    return current.filter((id) => id !== optionId);
  }
  if (isCustomId(question, optionId)) {
    return [...current.filter((id) => !isCustomId(question, id)), optionId];
  }
  return [...current, optionId];
}
