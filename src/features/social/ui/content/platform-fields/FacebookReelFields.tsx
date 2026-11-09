import { t } from "../../../../../shared/i18n";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { REEL_MIN_FPS, isValidFrameRate } from "../contentRules";
import type { PlatformFieldProps } from "./PlatformFields";

/**
 * Reel options. Duration and size come from the attached video; the frame rate cannot be read in
 * the browser, so the owner enters it.
 */
export function FacebookReelFields({ value, media, disabled, onChange }: PlatformFieldProps) {
  const video = media.find((item) => item.media.kind === "video");
  const probe = video?.probe;
  const frameRate = value.facebook?.frameRate;
  const frameRateError = isValidFrameRate(frameRate)
    ? undefined
    : t("Enter the frame rate, at least {p0} fps.", { p0: REEL_MIN_FPS });
  return (
    <fieldset className="content-platform" disabled={disabled}>
      <legend>{t("Reel")}</legend>
      <p className="content-platform-note">
        {probe?.durationSeconds
          ? t("Video length {p0} seconds.", { p0: Math.round(probe.durationSeconds) })
          : t("Attach one 9:16 video to continue.")}
        {probe?.width && probe.height ? ` · ${probe.width} × ${probe.height}` : ""}
      </p>
      <NumberField
        label={t("Video frame rate (fps)")}
        min={REEL_MIN_FPS}
        step="any"
        required
        description={t("Check the file's frame rate. At least {p0} fps.", { p0: REEL_MIN_FPS })}
        value={value.facebook?.frameRate ?? ""}
        error={frameRateError}
        onChange={(event) =>
          onChange({
            ...value,
            facebook: {
              target: "reel",
              frameRate: event.target.value === "" ? undefined : Number(event.target.value),
            },
          })
        }
      />
    </fieldset>
  );
}
