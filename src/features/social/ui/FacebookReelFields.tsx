import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import type { CampaignVariant } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { XMediaFields } from "./XMediaFields";
import { useState } from "react";

export function validFacebookReel(variant: CampaignVariant) {
  const reel = variant.facebook;
  if (!reel) return true;
  const media = variant.media[0];
  return (
    reel.target === "reel" &&
    variant.media.length === 1 &&
    media?.kind === "video" &&
    Boolean(media.uploadId) &&
    !media.url &&
    !media.alt &&
    !media.title &&
    Number.isFinite(reel.durationSeconds) &&
    reel.durationSeconds >= 4 &&
    reel.durationSeconds <= 60 &&
    Number.isSafeInteger(reel.width) &&
    reel.width >= 540 &&
    Number.isSafeInteger(reel.height) &&
    reel.height >= 960 &&
    reel.width * 16 === reel.height * 9 &&
    Number.isFinite(reel.frameRate) &&
    reel.frameRate >= 23
  );
}

/** Feed and Reel are different publishing destinations; a video never changes the target implicitly. */
export function FacebookReelFields({
  variant,
  client,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  variant: CampaignVariant;
  client: SocialClient;
  onChange: (patch: Partial<CampaignVariant>) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const reel = variant.facebook;
  return (
    <fieldset disabled={disabled || busy}>
      <legend>{t("Facebook destination")}</legend>
      <SegmentedControl
        label={t("Facebook destination")}
        value={reel ? "reel" : "feed"}
        options={[
          { value: "feed", label: t("Page feed") },
          { value: "reel", label: "Reel" },
        ]}
        onValueChange={(target) => {
          if (disabled || busy) return;
          if ((target === "reel") === Boolean(reel)) return;
          onChange({
            media: [],
            facebook:
              target === "reel"
                ? { target: "reel", durationSeconds: 0, width: 0, height: 0, frameRate: 0 }
                : undefined,
          });
        }}
      />
      {reel ? (
        <>
          <XMediaFields
            value={variant.media}
            client={client}
            label={t("Facebook Reel video")}
            help={t(
              "Use one MP4 up to 64 MiB, 4–60 seconds, at least 540 × 960 pixels in 9:16, and at least 23 fps.",
            )}
            videoOnly
            maxCount={1}
            maxVideoMiB={64}
            showPreview
            allowAltText={false}
            disabled={disabled}
            onBusyChange={(value) => {
              setBusy(value);
              onBusyChange?.(value);
            }}
            onChange={(media) =>
              onChange({
                media,
                facebook: { ...reel, durationSeconds: 0, width: 0, height: 0, frameRate: 0 },
              })
            }
            onVideoMetadataChange={(metadata) =>
              onChange({
                facebook: {
                  ...reel,
                  durationSeconds: metadata?.durationSeconds ?? 0,
                  width: metadata?.width ?? 0,
                  height: metadata?.height ?? 0,
                },
              })
            }
          />
          <TextField
            label={t("Video frame rate (fps)")}
            type="number"
            min={23}
            step="any"
            required
            disabled={disabled}
            value={reel.frameRate || ""}
            onChange={(event) =>
              onChange({ facebook: { ...reel, frameRate: Number(event.target.value) } })
            }
          />
          <small>
            {t(
              "Enter the actual frame rate from the video file. It is not inferred from playback.",
            )}
          </small>
          {variant.media.length ? (
            <p>
              {reel.durationSeconds}s · {reel.width} × {reel.height}
            </p>
          ) : null}
          {!validFacebookReel(variant) ? (
            <p role="alert">
              {t("Upload a compatible Reel and enter its frame rate before saving.")}
            </p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
