import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { FileField } from "../../../../../shared/ui/FileField";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { StatRow, StatTile } from "../../../../../shared/ui/StatTile";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./tiktok.css";

type Profile = {
  name: string;
  username?: string;
  bio?: string;
  website?: string;
  followers?: number;
  following?: number;
  likes?: number;
  posts?: number;
};

const fields = ["name", "username", "bio", "website"] as const;
type ProfileField = (typeof fields)[number];

export function TikTokProfile({
  client,
  accountId,
  accountName,
  browser,
  disabled,
  onChanged,
}: {
  client: SocialClient;
  accountId: string;
  accountName: string;
  browser: boolean;
  disabled: boolean;
  onChanged(): void;
}) {
  const t = useT();
  const format = useFormat();
  const [saved, setSaved] = useState<Profile>();
  const [draft, setDraft] = useState<Profile>();
  const [avatar, setAvatar] = useState<File>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const confirmation = useConfirm();
  const { write, error, is } = useAccountWrite(t("Could not read or save the TikTok profile."));
  const patch: Partial<Record<ProfileField, string>> = {};
  for (const field of fields)
    if (saved && draft && draft[field] !== saved[field]) patch[field] = draft[field] ?? "";
  const dirty = !!avatar || Object.keys(patch).length > 0;
  const labels = {
    name: t("Profile name"),
    username: t("Username"),
    bio: t("About"),
    website: t("Website"),
  };
  const busy = is("read") || is("save");
  const read = async () => {
    const profile = await write("read", () =>
      client.request<Profile>("tiktok.profile.read", { accountId }),
    );
    if (profile) {
      setSaved(profile);
      setDraft(profile);
      setUnconfirmed(false);
    }
  };
  const update = (field: ProfileField, value: string) =>
    setDraft((current) => current && { ...current, [field]: value });
  const save = async () => {
    await confirmation.confirm({
      title: t("Save profile"),
      message: t("Review the exact changes before confirming."),
      context: accountName,
      details: (
        <DescriptionList size="sm">
          {fields
            .filter((field) => patch[field] !== undefined)
            .map((field) => (
              <DescriptionItem key={field} term={labels[field]}>
                {patch[field] || t("Remove")}
              </DescriptionItem>
            ))}
          {avatar && <DescriptionItem term={t("Profile photo")}>{avatar.name}</DescriptionItem>}
        </DescriptionList>
      ),
      confirmLabel: t("Save profile"),
      danger: false,
      onConfirm: async () => {
        const profile = await write("save", async () => {
          const upload = avatar ? await client.upload(avatar) : undefined;
          return await client.request<Profile | { status: "unknown" }>("tiktok.profile.update", {
            accountId,
            confirm: true,
            patch: { ...patch, ...(upload ? { avatarUploadId: upload.uploadId } : {}) },
          });
        });
        if (profile && "status" in profile) {
          setUnconfirmed(true);
          return;
        }
        if (profile) {
          setSaved(profile);
          setDraft(profile);
          setAvatar(undefined);
          onChanged();
        }
      },
    });
  };

  return (
    <div className="tiktok-panel">
      <div className="tiktok-head">
        <SectionLabel as="h3">{t("Profile")}</SectionLabel>
        <Button
          variant="secondary"
          size="sm"
          loading={is("read")}
          disabled={disabled || busy || (dirty && !unconfirmed)}
          onClick={() => read().catch(() => undefined)}
        >
          {draft ? t("Refresh") : t("Read profile")}
        </Button>
      </div>
      {!draft && !busy && !error && (
        <Text size="caption" tone="secondary">
          {t("Nothing loaded yet. Read it from TikTok to see it here.")}
        </Text>
      )}
      {unconfirmed && (
        <InlineMessage tone="warning">
          {t("TikTok did not confirm this change. Check its current state before trying again.")}
        </InlineMessage>
      )}
      {draft && !browser && (
        <DescriptionList size="sm">
          {draft.username && (
            <DescriptionItem term={labels.username}>@{draft.username}</DescriptionItem>
          )}
          <DescriptionItem term={labels.name}>{draft.name}</DescriptionItem>
          {draft.bio && <DescriptionItem term={labels.bio}>{draft.bio}</DescriptionItem>}
        </DescriptionList>
      )}
      {draft &&
        [draft.followers, draft.following, draft.likes, draft.posts].some(
          (value) => value !== undefined,
        ) && (
          <StatRow label={t("Profile")}>
            {draft.followers !== undefined && (
              <StatTile label={t("Followers")} value={format.formatNumber(draft.followers)} />
            )}
            {draft.following !== undefined && (
              <StatTile label={t("Following")} value={format.formatNumber(draft.following)} />
            )}
            {draft.likes !== undefined && (
              <StatTile label={t("Likes")} value={format.formatNumber(draft.likes)} />
            )}
            {draft.posts !== undefined && (
              <StatTile label={t("Posts")} value={format.formatNumber(draft.posts)} />
            )}
          </StatRow>
        )}
      {draft && browser && (
        <form
          className="tiktok-panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !disabled && !busy && !unconfirmed && draft.name.trim())
              save().catch(() => undefined);
          }}
        >
          <div className="tiktok-grid">
            <TextField
              label={labels.name}
              value={draft.name}
              maxLength={30}
              required
              disabled={disabled || busy}
              onChange={(event) => update("name", event.currentTarget.value)}
            />
            <TextField
              label={labels.username}
              value={draft.username ?? ""}
              maxLength={24}
              required
              pattern="[A-Za-z0-9_.]{2,24}"
              disabled={disabled || busy}
              onChange={(event) => update("username", event.currentTarget.value)}
            />
          </div>
          <TextareaField
            label={labels.bio}
            value={draft.bio ?? ""}
            maxLength={80}
            rows={2}
            disabled={disabled || busy}
            onChange={(event) => update("bio", event.currentTarget.value)}
          />
          <TextField
            label={labels.website}
            type="url"
            value={draft.website ?? ""}
            maxLength={250}
            disabled={disabled || busy}
            onChange={(event) => update("website", event.currentTarget.value)}
          />
          <FileField
            label={t("Profile photo")}
            hideLabel
            accept="image/png,image/jpeg"
            buttonLabel={t("Profile photo")}
            disabled={disabled || busy}
            onFiles={(files) => setAvatar(files[0])}
          />
          {avatar && <Text size="caption">{avatar.name}</Text>}
          <div className="tiktok-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={disabled || !dirty || busy || unconfirmed || !draft.name.trim()}
              loading={is("save")}
            >
              {t("Save profile")}
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(saved);
                  setAvatar(undefined);
                }}
              >
                {t("Discard changes")}
              </Button>
            )}
          </div>
        </form>
      )}
      {error && <InlineError>{error}</InlineError>}
      {confirmation.dialog}
    </div>
  );
}
