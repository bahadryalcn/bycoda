import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { FileField } from "../../../../../shared/ui/FileField";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import type { InstagramProfilePatch, InstagramProfileState } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

export function InstagramProfileEditor({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const [stored, setStored] = useState<InstagramProfileState>();
  const [draft, setDraft] = useState<InstagramProfileState>();
  const [avatar, setAvatar] = useState<File>();
  const [saved, setSaved] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { write, is, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const busy = is("read") || is("save");
  const patch: InstagramProfilePatch = {};
  if (draft && stored) {
    for (const key of ["name", "username", "website", "bio"] as const)
      if (draft[key] !== stored[key]) patch[key] = draft[key] ?? "";
  }
  const read = () => {
    void write("read", async () => {
      const result = await client.browserProfileRead(accountId);
      setStored(result);
      setDraft(result);
      setAvatar(undefined);
      setSaved(false);
    }).catch(() => undefined);
  };
  const save = () => {
    void confirm({
      title: t("Save Instagram profile"),
      message: t("Apply this change on Instagram?"),
      confirmLabel: t("Save"),
      danger: false,
    })
      .then((ok) => {
        if (!ok) return;
        return write("save", async () => {
          setSaved(false);
          const avatarUploadId = avatar ? (await client.upload(avatar)).uploadId : undefined;
          const current = await client.browserProfileUpdate(accountId, "instagram", {
            ...patch,
            ...(avatarUploadId ? { avatarUploadId } : {}),
          });
          setStored(current);
          setDraft(current);
          setAvatar(undefined);
          setSaved(true);
        });
      })
      .catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram profile")} hideLegend disabled={disabled || busy}>
      <div className="instagram-head">
        <Text size="caption" tone="secondary">
          {t("Read your profile from Instagram, change it, then save.")}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          loading={is("read")}
          disabled={Boolean(draft) && (Boolean(avatar) || Object.keys(patch).length > 0)}
          onClick={read}
        >
          {draft ? t("Refresh") : t("Read Instagram profile")}
        </Button>
      </div>
      {is("read") && !draft ? <LoadingText /> : null}
      {draft ? (
        <>
          <div className="instagram-grid">
            <TextField
              label={t("Profile name")}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            {draft.username === undefined ? null : (
              <TextField
                label={t("Instagram username")}
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              />
            )}
          </div>
          <TextField
            label={t("Website")}
            type="url"
            value={draft.website}
            onChange={(event) => setDraft({ ...draft, website: event.target.value })}
          />
          <TextareaField
            label={t("Bio")}
            maxLength={150}
            value={draft.bio}
            onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
          />
          <FileField
            label={t("Profile photo")}
            accept="image/jpeg,image/png"
            description={avatar?.name}
            onFiles={(files) => setAvatar(files[0])}
          />
          <div className="instagram-actions">
            <Button
              variant="primary"
              size="sm"
              loading={is("save")}
              disabled={!avatar && !Object.keys(patch).length}
              onClick={save}
            >
              {t("Save Instagram profile")}
            </Button>
          </div>
        </>
      ) : null}
      {saved ? <InlineMessage tone="success">{t("Instagram updated.")}</InlineMessage> : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
      {dialog}
    </FieldGroup>
  );
}
