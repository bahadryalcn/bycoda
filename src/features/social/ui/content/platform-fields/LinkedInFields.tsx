import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { Select } from "../../../../../shared/ui/Select";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { TextField } from "../../../../../shared/ui/TextField";
import type { LinkedInPostFormat } from "../../../model/social";
import type { PlatformFieldProps } from "./PlatformFields";

const durations = ["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"] as const;

export function linkedInPollDurations() {
  return durations.map((value, index) => ({
    value,
    label: index === 0 ? t("1 day") : t("{p0} days", { p0: [1, 3, 7, 14][index] }),
  }));
}

export function LinkedInFields({ value, disabled, onChange }: PlatformFieldProps) {
  const format = value.linkedinFormat;
  const change = (linkedinFormat?: LinkedInPostFormat) => onChange({ ...value, linkedinFormat });
  return (
    <FieldGroup
      legend="LinkedIn"
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <Select
        label={t("Post format")}
        value={format?.kind ?? "post"}
        options={[
          { value: "post", label: t("Post") },
          { value: "poll", label: t("Poll") },
          { value: "article", label: t("Article link") },
        ]}
        onValueChange={(kind) => {
          if (kind === "poll")
            change({ kind, question: "", options: ["", ""], duration: "THREE_DAYS" });
          else if (kind === "article") change({ kind, source: "", title: "" });
          else change();
        }}
      />
      {format?.kind === "poll" ? (
        <>
          <TextField
            label={t("Poll question")}
            value={format.question}
            required
            maxLength={140}
            onChange={(event) => change({ ...format, question: event.target.value })}
          />
          {[0, 1, 2, 3].map((index) => (
            <TextField
              key={index}
              label={t("Option {p0}", { p0: index + 1 })}
              value={format.options[index] ?? ""}
              required={index < 2}
              maxLength={30}
              onChange={(event) => {
                const options = Array.from(
                  { length: 4 },
                  (_, position) => format.options[position] ?? "",
                );
                options[index] = event.target.value;
                change({ ...format, options });
              }}
            />
          ))}
          <Select
            label={t("Poll duration")}
            value={format.duration}
            options={linkedInPollDurations()}
            onValueChange={(next) => {
              const duration = durations.find((value) => value === next);
              if (duration) change({ ...format, duration });
            }}
          />
        </>
      ) : null}
      {format?.kind === "article" ? (
        <>
          <TextField
            label={t("Article URL")}
            type="url"
            required
            value={format.source}
            onChange={(event) => change({ ...format, source: event.target.value })}
          />
          <TextField
            label={t("Title")}
            required
            value={format.title}
            maxLength={399}
            onChange={(event) => change({ ...format, title: event.target.value })}
          />
          <TextField
            label={t("Description")}
            value={format.description ?? ""}
            maxLength={4085}
            onChange={(event) => change({ ...format, description: event.target.value })}
          />
        </>
      ) : null}
    </FieldGroup>
  );
}
