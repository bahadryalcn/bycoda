import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { NativeSelect } from "../../../../../shared/ui/Select";
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

/** TikTok video options. Privacy and consent are never pre-selected; interactions follow the creator's settings. */
export function TikTokFields({ value, media, disabled, creator, onChange }: PlatformFieldProps) {
  const options = value.tiktok ?? {};
  const change = (patch: Partial<Omit<TikTokVideoOptions, "durationSeconds">>) =>
    onChange({ ...value, tiktok: { ...options, ...patch } });
  const duration = media.find((item) => item.media.kind === "video")?.probe?.durationSeconds;
  const locked = disabled || !creator;
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
    <FieldGroup legend={t("TikTok")} className="content-platform" disabled={locked}>
      {!creator ? (
        <Text
          as="p"
          size="caption"
          tone="muted"
          leading="inherit"
          className="content-platform-note"
        >
          {t("Loading your TikTok options…")}
        </Text>
      ) : null}
      {duration ? (
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
      <NativeSelect
        aria-label={t("Who can see this video")}
        value={options.privacy ?? ""}
        onChange={(event) => change({ privacy: event.target.value })}
      >
        <option value="" disabled>
          {t("Choose who can see this video")}
        </option>
        {(creator?.privacyOptions ?? []).map((code) => (
          <option key={code} value={code}>
            {privacyLabel(code)}
          </option>
        ))}
      </NativeSelect>
      {interactions.map((item) => (
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
        label={t("I confirm the consent needed to post this video to TikTok.")}
        size="body"
        leading="inherit"
        className="content-check"
      />
    </FieldGroup>
  );
}
