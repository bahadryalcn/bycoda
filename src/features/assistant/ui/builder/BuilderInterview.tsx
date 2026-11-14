import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantBuilderTurn } from "../../../../shared/model/host-contracts/assistant-builder";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { PromptField } from "../../../../shared/ui/PromptField";
import { ArrowUp } from "../../../../shared/ui/icons";
import { BUILDER_MAX_TURN_TEXT } from "../../model/assistantBuilder";
import styles from "./AssistantBuilder.module.css";

/** Signed-out providers fail with an authentication message; name the fix next to it. */
const SIGNED_OUT = /authenticat|log ?in|credential|expired|unauthori/i;

/**
 * Chat-like interview: the model's questions and the owner's answers as bubbles, quick-answer
 * chips and a free-text field. The typed answer is a draft owned here; the transcript is the
 * caller's, so it survives Back to the model step.
 */
export function BuilderInterview({
  transcript,
  options,
  busy,
  failure,
  onAnswer,
  onRetry,
  draft,
  onDraftChange,
  disabled = false,
  controls,
}: {
  transcript: readonly AssistantBuilderTurn[];
  options: readonly string[];
  busy: boolean;
  failure: string | null;
  onAnswer: (text: string) => void;
  onRetry: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
  disabled?: boolean;
  controls?: ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  // New interview turns and request outcomes keep the active question in view.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [transcript.length, busy, failure]);
  const text = draft.trim();
  const send = (answer: string) => {
    if (!answer || busy || disabled) return;
    onDraftChange("");
    onAnswer(answer);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      send(text);
    }
  };
  return (
    <Text as="div" size="inherit" tone="inherit" leading="normal" className={styles.stage}>
      {controls && <div className={styles.interviewControls}>{controls}</div>}
      <div className={styles.chat} role="log" aria-label={t("Interview")}>
        {transcript.map((turn, index) => (
          <Text
            as="p"
            size="body"
            tone="inherit"
            leading="normal"
            key={index}
            {...surfaceAttributes(
              {
                radius: "card",
                variant: turn.role === "owner" ? "selected" : "transparent",
              },
              styles.bubble,
            )}
            data-role={turn.role}
          >
            {turn.text}
          </Text>
        ))}
        {busy ? <LoadingText>{t("Thinking…")}</LoadingText> : null}
        <div ref={end} />
      </div>
      {failure !== null ? (
        <InlineError retry={{ onRetry }}>
          {[
            t("The interview failed."),
            failure,
            SIGNED_OUT.test(failure)
              ? t("Pick a signed-in account in the model picker, or sign in to the provider again.")
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        </InlineError>
      ) : null}
      {options.length > 0 && !busy ? (
        <div className={styles.options} role="group" aria-label={t("Quick answers")}>
          {options.map((option) => (
            <Button
              key={option}
              size="sm"
              type="button"
              tooltip={option}
              tooltipWhen="overflow"
              tooltipWide
              disabled={disabled}
              onClick={() => send(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <PromptField
        label={t("Your answer")}
        autoFocus
        quiet
        minRows={2}
        maxRows={6}
        value={draft}
        maxLength={BUILDER_MAX_TURN_TEXT}
        placeholder={t("Type your answer")}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        toolbarTrailing={
          <Button
            type="button"
            variant="primary"
            iconOnly
            label={t("Send answer")}
            startIcon={<ArrowUp className="icon-sm" />}
            disabled={!text || busy || disabled}
            onClick={() => send(text)}
          />
        }
      />
    </Text>
  );
}
