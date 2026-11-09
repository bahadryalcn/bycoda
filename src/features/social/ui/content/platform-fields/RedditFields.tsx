import { t } from "../../../../../shared/i18n";
import { TextField } from "../../../../../shared/ui/TextField";
import type { PlatformFieldProps } from "./PlatformFields";

/** Reddit: exactly one subreddit per post. Each subreddit has its own rules. */
export function RedditFields({ value, disabled, onChange }: PlatformFieldProps) {
  const options = value.reddit ?? { subreddit: "", flair: "" };
  return (
    <fieldset className="content-platform" disabled={disabled}>
      <legend>{t("Reddit")}</legend>
      <TextField
        label={t("Subreddit")}
        required
        value={options.subreddit}
        description={t("One subreddit per post. Check the subreddit rules before posting.")}
        onChange={(event) =>
          onChange({
            ...value,
            reddit: { ...options, subreddit: event.target.value.replace(/^r\//i, "") },
          })
        }
      />
      <TextField
        label={t("Flair (optional)")}
        value={options.flair}
        onChange={(event) =>
          onChange({ ...value, reddit: { ...options, flair: event.target.value } })
        }
      />
    </fieldset>
  );
}
