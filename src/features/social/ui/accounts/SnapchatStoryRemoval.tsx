import { accountBlockedReason } from "./blockedReason";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";
import "./platform/snapchat.css";

export function SnapchatStoryRemoval({
  client,
  account,
  disabled,
}: {
  client: SocialClient;
  account: SocialAccount;
  disabled: boolean;
}) {
  const [id, setId] = useState("");
  const [target, setTarget] = useState("");
  const [deleted, setDeleted] = useState(false);
  const { failureTitle, details, is, setError, write } = useAccountWrite(
    t("Could not delete the Public Story."),
  );
  const confirmation = useConfirm();
  const pending = is("delete");
  const request = (storyId: string) => ({
    title: t("Delete this Snapchat publication?"),
    context: account.name,
    message: storyId,
    requireText: { text: storyId, caseSensitive: true },
    confirmLabel: t("Delete"),
    danger: true,
    onConfirm: async () => {
      if (disabled || pending || storyId !== id.trim()) throw new Error(t("Action unavailable."));
      await write("delete", async () => {
        await client.snapchatStoryDelete(account.id, storyId);
        setDeleted(true);
        setId("");
      });
    },
  });
  const remove = async () => {
    const storyId = id.trim();
    if (!storyId || disabled || pending) return;
    setTarget(storyId);
    try {
      await confirmation.confirm(request(storyId));
    } finally {
      setTarget("");
    }
  };
  return (
    <Disclosure summary={t("Delete Public Story")} variant="row">
      <div className="social-sc-stack">
        <Text as="p" size="secondary" tone="muted">
          {t(
            "Snapchat has no story list for browser accounts, so paste the ID of the story to remove. You confirm it again before anything is deleted.",
          )}
        </Text>
        <TextField
          label={t("Public Story ID")}
          value={id}
          disabled={disabled || pending}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setId(event.currentTarget.value);
            setDeleted(false);
            setError("");
          }}
        />
        <div className="social-sc-actions">
          <Button
            variant="secondary"
            tone="danger"
            size="sm"
            disabled={disabled || pending || !id.trim()}
            disabledReason={
              disabled || pending ? accountBlockedReason(disabled) : t("Enter the Story ID first.")
            }
            loading={pending}
            onClick={() => void remove().catch(() => undefined)}
          >
            {t("Delete")}
          </Button>
        </div>
        {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
        {deleted ? (
          <InlineMessage tone="success">{t("Public Story deleted.")}</InlineMessage>
        ) : null}
      </div>
      {target ? confirmation.renderDialog(request(target)) : null}
    </Disclosure>
  );
}
