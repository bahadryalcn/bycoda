import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { Notice } from "./socialShared";
import type { CampaignVariant, TikTokVideoOptions } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";

export const tiktokDefaults: TikTokVideoOptions = {
  privacy: "",
  durationSeconds: 0,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: false,
  consent: false,
};
const privacyLabels: Record<string, string> = {
  get PUBLIC_TO_EVERYONE() {
    return t("Everyone");
  },
  get MUTUAL_FOLLOW_FRIENDS() {
    return t("Friends");
  },
  get FOLLOWER_OF_CREATOR() {
    return t("Followers");
  },
  get SELF_ONLY() {
    return t("Only me");
  },
};
export function TikTokPublishingFields({
  variant,
  client,
  onChange,
}: {
  variant: CampaignVariant;
  client: SocialClient;
  onChange: (patch: Partial<CampaignVariant>) => void;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const options = variant.tiktok ?? tiktokDefaults;
  const creator = useQuery({
    queryKey: [...socialQueryScope(client), "tiktok-creator", variant.accountId],
    queryFn: () => client.tiktokCreator(variant.accountId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const info = creator.data;
  const change = (patch: Partial<TikTokVideoOptions>) =>
    onChange({
      tiktok: {
        ...options,
        consent: false,
        ...patch,
        ...(info?.commentDisabled ? { allowComment: false } : {}),
        ...(info?.duetDisabled ? { allowDuet: false } : {}),
        ...(info?.stitchDisabled ? { allowStitch: false } : {}),
      },
    });
  return (
    <fieldset>
      <legend>{t("TikTok video publishing")}</legend>
      {info ? (
        <p>
          {t("Account: {p0} · up to {p1} seconds", {
            p0: info.nickname,
            p1: info.maxDurationSeconds,
          })}
        </p>
      ) : (
        <Notice kind={creator.isError ? "error" : "loading"}>
          {creator.isError
            ? t(
                "Check the TikTok publishing permission; reconnect the account with the video.publish permission and try again.",
              )
            : t("Reading TikTok publishing settings…")}
        </Notice>
      )}
      <Button
        type="button"
        variant="secondary"
        loading={creator.isFetching}
        disabled={socialLocked || creator.isFetching}
        onClick={() => void creator.refetch()}
      >
        {t("Refresh publishing settings")}
      </Button>
      <TextField
        disabled={socialLocked}
        label={t("HTTPS video URL on a verified domain")}
        type="url"
        value={variant.media[0]?.url ?? ""}
        onChange={(event) =>
          onChange({
            media: event.target.value ? [{ kind: "video", url: event.target.value }] : [],
            tiktok: { ...options, durationSeconds: 0, consent: false },
          })
        }
      />
      <small>
        {t(
          "The URL domain or prefix must be verified in the TikTok developer app. TikTok fetches the video from this address.",
        )}
      </small>
      {variant.media[0]?.url ? (
        <video
          className="max-w-full"
          controls
          preload="metadata"
          src={variant.media[0].url}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0 && duration !== options.durationSeconds)
              change({ durationSeconds: duration });
          }}
          onError={() => {
            if (options.durationSeconds) change({ durationSeconds: 0 });
          }}
        />
      ) : null}
      <label>
        {t("Visibility")}
        <NativeSelect
          aria-label={t("Visibility")}
          required
          value={options.privacy}
          disabled={socialLocked || !info || creator.isFetching || creator.isError}
          onChange={(event) => change({ privacy: event.target.value })}
        >
          <option value="">{t("Select visibility")}</option>
          {info?.privacyOptions.map((value) => (
            <option value={value} key={value}>
              {privacyLabels[value]}
            </option>
          ))}
        </NativeSelect>
      </label>
      {(
        [
          ["allowComment", t("Allow comments"), info?.commentDisabled],
          ["allowDuet", t("Allow Duet"), info?.duetDisabled],
          ["allowStitch", t("Allow Stitch"), info?.stitchDisabled],
        ] as const
      ).map(([key, label, blocked]) => (
        <label key={key}>
          <Checkbox
            checked={options[key] && !blocked}
            disabled={socialLocked || !info || !!blocked}
            onChange={(event) => change({ [key]: event.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        <Checkbox
          disabled={socialLocked}
          checked={options.brandOrganic}
          onChange={(event) => change({ brandOrganic: event.target.checked })}
        />
        {t("Promotes my own brand")}
      </label>
      <label>
        <Checkbox
          disabled={socialLocked}
          checked={options.brandContent}
          onChange={(event) => change({ brandContent: event.target.checked })}
        />
        {t("Includes a paid brand partnership")}
      </label>
      <label>
        <Checkbox
          disabled={socialLocked}
          checked={options.isAigc}
          onChange={(event) => change({ isAigc: event.target.checked })}
        />
        {t("AI-generated content")}
      </label>
      {options.brandContent && options.privacy === "SELF_ONLY" ? (
        <Notice kind="error">
          {t("The Only me visibility cannot be used for a paid brand partnership.")}
        </Notice>
      ) : null}
      <label>
        <Checkbox
          checked={options.consent}
          disabled={
            socialLocked ||
            !info ||
            creator.isFetching ||
            creator.isError ||
            !info.privacyOptions.includes(options.privacy) ||
            !options.durationSeconds ||
            options.durationSeconds > info.maxDurationSeconds
          }
          onChange={(event) => change({ consent: event.target.checked })}
        />
        {t("I previewed the video; I approve sending it to TikTok and the")}{" "}
        <a
          href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          target="_blank"
          rel="noreferrer"
        >
          Music Usage Confirmation
        </a>
        {options.brandContent || options.brandOrganic ? (
          <>
            {" "}
            {t("together with the")}{" "}
            <a
              href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              target="_blank"
              rel="noreferrer"
            >
              Branded Content Policy
            </a>
          </>
        ) : null}{" "}
        {t("terms.")}
      </label>
      {options.brandContent || options.brandOrganic ? (
        <p>
          {t("Content label: {p0}", {
            p0: options.brandContent ? "Paid partnership" : "Promotional content",
          })}
        </p>
      ) : null}
      <small>
        {t(
          "These choices are saved; sending also requires campaign approval and explicit send permission. Public posting may be unavailable without TikTok app approval.",
        )}
      </small>
    </fieldset>
  );
}
