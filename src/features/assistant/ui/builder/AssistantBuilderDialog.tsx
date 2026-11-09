import { useState } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { canRunHarnessTextPrompt } from "../../../../integrations/harness";
import {
  defaultTextActionChoice,
  type TranslationChoice,
} from "../../../sessions/public/translationPreferences";
import { BuilderInterview } from "./BuilderInterview";
import { BuilderModelStep } from "./BuilderModelStep";
import { BuilderPreview } from "./BuilderPreview";
import { useAssistantInterview } from "./useAssistantInterview";

type Stage = "model" | "interview";

/**
 * "Create with AI": choose a text model, answer its interview questions, review the proposed
 * profile and apply it. Applying merges into the caller's draft only (`onApply`); it never saves,
 * so the normal Save or Next stays the one place the owner confirms.
 */
export function AssistantBuilderDialog({
  current,
  onApply,
  onClose,
}: {
  /** The caller's draft now: the model skips what is decided and the preview compares against it. */
  current: AssistantProfilePatch;
  onApply: (patch: AssistantProfilePatch) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<TranslationChoice>(defaultTextActionChoice);
  const [stage, setStage] = useState<Stage>("model");
  /** The typed, unsent answer; kept across Back so it is never lost. */
  const [answer, setAnswer] = useState("");
  const interview = useAssistantInterview(choice, current);
  const available = canRunHarnessTextPrompt(choice.harness);
  const { proposal } = interview;

  function close() {
    interview.cancel();
    onClose();
  }
  function start() {
    setStage("interview");
    if (interview.transcript.length === 0) interview.begin();
  }
  function finish() {
    const text = answer.trim();
    setAnswer("");
    interview.finish(text);
  }

  const title = proposal ? t("Review your assistant") : t("Create with AI");
  return (
    <Modal
      title={title}
      onClose={close}
      size="md"
      fitViewport
      initialFocus={stage === "interview" && !proposal ? "input, textarea" : undefined}
      footer={
        proposal ? undefined : stage === "model" ? (
          <ModalActions>
            <Button variant="ghost" type="button" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!available}
              disabledReason={
                available
                  ? undefined
                  : t("Choose a model that supports text actions to create an assistant.")
              }
              onClick={start}
            >
              {interview.transcript.length > 0 ? t("Continue") : t("Start")}
            </Button>
          </ModalActions>
        ) : (
          <ModalActions>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                interview.cancel();
                setStage("model");
              }}
            >
              {t("Back")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={interview.busy}
              loadingLabel={t("Working…")}
              onClick={finish}
            >
              {t("Finish and show preview")}
            </Button>
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
      ) : stage === "model" ? (
        <BuilderModelStep choice={choice} onChange={setChoice} />
      ) : (
        <BuilderInterview
          transcript={interview.transcript}
          options={interview.options}
          busy={interview.busy}
          failure={interview.failure}
          draft={answer}
          onDraftChange={setAnswer}
          onAnswer={interview.answer}
          onRetry={interview.retry}
        />
      )}
    </Modal>
  );
}
