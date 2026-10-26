import { useContext as useSocialContext, useState } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Notice } from "./socialShared";
import { XMediaFields } from "./XMediaFields";
import type { CampaignVariant, SocialAccount, TikTokVideoOptions } from "../model/social";
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
  connection,
  onBusyChange,
}: {
  variant: CampaignVariant;
  client: SocialClient;
  onChange: (patch: Partial<CampaignVariant>) => void;
  connection?: SocialAccount["connection"];
  onBusyChange?: (busy: boolean) => void;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const options = variant.tiktok ?? tiktokDefaults;
  const browser = connection === "browser";
  const photo = !browser && options.mediaType === "photo";
  const [previewedPhotos, setPreviewedPhotos] = useState<string[]>([]);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const photoReady =
    photo &&
    variant.media.length > 0 &&
    variant.media.length <= 4 &&
    Number.isInteger(options.photoCoverIndex) &&
    options.photoCoverIndex! >= 0 &&
    options.photoCoverIndex! < variant.media.length &&
    (options.photoTitle?.length ?? 0) <= 90 &&
    variant.media.every((item) => {
      try {
        const url = new URL(item.url ?? "");
        return (
          item.kind === "image" &&
          !item.uploadId &&
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          previewedPhotos.includes(item.url!) &&
          !failedPhotos.includes(item.url!)
        );
      } catch {
        return false;
      }
    });
  const creator = useQuery({
    queryKey: [
      ...socialQueryScope(client),
      "tiktok-creator",
      variant.accountId,
      connection ?? "oauth",
    ],
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
  const changePhotos = (urls: string[]) => {
    setPreviewedPhotos((previous) => previous.filter((url) => urls.includes(url)));
    setFailedPhotos((previous) => previous.filter((url) => urls.includes(url)));
    onChange({
      media: urls.map((url) => ({ kind: "image", url })),
      tiktok: {
        ...options,
        mediaType: "photo",
        durationSeconds: 0,
        allowDuet: false,
        allowStitch: false,
        photoCoverIndex: Math.max(0, Math.min(options.photoCoverIndex ?? 0, urls.length - 1)),
        autoAddMusic: options.autoAddMusic ?? false,
        consent: false,
      },
    });
  };
  return (
    <fieldset>
      <legend>{t("TikTok publishing")}</legend>
      {!browser ? (
        <fieldset disabled={socialLocked}>
          <legend>{t("Content type")}</legend>
          <SegmentedControl
            label={t("Content type")}
            selectionRole="radio"
            value={photo ? "photo" : "video"}
            options={[
              { value: "video", label: t("Video") },
              { value: "photo", label: t("Photos") },
            ]}
            onValueChange={(value) => {
              if (value === (photo ? "photo" : "video")) return;
              setPreviewedPhotos([]);
              setFailedPhotos([]);
              onChange({
                media: [],
                tiktok: {
                  ...options,
                  mediaType: value as "video" | "photo",
                  durationSeconds: 0,
                  allowDuet: false,
                  allowStitch: false,
                  photoTitle: "",
                  photoCoverIndex: 0,
                  autoAddMusic: false,
                  consent: false,
                },
              });
            }}
          />
        </fieldset>
      ) : null}
      {info ? (
        <p>
          {photo
            ? t("Account: {p0}", { p0: info.nickname })
            : t("Account: {p0} · up to {p1} seconds", {
                p0: info.nickname,
                p1: info.maxDurationSeconds,
              })}
        </p>
      ) : (
        <Notice kind={creator.isError ? "error" : "loading"}>
          {creator.isError
            ? browser
              ? t("Check the TikTok browser connection and the selected account, then try again.")
              : t(
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
      {browser ? (
        <XMediaFields
          value={variant.media}
          client={client}
          label={t("TikTok attachments")}
          help={t(
            "The video is uploaded to the selected host and attached through the browser. No TikTok API URL is needed.",
          )}
          videoOnly
          maxCount={1}
          showPreview
          onBusyChange={onBusyChange}
          onChange={(media) =>
            onChange({ media, tiktok: { ...options, durationSeconds: 0, consent: false } })
          }
          onVideoDurationChange={(duration) => {
            if (duration !== options.durationSeconds) change({ durationSeconds: duration });
          }}
        />
      ) : photo ? (
        <>
          <TextField
            disabled={socialLocked}
            label={t("Photo title")}
            maxLength={90}
            value={options.photoTitle ?? ""}
            onChange={(event) => change({ photoTitle: event.target.value })}
          />
          {Array.from({ length: Math.max(1, variant.media.length) }, (_, index) => (
            <div key={index}>
              <TextField
                disabled={socialLocked}
                label={t("Photo {p0} HTTPS URL", { p0: index + 1 })}
                type="url"
                value={variant.media[index]?.url ?? ""}
                onChange={(event) => {
                  const urls = variant.media.map((item) => item.url ?? "");
                  urls[index] = event.target.value;
                  changePhotos(urls);
                }}
              />
              {variant.media[index]?.url ? (
                <img
                  className="max-w-full"
                  src={variant.media[index].url}
                  alt={t("Photo {p0} preview", { p0: index + 1 })}
                  onLoad={() => {
                    const url = variant.media[index].url!;
                    setFailedPhotos((urls) => urls.filter((item) => item !== url));
                    setPreviewedPhotos((urls) => [...new Set([...urls, url])]);
                  }}
                  onError={() => {
                    const url = variant.media[index].url!;
                    setPreviewedPhotos((urls) => urls.filter((item) => item !== url));
                    setFailedPhotos((urls) => [...new Set([...urls, url])]);
                    if (options.consent) change({ consent: false });
                  }}
                />
              ) : null}
              {failedPhotos.includes(variant.media[index]?.url ?? "") ? (
                <Notice kind="error">
                  {t("Could not load the photo preview. Check the URL.")}
                </Notice>
              ) : null}
              {variant.media.length ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={socialLocked}
                  onClick={() =>
                    changePhotos(
                      variant.media
                        .filter((_, itemIndex) => itemIndex !== index)
                        .map((item) => item.url ?? ""),
                    )
                  }
                >
                  {t("Remove photo {p0}", { p0: index + 1 })}
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={socialLocked || !variant.media.length || variant.media.length >= 4}
            onClick={() => changePhotos([...variant.media.map((item) => item.url ?? ""), ""])}
          >
            {t("Add photo")}
          </Button>
          <small>
            {t(
              "Use up to four HTTPS photos on a TikTok-verified domain or URL prefix. Preview every photo before approval.",
            )}
          </small>
          <label>
            {t("Cover photo")}
            <NativeSelect
              aria-label={t("Cover photo")}
              value={options.photoCoverIndex ?? 0}
              disabled={socialLocked || !variant.media.length}
              onChange={(event) => change({ photoCoverIndex: Number(event.target.value) })}
            >
              {variant.media.map((_, index) => (
                <option key={index} value={index}>
                  {t("Photo {p0}", { p0: index + 1 })}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <Checkbox
              disabled={socialLocked}
              checked={options.autoAddMusic ?? false}
              onChange={(event) => change({ autoAddMusic: event.target.checked })}
            />
            {t("Let TikTok add recommended music")}
          </label>
        </>
      ) : (
        <>
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
                if (
                  Number.isFinite(duration) &&
                  duration > 0 &&
                  duration !== options.durationSeconds
                )
                  change({ durationSeconds: duration });
              }}
              onError={() => {
                if (options.durationSeconds) change({ durationSeconds: 0 });
              }}
            />
          ) : null}
        </>
      )}
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
          ...(!photo
            ? ([
                ["allowDuet", t("Allow Duet"), info?.duetDisabled],
                ["allowStitch", t("Allow Stitch"), info?.stitchDisabled],
              ] as const)
            : []),
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
            (photo
              ? !photoReady
              : !options.durationSeconds || options.durationSeconds > info.maxDurationSeconds)
          }
          onChange={(event) => change({ consent: event.target.checked })}
        />
        {photo
          ? t("I previewed every photo; I approve sending them to TikTok and the")
          : t("I previewed the video; I approve sending it to TikTok and the")}{" "}
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
        {browser
          ? t(
              "These choices are saved; sending also requires campaign approval and explicit send permission.",
            )
          : t(
              "These choices are saved; sending also requires campaign approval and explicit send permission. Public posting may be unavailable without TikTok app approval.",
            )}
      </small>
    </fieldset>
  );
}
