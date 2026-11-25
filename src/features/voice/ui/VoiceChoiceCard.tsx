import { useEffect, useRef, useLayoutEffect, useMemo, useState } from "react";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { VoiceChoice } from "../model/voiceChoices";
import {
  AssistantOwnerQuestionDraft,
  ownerQuestionError,
} from "../../assistant/model/assistantOwnerQuestions";
import {
  readQuestionDraft,
  writeQuestionDraft,
  subscribeQuestionDraftCapacity,
} from "../../sessions/model/questionDrafts";
import { t } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";

/** The owner-question helper returns English keys for two known failures; present others as given. */
function draftMessage(message: string) {
  if (message === "Keep custom answers within 2,000 characters.")
    return t("Keep custom answers within 2,000 characters.");
  if (message === "The question data could not be verified. Refresh its original Host.")
    return t("The question data could not be verified. Refresh its original Host.");
  return message;
}

/** Choice keyboard handling is confined to this card, including Escape. */
export function VoiceChoiceCard({
  choice,
  onReply,
  onRetry,
}: {
  choice: VoiceChoice;
  onReply: (reply: UserQuestionReply) => void;
  onRetry?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [epoch, setEpoch] = useState(0),
    [draftError, setDraftError] = useState("");
  const restored = useMemo(() => {
    try {
      return {
        owner: choice.ownerQuestion
          ? new AssistantOwnerQuestionDraft(
              choice.ownerQuestion.question,
              choice.ownerQuestion.environmentId,
              localStorage,
              () => crypto.randomUUID(),
              () => true,
            )
          : undefined,
      };
    } catch (cause) {
      return { error: ownerQuestionError(cause) };
    }
  }, [choice.id, choice.ownerQuestion, epoch]);
  const owner = restored.owner;
  useLayoutEffect(() => {
    setDraftError("");
    if (!owner) return;
    if (!writeQuestionDraft(owner.scope, choice.prompt, owner.formDraft, true).ok) {
      setDraftError(
        t("This question draft could not be restored. Keep the original card and retry."),
      );
      return;
    }
    return subscribeQuestionDraftCapacity(() => {
      const draft = readQuestionDraft(owner.scope, choice.prompt);
      if (draft)
        try {
          owner.saveDraft(draft);
        } catch (cause) {
          setDraftError(ownerQuestionError(cause));
        }
    });
  }, [owner, choice.prompt]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [choice.id]);
  if (restored.error || draftError)
    return (
      <div ref={root}>
        <InlineError retry={{ onRetry: () => setEpoch((value) => value + 1), label: t("Retry") }}>
          {draftMessage(restored.error ?? draftError)}
        </InlineError>
      </div>
    );
  return (
    <div
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!choice.presentationPending) onReply({ kind: "skipped" });
        }
      }}
    >
      <QuestionForm
        attachmentsSupported={false}
        prompt={choice.prompt}
        draftScope={owner?.scope ?? `voice-choice:${choice.id}`}
        {...(owner ? { dismissLabel: t("Later"), dismissEntirePrompt: true } : {})}
        onReply={(_id, reply) => onReply(reply)}
      />
      {onRetry &&
      (choice.presentationPending || choice.ownerQuestion) &&
      choice.prompt.delivery === "unknown" ? (
        <Button size="sm" onClick={onRetry}>
          {t("Retry")}
        </Button>
      ) : null}
    </div>
  );
}
