import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

export function InstagramFollowersPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const confirmation = useConfirm();
  const [notice, setNotice] = useState("");
  const [handle, setHandle] = useState("");
  const [followers, setFollowers] = useState<string[]>();
  const follow = (next: boolean, label: string) => {
    const username = handle.trim();
    void confirmation
      .confirm({
        title: label,
        message: t("Apply this change on Instagram?"),
        details: username,
        confirmLabel: label,
        danger: false,
      })
      .then((ok) => {
        if (!ok) return;
        setNotice("");
        void write(label, async () => {
          const result = await client.browserInstagramFollow(accountId, {
            handle: username,
            follow: next,
            confirm: next ? "FOLLOW_INSTAGRAM_ACCOUNT" : "UNFOLLOW_INSTAGRAM_ACCOUNT",
          });
          setNotice(result.requested ? t("Follow request sent.") : t("Instagram updated."));
        }).catch(() => undefined);
      })
      .catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram followers")} hideLegend disabled={disabled}>
      <TextField
        label={t("Instagram username")}
        value={handle}
        onChange={(event) => {
          setHandle(event.target.value);
          setFollowers(undefined);
        }}
      />
      <div className="instagram-actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={!handle.trim()}
          loading={is("followers")}
          onClick={() =>
            void write("followers", async () => {
              const sample = await client.browserInstagramFollowers(accountId, handle.trim());
              setFollowers(sample.followers.map(({ username }) => username));
            }).catch(() => undefined)
          }
        >
          {t("Read visible followers")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!handle.trim()}
          loading={is(t("Follow"))}
          onClick={() => follow(true, t("Follow"))}
        >
          {t("Follow")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!handle.trim()}
          loading={is(t("Unfollow"))}
          onClick={() => follow(false, t("Unfollow"))}
        >
          {t("Unfollow")}
        </Button>
      </div>
      {followers ? (
        followers.length ? (
          <>
            <Text size="caption" tone="secondary">
              {t("Visible followers only")}
            </Text>
            <div className="instagram-chips">
              {followers.map((username) => (
                <Badge key={username} size="sm">
                  {username}
                </Badge>
              ))}
            </div>
          </>
        ) : (
          <EmptyState size="inline" context="list" title={t("No results")} />
        )
      ) : null}
      {notice ? <InlineMessage tone="success">{notice}</InlineMessage> : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
