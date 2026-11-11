import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Surface } from "../../../../shared/ui/Surface";
import { TextField } from "../../../../shared/ui/TextField";
import { useSocialPending } from "../../hooks/useSocialPending";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import type { SocialScreenProps } from "../shell/screens";
import { askAiForPost, type AiPostDraft } from "./contentAi";

export type ContentEditorAiProps = {
  client: SocialClient;
  projectId?: string;
  accountCount: number;
  aiStopped: boolean;
  disabled: boolean;
  /** The AI draft is only offered here; the owner decides whether it replaces the text. */
  onUse: (draft: AiPostDraft) => void;
  onNavigate: SocialScreenProps["onNavigate"];
};

const closed = (reason: string): ActionGate => ({ disabled: true, disabledReason: reason });

/** Ask AI for one post. The result is a suggestion the owner accepts or discards; nothing is saved. */
export function ContentEditorAi({
  client,
  projectId,
  accountCount,
  aiStopped,
  disabled,
  onUse,
  onNavigate,
}: ContentEditorAiProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [suggestion, setSuggestion] = useState<AiPostDraft>();
  const [error, setError] = useState<string>();
  const pending = useSocialPending();
  const gate: ActionGate = disabled
    ? closed(t("Wait for the current action to finish."))
    : aiStopped
      ? closed(t("AI is stopped. Resume it from the top bar."))
      : !projectId
        ? closed(t("Choose a project first."))
        : !accountCount
          ? closed(t("Choose an account first."))
          : !instruction.trim()
            ? closed(t("Describe the post first."))
            : { disabled: false };
  const ask = () =>
    void pending
      .run("content.ai", async () => {
        setError(undefined);
        setSuggestion(undefined);
        try {
          const result = await askAiForPost(client, {
            instruction: instruction.trim(),
            projectId: projectId!,
          });
          if (result) setSuggestion(result);
          else setError(t("AI did not return a post. Write it yourself or try again."));
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : t("AI could not write the post."));
        }
      })
      .catch(() => setError(t("AI could not write the post.")));
  return (
    <div className="content-ai">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {t("Ask AI")}
      </Button>
      {open ? (
        <div className="content-ai-body">
          <TextField
            label={t("What should the post say?")}
            value={instruction}
            disabled={disabled}
            description={t("AI drafts the text. You review it before anything is saved.")}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <DisabledReason
            variant="primary"
            size="sm"
            loading={pending.is("content.ai")}
            onClick={ask}
            {...gateProps(gate)}
          >
            {t("Write with AI")}
          </DisabledReason>
          {error ? (
            <InlineMessage tone="danger">
              {error}
              <Button variant="link" size="sm" onClick={() => onNavigate("command")}>
                {t("Open Command")}
              </Button>
            </InlineMessage>
          ) : null}
          {suggestion ? (
            <Surface variant="card" padding="sm" className="content-ai-suggestion">
              <p className="content-preview-text">{suggestion.text}</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onUse(suggestion);
                  setSuggestion(undefined);
                  setOpen(false);
                  setInstruction("");
                }}
              >
                {t("Use this text")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSuggestion(undefined)}>
                {t("Discard")}
              </Button>
            </Surface>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
