import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import type { SocialAccount, SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

export function InstagramCommentActions({
  client,
  account,
  thread,
}: {
  client: SocialClient;
  account: SocialAccount;
  thread: SocialThread;
}) {
  const confirmation = useConfirm();
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const [completed, setCompleted] = useState<string>();
  const inbound = thread.events.filter((event) => event.direction === "inbound");
  const target = inbound[inbound.length - 1];
  if (!target || thread.kind !== "comment" || thread.replyAllowed === false) return null;
  const browser = account.connection === "browser";
  const postId = thread.platformPostId;
  if (browser && !postId) return null;
  const actions = browser
    ? [{ action: "like" as const, label: t("Like Instagram comment") }]
    : [
        { action: "hide" as const, label: t("Hide Instagram comment") },
        { action: "unhide" as const, label: t("Unhide Instagram comment") },
        { action: "delete" as const, label: t("Delete Instagram comment") },
      ];
  return (
    <Disclosure variant="row" summary={t("Instagram comment actions")}>
      <div className="social-tag-line">
        {actions.map(({ action, label }) => (
          <Button
            key={action}
            variant="secondary"
            size="sm"
            tone={action === "delete" ? "danger" : "neutral"}
            disabled={completed === "delete" || completed === "like"}
            loading={is(action)}
            onClick={() => {
              void confirmation
                .confirm({
                  title: label,
                  message: target.text,
                  confirmLabel: label,
                  danger: action === "delete",
                })
                .then((ok) => {
                  if (!ok) return;
                  return write(action, async () => {
                    setCompleted(undefined);
                    if (action === "like" && postId) {
                      await client.browserInstagramLikeComment(account.id, {
                        postId,
                        commentId: target.platformId,
                        confirm: "LIKE_INSTAGRAM_COMMENT",
                      });
                    } else {
                      await client.request("instagram.comments.moderate", {
                        threadId: thread.id,
                        commentId: target.platformId,
                        action,
                        confirm: "MODERATE_INSTAGRAM_COMMENT",
                      });
                    }
                    setCompleted(action);
                  });
                })
                .catch(() => undefined);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {completed ? <InlineMessage tone="success">{t("Instagram updated.")}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </Disclosure>
  );
}
