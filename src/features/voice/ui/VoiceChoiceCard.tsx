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
      setDraftError("This question draft could not be restored. Keep the original card and retry.");
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
        <InlineError>{t(restored.error ?? draftError)}</InlineError>
        <Button size="sm" onClick={() => setEpoch((value) => value + 1)}>
          {t("Retry")}
        </Button>
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
