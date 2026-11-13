import { Text } from "../../../../shared/ui/Text";
import { useSyncExternalStore } from "react";
import { t } from "../../../../shared/i18n";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Button } from "../../../../shared/ui/Button";
import { Sparkles } from "../../../../shared/ui/icons";
import { PromptField } from "../../../../shared/ui/PromptField";
import type { ActionGate } from "../common/DisabledReason";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import { inboxApi } from "./inboxApi";
import { createInboxReplyOperation } from "./inboxReplyOperation";
import { inboxReplyState } from "./inboxReplyState";
import { replyBlockedText } from "./inboxModel";
import { useInboxInvalidate, useInboxReplyOptions, useInboxSnapshot } from "./useInboxData";
import "./inbox.css";

/** Host limit for one AI reply: 1 to 20 verified facts. */
const MAX_FACTS = 20;

/**
 * Reply editor for one conversation. The Host decides whether a reply is allowed (replyOptions);
 * a blocked reply shows its reason next to the disabled Send button. AI text lands in the editor.
 */
type ReplyDraft = { text: string; factIds: string[] };

export function ReplyBox(props: { client: SocialClient; thread: SocialThread }) {
  return (
    <ThreadReplyBox
      key={socialQueryScope(props.client).join(":") + ":" + props.thread.id}
      {...props}
    />
  );
}

function ThreadReplyBox({ client, thread }: { client: SocialClient; thread: SocialThread }) {
  const api = inboxApi(client);
  const options = useInboxReplyOptions(client, thread.id);
  const snapshot = useInboxSnapshot(client);
  const invalidate = useInboxInvalidate(client);
  const state = inboxReplyState(client, thread.id);
  const { draft, busy, error, queued, operation } = useSyncExternalStore(
    state.subscribe,
    state.snapshot,
  );
  const { text } = draft;
  const changeDraft = (next: ReplyDraft) => state.update({ draft: next });
  const setBusy = (busy: "" | "suggest" | "send") => state.update({ busy });
  const setError = (error: string) => state.update({ error });
  const setQueued = (queued: boolean) => state.update({ queued });
  const confirmation = useConfirm();

  const blocked = options.data ? replyBlockedText(options.data) : undefined;
  // Until the Host answers, Send says why it is off instead of guessing that a reply is allowed.
  const unknownReason = options.isError
    ? t("The reply options could not be loaded. Reload the conversation.")
    : options.data
      ? undefined
      : t("Checking whether this conversation can take a reply.");
  const blockedReason = operation?.sendAttempted ? undefined : (unknownReason ?? blocked);
  const facts =
    snapshot.data?.profiles.find((profile) => profile.projectId === thread.projectId)?.facts ?? [];

  const aiPrerequisite = !thread.projectId
    ? t("Choose the conversation's project first.")
    : facts.length === 0
      ? t("Add verified facts for this project first.")
      : undefined;
  const suggestGate: ActionGate = operation
    ? { disabled: true, disabledReason: t("Resolve the pending reply before changing its draft.") }
    : aiPrerequisite
      ? { disabled: true, disabledReason: aiPrerequisite }
      : busy
        ? { disabled: true, disabledReason: t("Working…") }
        : { disabled: false };

  const sendGate: ActionGate = blockedReason
    ? { disabled: true, disabledReason: blockedReason }
    : busy
      ? { disabled: true, disabledReason: busy === "send" ? t("Sending…") : t("Working…") }
      : !text.trim()
        ? { disabled: true, disabledReason: t("Write a reply first.") }
        : { disabled: false };

  const suggest = async () => {
    if (state.snapshot().busy || state.snapshot().operation) return;
    setBusy("suggest");
    setError("");
    setQueued(false);
    try {
      const result = await api.suggest(
        thread.id,
        facts.slice(0, MAX_FACTS).map((fact) => fact.id),
      );
      changeDraft({ text: result.text, factIds: result.factIds });
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
    const current = state.snapshot();
    if (
      current.busy ||
      !current.draft.text.trim() ||
      (blockedReason && !current.operation?.sendAttempted)
    )
      return;
    setBusy("send");
    setError("");
    setQueued(false);
    const attempt =
      current.operation ??
      createInboxReplyOperation({
        threadId: thread.id,
        text: current.draft.text.trim(),
        factIds: current.draft.factIds,
      });
    state.update({ operation: attempt });
    try {
      await api.sendReply(attempt);
      if (attempt.job && ["failed", "cancelled", "review"].includes(attempt.job.status)) {
        setError(t("Reply requires review in Activity. Its original draft has been kept."));
        return;
      }
      state.update({ draft: { text: "", factIds: [] }, operation: undefined });
      setQueued(true);
      await invalidate().catch(() => {
        setError(
          t(
            "Reply queued, but the conversation could not refresh. Reload it before sending again.",
          ),
        );
      });
    } catch (cause) {
      setError(
        (attempt.sendAttempted
          ? t(
              "Reply result is unconfirmed. Retry the same reply to check its status; do not send a separate copy.",
            )
          : t("Reply preparation could not finish. Retry the same reply or edit its draft.")) +
          (cause instanceof Error ? ` ${cause.message}` : ""),
      );
    } finally {
      setBusy("");
    }
  };

  // Every blocked action has a visible reason, including empty drafts and AI prerequisites.
  const prerequisite = sendGate.disabled ? sendGate.disabledReason : undefined;
  const suggestReason = suggestGate.disabled ? suggestGate.disabledReason : undefined;

  return (
    <div className="inbox-reply">
      <PromptField
        label={t("Reply")}
        minRows={3}
        maxRows={10}
        value={text}
        disabled={!!blocked || busy !== "" || !!operation}
        placeholder={t("Write a reply")}
        onChange={(event) => {
          changeDraft({ text: event.target.value, factIds: [] });
        }}
        toolbarTrailing={
          <>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<Sparkles className="icon-sm" strokeWidth={1.75} />}
              onClick={requestSuggestion}
              loading={busy === "suggest"}
              loadingLabel={t("Working…")}
              {...suggestGate}
            >
              {t("Fill with AI")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void send().catch(() => undefined)}
              loading={busy === "send"}
              loadingLabel={t("Sending…")}
              {...sendGate}
            >
              {operation && !busy ? t("Retry same reply") : t("Send")}
            </Button>
          </>
        }
      />
      {prerequisite ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="inbox-note">
          {prerequisite}
        </Text>
      ) : null}
      {suggestReason && suggestReason !== prerequisite ? (
        <Text as="p" size="caption" tone="muted" className="inbox-note">
          {suggestReason}
        </Text>
      ) : null}
      {options.isError ? (
        <Button
          variant="link"
          layout="text"
          loading={options.isFetching}
          onClick={() => {
            void options.refetch().catch(() => undefined);
          }}
        >
          {t("Try again")}
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {operation && !operation.sendAttempted && !busy ? (
        <Button
          variant="link"
          layout="text"
          onClick={() => state.update({ operation: undefined, error: "" })}
        >
          {t("Edit reply")}
        </Button>
      ) : null}
      {queued ? <InlineMessage tone="success">{t("Reply queued.")}</InlineMessage> : null}
      {confirmation.dialog}
    </div>
  );
}
