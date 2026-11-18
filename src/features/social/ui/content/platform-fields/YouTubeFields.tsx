import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Select } from "../../../../../shared/ui/Select";
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
    <FieldGroup
      legend={t("YouTube")}
      hideLegend
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <TextField
        label={t("Title")}
        required
        value={options.title ?? ""}
        description={t("{p0} of {p1} characters", { p0: titleLength, p1: YOUTUBE_TITLE_MAX })}
        onChange={(event) => change({ title: event.target.value })}
      />
      <Select
        label={t("Format")}
        value={options.format ?? "video"}
        options={[
          { value: "video", label: t("Video") },
          { value: "short", label: t("Short") },
        ]}
        onValueChange={(format) => change({ format: format === "short" ? "short" : "video" })}
      />
      <Select
        label={t("Privacy")}
        value={options.privacy ?? ""}
        options={[
          { value: "", label: t("Choose privacy"), disabled: true },
          { value: "private", label: t("Private") },
          { value: "unlisted", label: t("Unlisted") },
          { value: "public", label: t("Public") },
        ]}
        onValueChange={(privacy) => change({ privacy: privacy as YouTubeVideoOptions["privacy"] })}
      />
      <Checkbox
        checked={options.madeForKids === true}
        onChange={(event) => change({ madeForKids: event.target.checked })}
        label={t("Made for kids")}
        size="body"
        leading="inherit"
        className="content-check"
      />
      <Checkbox
        checked={options.containsSyntheticMedia === true}
        onChange={(event) => change({ containsSyntheticMedia: event.target.checked })}
        label={t("Contains altered or synthetic content")}
        size="body"
        leading="inherit"
        className="content-check"
      />
    </FieldGroup>
  );
}
