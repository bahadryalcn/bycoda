import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type { InstagramPostChange, InstagramPostDeletion } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

export function InstagramPostsPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const queryClient = useQueryClient();
  const confirmation = useConfirm();
  const [notice, setNotice] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [caption, setCaption] = useState("");
  const url = postUrl.trim();
  const scope = [...socialQueryScope(client), "instagram", accountId];
  const statusKey = [...scope, "post-deletion", url];
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () =>
      client.request<{ deletion?: InstagramPostDeletion }>("instagram.post.deletion.status", {
        accountId,
        postUrl: url,
      }),
    enabled: /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]{1,64}\/?$/.test(url),
    retry: false,
  });
  const deletion = status.data?.deletion;
  const changePost = (action: InstagramPostChange["action"], label: string) => {
    const change: InstagramPostChange =
      action === "delete"
        ? { action, postUrl: url, confirm: "DELETE_INSTAGRAM_POST" }
        : { action, postUrl: url, caption, confirm: "EDIT_INSTAGRAM_CAPTION" };
    void confirmation
      .confirm({
        title: label,
        message: t("Apply this change on Instagram?"),
        details: url,
        confirmLabel: label,
        danger: action === "delete",
      })
      .then((ok) => {
        if (!ok) return;
        setNotice("");
        void write(label, async () => {
          const result = await client.browserInstagramPost(accountId, change);
          if (result.deletion) {
            queryClient.setQueryData(statusKey, { deletion: result.deletion });
            await queryClient.invalidateQueries({ queryKey: [...scope, "management"] });
          } else {
            setNotice(t("Instagram updated."));
          }
        }).catch(() => undefined);
      })
      .catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Manage Instagram posts")} hideLegend disabled={disabled}>
      <TextField
        label={t("Instagram post URL")}
        description={t("Paste the link of the post you want to change.")}
        type="url"
        value={postUrl}
        onChange={(event) => setPostUrl(event.target.value)}
      />
      <TextareaField
        label={t("Caption")}
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
      />
      <div className="instagram-actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!url || Boolean(deletion)}
          loading={is(t("Edit Instagram caption"))}
          onClick={() => changePost("caption", t("Edit Instagram caption"))}
        >
          {t("Edit Instagram caption")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          tone="danger"
          disabled={!url || status.isFetching || Boolean(deletion)}
          loading={is(t("Delete Instagram post"))}
          onClick={() => changePost("delete", t("Delete Instagram post"))}
        >
          {t("Delete Instagram post")}
        </Button>
        {deletion === "review" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void write("open", () => openExternal(url)).catch(() => undefined);
            }}
          >
            {t("Open post")}
          </Button>
        ) : null}
      </div>
      {deletion === "review" ? (
        <InlineMessage tone="warning">{t("Needs review")}</InlineMessage>
      ) : null}
      {deletion === "deleted" ? <InlineMessage tone="success">{t("Deleted")}</InlineMessage> : null}
      {notice ? <InlineMessage tone="success">{notice}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
