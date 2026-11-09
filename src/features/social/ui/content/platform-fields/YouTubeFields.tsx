import { t } from "../../../../../shared/i18n";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { NativeSelect } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import type { YouTubeVideoOptions } from "../../../model/social";
import { YOUTUBE_TITLE_MAX } from "../contentRules";
import type { PlatformFieldProps } from "./PlatformFields";

/** YouTube video options. The post text is the description; the schedule is the post's time. */
export function YouTubeFields({ value, disabled, onChange }: PlatformFieldProps) {
  const options = value.youtube ?? {};
  const change = (patch: Partial<YouTubeVideoOptions>) =>
    onChange({ ...value, youtube: { ...options, ...patch } });
  const titleLength = Array.from(options.title ?? "").length;
  return (
    <fieldset className="content-platform" disabled={disabled}>
      <legend>{t("YouTube")}</legend>
      <TextField
        label={t("Title")}
        required
        value={options.title ?? ""}
        description={t("{p0} of {p1} characters", { p0: titleLength, p1: YOUTUBE_TITLE_MAX })}
        onChange={(event) => change({ title: event.target.value })}
      />
      <NativeSelect
        aria-label={t("Privacy")}
        value={options.privacy ?? ""}
        onChange={(event) =>
          change({ privacy: event.target.value as "private" | "unlisted" | "public" })
        }
      >
        <option value="" disabled>
          {t("Choose privacy")}
        </option>
        <option value="private">{t("Private")}</option>
        <option value="unlisted">{t("Unlisted")}</option>
        <option value="public">{t("Public")}</option>
      </NativeSelect>
      <Checkbox
        checked={options.madeForKids === true}
        onChange={(event) => change({ madeForKids: event.target.checked })}
        label={t("Made for kids")}
        className="content-check"
      />
      <Checkbox
        checked={options.containsSyntheticMedia === true}
        onChange={(event) => change({ containsSyntheticMedia: event.target.checked })}
        label={t("Contains altered or synthetic content")}
        className="content-check"
      />
    </fieldset>
  );
}
