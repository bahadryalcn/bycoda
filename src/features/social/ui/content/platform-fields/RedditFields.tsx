import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { TextField } from "../../../../../shared/ui/TextField";
import type { PlatformFieldProps } from "./PlatformFields";
import { REDDIT_TITLE_LIMIT } from "../../../../../integrations/social/adapters/reddit-rules";

/** Reddit: exactly one subreddit per post. Each subreddit has its own rules. */
export function RedditFields({ account, value, disabled, onChange }: PlatformFieldProps) {
  const options = value.reddit ?? { subreddit: "", flair: "" };
  return (
    <FieldGroup
      legend={t("Reddit")}
      hideLegend
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <TextField
        label={t("Title")}
        required
        maxLength={REDDIT_TITLE_LIMIT}
        value={options.title ?? ""}
        onChange={(event) =>
          onChange({ ...value, reddit: { ...options, title: event.target.value } })
        }
      />
      <TextField
        label={account.connection === "browser" ? t("Community or profile") : t("Subreddit")}
        required
        value={
          account.connection === "browser"
            ? options.subreddit.replace(/^u_/i, "u/")
            : options.subreddit
        }
        description={
          account.connection === "browser"
            ? t("Enter r/community or u/your_username for your own profile.")
            : t("One subreddit per post. Check the subreddit rules before posting.")
        }
        onChange={(event) =>
          onChange({
            ...value,
            reddit: {
              ...options,
              subreddit: event.target.value.replace(/^r\//i, "").replace(/^u\//i, "u_"),
            },
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
    </FieldGroup>
  );
}
