import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Button } from "../../../../shared/ui/Button";
import { Sparkles } from "../../../../shared/ui/icons";
import { PromptField } from "../../../../shared/ui/PromptField";
import type { ActionGate } from "../common/DisabledReason";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { inboxApi } from "./inboxApi";
import { replyBlockedText } from "./inboxModel";
import { useInboxInvalidate, useInboxReplyOptions, useInboxSnapshot } from "./useInboxData";
import "./inbox.css";

/** Host limit for one AI reply: 1 to 20 verified facts. */
const MAX_FACTS = 20;

type Busy = "" | "suggest" | "send";

/**
 * Reply editor for one conversation. The Host decides whether a reply is allowed (replyOptions);
 * a blocked reply shows its reason next to the disabled Send button. AI text lands in the editor.
 */
export function ReplyBox({ client, thread }: { client: SocialClient; thread: SocialThread }) {
  const api = inboxApi(client);
  const options = useInboxReplyOptions(client, thread.id);
  const snapshot = useInboxSnapshot(client);
  const invalidate = useInboxInvalidate(client);
  const [text, setText] = useState("");
  const [factIds, setFactIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const confirmation = useConfirm();

  const blocked = options.data ? replyBlockedText(options.data) : undefined;
  // Until the Host answers, Send says why it is off instead of guessing that a reply is allowed.
  const unknownReason = options.isError
    ? t("The reply options could not be loaded. Reload the conversation.")
    : options.data
      ? undefined
      : t("Checking whether this conversation can take a reply.");
  const blockedReason = unknownReason ?? blocked;
  const facts =
    snapshot.data?.profiles.find((profile) => profile.projectId === thread.projectId)?.facts ?? [];

  const aiPrerequisite = !thread.projectId
    ? t("Choose the conversation's project first.")
    : facts.length === 0
      ? t("Add verified facts for this project first.")
      : undefined;
  const suggestGate: ActionGate = aiPrerequisite
    ? { disabled: true, disabledReason: aiPrerequisite }
    : busy
      ? { disabled: true, disabledReason: t("Working…") }
      : { disabled: false };

  const sendGate: ActionGate = blockedReason
    ? { disabled: true, disabledReason: blockedReason }
    : busy
      ? { disabled: true, disabledReason: t("Sending…") }
      : !text.trim()
        ? { disabled: true, disabledReason: t("Write a reply first.") }
        : { disabled: false };

  const suggest = async () => {
    setBusy("suggest");
    setError("");
    setQueued(false);
    try {
      const result = await api.suggest(
        thread.id,
        facts.slice(0, MAX_FACTS).map((fact) => fact.id),
      );
      setText(result.text);
      setFactIds(result.factIds);
    } catch {
      setError(t("Could not prepare a suggestion. Try again."));
    } finally {
      setBusy("");
    }
  };

  /** AI text replaces whatever the owner wrote, so a non-empty draft needs an explicit yes. */
  const requestSuggestion = () => {
    if (!text.trim()) {
      void suggest().catch(() => undefined);
      return;
    }
    void confirmation
      .confirm({
        title: t("Replace your draft with an AI suggestion?"),
        message: t("The text in the editor will be replaced."),
        confirmLabel: t("Replace draft"),
        danger: false,
      })
      .then((ok) => {
        if (ok) void suggest().catch(() => undefined);
      })
      .catch(() => undefined);
  };

  const send = async () => {
    setBusy("send");
    setError("");
    setQueued(false);
    try {
      await api.sendReply({ threadId: thread.id, text: text.trim(), factIds });
      setText("");
      setFactIds([]);
      setQueued(true);
      await invalidate();
    } catch {
      setError(t("The reply was not sent. Check the conversation and try again."));
    } finally {
      setBusy("");
    }
  };

  // One short line for a real prerequisite; every other reason lives in the button's tooltip.
  const prerequisite = blockedReason ?? aiPrerequisite;

  return (
    <div className="inbox-reply">
      <PromptField
        label={t("Reply")}
        minRows={3}
        maxRows={10}
        value={text}
        disabled={!!blocked || busy === "send"}
        placeholder={t("Write a reply")}
        onChange={(event) => {
          setText(event.target.value);
          setFactIds([]);
        }}
        toolbarTrailing={
          <>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<Sparkles className="icon-sm" strokeWidth={1.75} />}
              onClick={requestSuggestion}
              {...suggestGate}
            >
              {t("Fill with AI")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void send().catch(() => undefined)}
              {...sendGate}
            >
              {t("Send")}
            </Button>
          </>
        }
      />
      {prerequisite ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="inbox-note">
          {prerequisite}
        </Text>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {queued ? <InlineMessage tone="success">{t("Reply queued.")}</InlineMessage> : null}
      {confirmation.dialog}
    </div>
  );
}
