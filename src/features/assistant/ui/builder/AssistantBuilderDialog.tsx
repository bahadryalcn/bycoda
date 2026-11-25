import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { LANGUAGES as APP_LANGUAGES } from "../../../../shared/i18n/languages";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { Check, Square, X } from "../../../../shared/ui/icons";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { Select } from "../../../../shared/ui/Select";
import { canRunHarnessTextPrompt } from "../../../../integrations/harness";
import {
  defaultTextActionChoice,
  type TranslationChoice,
} from "../../../sessions/public/translationPreferences";
import { BuilderInterview } from "./BuilderInterview";
import { BuilderModelStep } from "./BuilderModelStep";
import { BuilderPreview } from "./BuilderPreview";
import { useAssistantInterview } from "./useAssistantInterview";

/**
 * "Create with AI": choose a text model, answer its interview questions, review the proposed
 * profile and apply it. Applying merges into the caller's draft only (`onApply`); it never saves,
 * so the normal Save or Next stays the one place the owner confirms.
 */
export function AssistantBuilderDialog({
  current,
  initialAnswer = "",
  onApply,
  onClose,
}: {
  /** The caller's draft provides context and the preview compares against it. */
  current: AssistantProfilePatch;
  /** Text the answer box starts with; the owner still sends it. */
  initialAnswer?: string;
  onApply: (patch: AssistantProfilePatch) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<TranslationChoice>(defaultTextActionChoice);
  /** The typed, unsent answer; kept across Back so it is never lost. */
  const [answer, setAnswer] = useState(initialAnswer);
  const interview = useAssistantInterview(choice, current);
  const available = canRunHarnessTextPrompt(choice.harness);
  const { proposal } = interview;
  const canFinish =
    interview.transcript.some((turn) => turn.role === "owner") || Boolean(answer.trim());

  function close() {
    interview.cancel();
    onClose();
  }
  function finish() {
    if (!available || interview.busy || !canFinish) return;
    const text = answer.trim();
    setAnswer("");
    interview.finish(text);
  }

  const title = proposal ? t("Review your assistant") : t("Create with AI");
  return (
    <Modal
      title={title}
      onClose={close}
      size="lg"
      fitViewport
      initialFocus={!proposal ? "textarea" : undefined}
      footer={
        proposal ? undefined : (
          <ModalActions>
            <Button
              variant="ghost"
              type="button"
              startIcon={<X className="icon-sm" />}
              onClick={close}
            >
              {t("Cancel")}
            </Button>
            {interview.busy ? (
              <Button
                type="button"
                startIcon={<Square className="icon-sm" />}
                onClick={interview.cancel}
              >
                {t("Stop")}
              </Button>
            ) : (
              <Button
                variant="primary"
                type="button"
                startIcon={<Check className="icon-sm" />}
                disabled={!canFinish || !available || interview.failure !== null}
                onClick={finish}
              >
                {t("Preview assistant")}
              </Button>
            )}
          </ModalActions>
        )
      }
    >
      {proposal ? (
        <BuilderPreview
          proposal={proposal}
          current={current}
          onBack={interview.reopen}
          onApply={(patch) => {
            onApply(patch);
            onClose();
          }}
        />
      ) : (
        <>
          {!available && (
            <InlineMessage tone="warning">
              {t("This model cannot write text. Pick another one to continue.")}
            </InlineMessage>
          )}
          <BuilderInterview
            controls={
              <>
                <Select
                  label={t("Language")}
                  hideLabel
                  fieldSize="sm"
                  value={interview.language}
                  disabled={interview.busy}
                  onValueChange={interview.setLanguage}
                  options={APP_LANGUAGES.map(({ tag, label }) => ({ value: tag, label }))}
                />
                <BuilderModelStep
                  choice={choice}
                  onChange={(next) => {
                    interview.cancel();
                    setChoice(next);
                  }}
                />
              </>
            }
            transcript={interview.transcript}
            options={interview.options}
            busy={interview.busy}
            failure={interview.failure}
            draft={answer}
            onDraftChange={setAnswer}
            onAnswer={interview.answer}
            onRetry={interview.retry}
            disabled={!available}
          />
        </>
      )}
    </Modal>
  );
}
