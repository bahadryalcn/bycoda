import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Text } from "../../../../../shared/ui/Text";
import { t, useFormat } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import type { TikTokVideoOptions } from "../../../model/social";
import type { PlatformFieldProps } from "./PlatformFields";

const PRIVACY_LABELS: Record<string, () => string> = {
  PUBLIC_TO_EVERYONE: () => t("Everyone"),
  MUTUAL_FOLLOW_FRIENDS: () => t("Friends"),
  FOLLOWER_OF_CREATOR: () => t("Followers"),
  SELF_ONLY: () => t("Only me"),
};

export function privacyLabel(code: string): string {
  return PRIVACY_LABELS[code]?.() ?? code;
}

/** TikTok publishing options. Direct posts require an explicit privacy choice and consent. */
export function TikTokFields({
  account,
  value,
  media,
  disabled,
  creator,
  onChange,
}: PlatformFieldProps) {
  const { formatNumber } = useFormat();
  const options = value.tiktok ?? {};
  const change = (patch: Partial<Omit<TikTokVideoOptions, "durationSeconds">>) =>
    onChange({ ...value, tiktok: { ...options, ...patch } });
  const duration = media.find((item) => item.media.kind === "video")?.probe?.durationSeconds;
  const photo = options.mediaType === "photo";
  const inbox = options.mode === "inbox";
  const photos = media.filter((item) => item.media.kind === "image");
  const canUploadInbox =
    account.connection !== "browser" && account.scopes?.includes("video.upload");
  const interactions: {
    key: "allowComment" | "allowDuet" | "allowStitch";
    label: string;
    blocked?: boolean;
  }[] = [
    { key: "allowComment", label: t("Allow comments"), blocked: creator?.commentDisabled },
    { key: "allowDuet", label: t("Allow duets"), blocked: creator?.duetDisabled },
    { key: "allowStitch", label: t("Allow stitches"), blocked: creator?.stitchDisabled },
  ];
  return (
    <FieldGroup
      legend={t("TikTok")}
      hideLegend
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <Select
        label={t("TikTok post format")}
        value={photo ? "photo" : "video"}
        options={[
          { value: "video", label: t("Video") },
          { value: "photo", label: t("Photos") },
        ]}
        disabled={disabled}
        onValueChange={(next) =>
          change({ mediaType: next === "photo" ? "photo" : "video", consent: false })
        }
      />
      {canUploadInbox || inbox ? (
        <Select
          label={t("TikTok publishing mode")}
          value={inbox ? "inbox" : "direct"}
          options={[
            { value: "direct", label: t("Publish directly") },
            { value: "inbox", label: t("Send draft to TikTok inbox"), disabled: !canUploadInbox },
          ]}
          disabled={disabled}
          onValueChange={(next) =>
            change({ mode: next === "inbox" ? "inbox" : "direct", consent: false })
          }
        />
      ) : null}
      {!creator && !inbox ? (
        <LoadingText delay={false} className="content-platform-note">
          {t("Loading your TikTok options…")}
        </LoadingText>
      ) : null}
      {!photo && duration ? (
        <Text
          as="p"
          size="caption"
          tone="muted"
          leading="inherit"
          className="content-platform-note"
        >
          {t("Video length {p0} seconds.", { p0: Math.round(duration) })}
        </Text>
      ) : null}
      {!inbox && creator ? (
        <>
          <Select
            label={photo ? t("Who can see this post") : t("Who can see this video")}
            value={options.privacy ?? ""}
            options={[
              {
                value: "",
                label: photo
                  ? t("Choose who can see this post")
                  : t("Choose who can see this video"),
                disabled: true,
              },
              ...creator.privacyOptions.map((code) => ({ value: code, label: privacyLabel(code) })),
            ]}
            disabled={disabled}
            onValueChange={(next) => change({ privacy: next })}
          />
          {interactions
            .filter((item) => !photo || item.key === "allowComment")
            .map((item) => (
              <Checkbox
                checked={!item.blocked && options[item.key] === true}
                disabled={item.blocked}
                onChange={(event) => change({ [item.key]: event.target.checked })}
                label={
                  <>
                    {item.label}
                    {item.blocked ? (
                      <Text
                        size="caption"
                        tone="secondary"
                        leading="inherit"
                        className="content-check-reason"
                      >
                        {t("Turned off in your TikTok settings")}
                      </Text>
                    ) : null}
                  </>
                }
                key={item.key}
                size="body"
                leading="inherit"
                className="content-check"
              />
            ))}
          <Checkbox
            checked={options.brandContent === true}
            onChange={(event) => change({ brandContent: event.target.checked })}
            label={t("Branded content (paid partnership)")}
            size="body"
            leading="inherit"
            className="content-check"
          />
          <Checkbox
            checked={options.brandOrganic === true}
            onChange={(event) => change({ brandOrganic: event.target.checked })}
            label={t("Promotes my own brand or business")}
            size="body"
            leading="inherit"
            className="content-check"
          />
          <Checkbox
            checked={options.isAigc === true}
            onChange={(event) => change({ isAigc: event.target.checked })}
            label={t("Contains AI-generated content")}
            size="body"
            leading="inherit"
            className="content-check"
          />
          <Checkbox
            checked={options.consent === true}
            onChange={(event) => change({ consent: event.target.checked })}
            label={
              photo
                ? t("I confirm the consent needed to post these photos to TikTok.")
                : t("I confirm the consent needed to post this video to TikTok.")
            }
            size="body"
            leading="inherit"
            className="content-check"
          />
        </>
      ) : null}
      {photo ? (
        <>
          <TextField
            label={t("TikTok photo title")}
            value={options.photoTitle ?? ""}
            onChange={(event) => change({ photoTitle: event.target.value })}
            maxLength={90}
          />
          {photos.length ? (
            <Select
              label={t("TikTok cover photo")}
              value={String(options.photoCoverIndex ?? 0)}
              options={photos.map((_, index) => ({
                value: String(index),
                label: t("Photo {p0}", { p0: formatNumber(index + 1) }),
              }))}
              disabled={disabled}
              onValueChange={(next) => change({ photoCoverIndex: Number(next) })}
            />
          ) : null}
          {!inbox ? (
            <Checkbox
              checked={options.autoAddMusic === true}
              onChange={(event) => change({ autoAddMusic: event.target.checked })}
              label={t("Add TikTok-recommended music")}
              size="body"
              leading="inherit"
              className="content-check"
            />
          ) : null}
        </>
      ) : null}
    </FieldGroup>
  );
}
