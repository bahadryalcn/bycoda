import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { useState } from "react";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

export function FacebookCommentActions({
  client,
  thread,
}: {
  client: SocialClient;
  thread: SocialThread;
}) {
  const t = useT();
  const confirm = useConfirm();
  const work = useAccountWrite(t("Could not save this change. Try again."));
  const [actionTaken, setActionTaken] = useState<string>();
  const actions = {
    hide: t("Hide comment"),
    unhide: t("Unhide comment"),
    delete: t("Delete comment"),
    like: t("Like comment"),
    unlike: t("Unlike comment"),
  };
  const moderate = async (action: keyof typeof actions) => {
    const inbound = thread.events.filter((event) => event.direction === "inbound");
    const comment = inbound[inbound.length - 1];
    if (
      !(await confirm.confirm({
        title: actions[action],
        message: comment?.text || thread.platformThreadId,
        confirmLabel: actions[action],
        danger: action === "delete",
      }))
    )
      return;
    const result = await work.write(action, () =>
      client.request("facebook.comment.moderate", {
        threadId: thread.id,
        action,
        confirm: "MODERATE_FACEBOOK_COMMENT",
      }),
    );
    if (result) setActionTaken(action);
  };
  return (
    <Disclosure summary={t("Comment moderation")} variant="row">
      <div className="social-field-row">
        {(Object.keys(actions) as (keyof typeof actions)[]).map((action) => (
          <Button
            key={action}
            size="sm"
            variant="secondary"
            loading={work.is(action)}
            disabled={actionTaken === "delete" || actionTaken === action}
            disabledReason={
              actionTaken === "delete"
                ? t("This comment was deleted.")
                : t("This action was already applied.")
            }
            onClick={() => void moderate(action).catch(() => undefined)}
          >
            {actions[action]}
          </Button>
        ))}
      </div>
      {actionTaken ? <InlineMessage tone="success">{t("Saved")}</InlineMessage> : null}
      {work.failureTitle ? (
        <InlineError details={work.details}>{work.failureTitle}</InlineError>
      ) : null}
      {confirm.dialog}
    </Disclosure>
  );
}
