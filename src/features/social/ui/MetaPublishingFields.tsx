import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import type { SocialMedia } from "../model/social";

/** Public URLs are fetched by Meta; local uploads use a separate browser connection. */
export function MetaPublishingFields({
  platform,
  value,
  onChange,
  disabled = false,
}: {
  platform: "instagram" | "facebook";
  value: SocialMedia[];
  onChange: (media: SocialMedia[]) => void;
  disabled?: boolean;
}) {
  useLocale();
  const update = (index: number, patch: Partial<SocialMedia>) =>
    onChange(value.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const reel = platform === "instagram" && value.length === 1 && value[0].kind === "video";
  return (
    <fieldset disabled={disabled}>
      <legend>{t("Meta media URLs")}</legend>
      {reel ? (
        <p role="status">{t("This video will publish as a Reel and appear in the feed.")}</p>
      ) : null}
      {value.map((item, index) => (
        <div key={index}>
          <TextField
            label={t("{p0} URL {p1}", {
              p0: item.kind === "video" ? t("Video") : t("Image"),
              p1: index + 1,
            })}
            type="url"
            required
            placeholder="https://"
            value={item.url ?? ""}
            onChange={(event) => update(index, { url: event.target.value })}
          />
          {item.kind === "image" ? (
            <TextField
              label={t("Image alt text")}
              maxLength={1000}
              value={item.alt ?? ""}
              onChange={(event) => update(index, { alt: event.target.value || undefined })}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            {t("Remove media {p0}", { p0: index + 1 })}
          </Button>
        </div>
      ))}
      <div className="social-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={value.length >= 4}
          onClick={() => onChange([...value, { kind: "image", url: "" }])}
        >
          {t("Add image URL")}
        </Button>
        {platform === "instagram" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={value.length >= 4}
            onClick={() => onChange([...value, { kind: "video", url: "" }])}
          >
            {t("Add video URL")}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
