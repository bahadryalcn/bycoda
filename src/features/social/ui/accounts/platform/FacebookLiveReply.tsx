import { useSyncExternalStore } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import type { FacebookLiveComment } from "../../../../../integrations/social/adapters/facebook-live";
import type { SocialClient } from "../../../model/socialClient";
import { createInboxReplyOperation, resumeInboxReply } from "../../inbox/inboxReplyOperation";
import { inboxReplyState } from "../../inbox/inboxReplyState";

export function FacebookLiveReply({
  client,
  accountId,
  liveId,
  comment,
  cursor,
}: {
  client: SocialClient;
  accountId: string;
  liveId: string;
  comment: FacebookLiveComment;
  cursor?: string;
}) {
  const t = useT();
  const confirm = useConfirm();
  const state = inboxReplyState(client, `facebook-live:${accountId}:${liveId}:${comment.id}`);
  const { draft, operation, busy, error, queued } = useSyncExternalStore(
    state.subscribe,
    state.snapshot,
  );
  const send = async () => {
    const text = draft.text.trim();
    if (
      !operation &&
      !(await confirm.confirm({
        title: t("Send public reply"),
        message: text,
        confirmLabel: t("Send"),
      }))
    )
      return;
    const attempt =
      operation ??
      createInboxReplyOperation(
        { threadId: "", text, factIds: [] },
        {
          action: "facebook.live.replyDraft",
          input: {
            accountId,
            liveId,
            commentId: comment.id,
            text,
            ...(cursor ? { cursor } : {}),
          },
        },
      );
    state.update({
      operation: attempt,
      busy: "send",
      error: "",
      queued: false,
    });
    try {
      await resumeInboxReply(client.request, attempt);
      if (attempt.queued)
        state.update({
          operation: undefined,
          draft: { text: "", factIds: [] },
          queued: true,
        });
      else
        state.update({
          error: t("Reply requires review in Activity. Its original draft has been kept."),
        });
    } catch (cause) {
      state.update({
        error: cause instanceof Error ? cause.message : t("Could not save this change. Try again."),
      });
    } finally {
      state.update({ busy: "" });
    }
  };
  return (
    <>
      <TextareaField
        label={t("Reply")}
        value={draft.text}
        disabled={!!operation || !!busy}
        onChange={(event) =>
          state.update({
            draft: { text: event.currentTarget.value, factIds: [] },
            queued: false,
          })
        }
      />
      <div className="social-field-row">
        <Button
          size="sm"
          loading={busy === "send"}
          disabled={!draft.text.trim()}
          onClick={() => void send().catch(() => undefined)}
        >
          {operation ? t("Retry same reply") : t("Send public reply")}
        </Button>
        {operation && !operation.sendAttempted && !busy ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => state.update({ operation: undefined, error: "" })}
          >
            {t("Edit reply")}
          </Button>
        ) : null}
      </div>
      {queued ? <InlineMessage tone="success">{t("Reply queued.")}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </>
  );
}
