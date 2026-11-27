import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./facebook.css";

export function FacebookBrowserPostDelete({
  client,
  accountId,
}: {
  client: SocialClient;
  accountId: string;
}) {
  const t = useT();
  const confirm = useConfirm();
  const work = useAccountWrite(t("Could not save changes."));
  const [link, setLink] = useState("");
  const [deleted, setDeleted] = useState(false);
  const busy = work.is("delete");

  const remove = async () => {
    const postId = link.trim();
    if (!postId || busy) return;
    if (
      !(await confirm.confirm({
        title: t("Delete post"),
        message: postId,
        confirmLabel: t("Delete"),
        danger: true,
      }))
    )
      return;
    const result = await work.write("delete", () =>
      client.request<{ deleted: boolean }>("facebook.post.delete", {
        accountId,
        postId,
        confirm: "DELETE_FACEBOOK_POST",
      }),
    );
    if (result?.deleted) {
      setDeleted(true);
      setLink("");
    }
  };

  return (
    <form
      className="social-fb-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void remove().catch(() => undefined);
      }}
    >
      <TextField
        label={t("Link")}
        type="url"
        placeholder="https://www.facebook.com/…"
        value={link}
        disabled={busy}
        onChange={(event) => {
          setLink(event.currentTarget.value);
          setDeleted(false);
          work.setError("");
        }}
      />
      <div className="social-fb-toolbar">
        <Button type="submit" size="sm" tone="danger" disabled={!link.trim()} loading={busy}>
          {t("Delete post")}
        </Button>
      </div>
      {work.failureTitle ? (
        <InlineError details={work.details}>{work.failureTitle}</InlineError>
      ) : null}
      {deleted ? <InlineMessage tone="success">{t("Deleted")}</InlineMessage> : null}
      {confirm.dialog}
    </form>
  );
}
