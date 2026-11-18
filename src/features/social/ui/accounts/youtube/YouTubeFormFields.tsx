import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../../shared/i18n";
import { isoTimestamp } from "../../../../../shared/lib/time/timestamps";
import { DatePicker } from "../../../../../shared/ui/DatePicker";
import { DateTimePicker } from "../../../../../shared/ui/DateTimePicker";
import { FileField } from "../../../../../shared/ui/FileField";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { Select } from "../../../../../shared/ui/Select";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import { presentRemoteError } from "../../../../connections/public/remoteFailure";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import { listRows } from "./YouTubeResult";
import type { YouTubeDraft, YouTubeForm, YouTubeFormField, YouTubeRefSource } from "./youtubeForms";
import { youtubeRefOptions } from "./youtubeItems";

function fieldValue(field: YouTubeFormField, value: string) {
  if (field.type === "number") return Number(value);
  if (field.type === "datetime") return value === "" ? null : isoTimestamp(Date.parse(value));
  if (field.type === "lines")
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  if (field.type === "links")
    return value
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const split = line.indexOf("|");
        if (split < 0)
          throw new Error(t("One link per line in Name | https://example.com format."));
        return { title: line.slice(0, split).trim(), url: line.slice(split + 1).trim() };
      });
  return field.choices && (value === "true" || value === "false") ? value === "true" : value;
}

/** Reads, previews and report forms open with their first choice; writes make the owner choose. */
export function withDefaults(form: YouTubeForm, draft: YouTubeDraft): YouTubeDraft {
  if (form.write) return draft;
  const next = { ...draft };
  for (const field of form.fields ?? [])
    if (field.required && field.choices?.length && next[field.key] === undefined)
      next[field.key] = field.choices[0]!.value;
  return next;
}

export async function youtubePayload(
  form: YouTubeForm,
  draft: YouTubeDraft,
  accountId: string,
  upload?: SocialClient["upload"],
) {
  const input: Record<string, unknown> = { accountId, ...form.fixed };
  const patch: Record<string, unknown> = {};
  for (const field of form.fields ?? []) {
    const raw = draft[field.key];
    if (raw === undefined) continue;
    if (raw === "" && !field.emptyAllowed) continue;
    const entry = form.fieldsInPatch?.includes(field.key) ? patch : input;
    if (Array.isArray(raw)) {
      if (!raw.length) continue;
      const ids = upload
        ? await Promise.all(raw.map(async (file) => (await upload(file)).uploadId))
        : raw.map((file) => file.name);
      entry[field.key] = field.multiple ? ids : ids[0];
    } else {
      entry[field.key] = fieldValue(field, raw);
    }
  }
  if (form.fieldsInPatch) input.patch = patch;
  return input;
}

type FieldProps = {
  field: YouTubeFormField;
  value?: string | File[];
  disabled: boolean;
  set(value: string | File[]): void;
  /** Placeholder of an unset optional choice: a filter says "Any", an edit says "No change". */
  unset: string;
};

export function FormField({ field, value, disabled, set, unset }: FieldProps) {
  const { label, description, required } = field;
  const input = typeof value === "string" ? value : "";
  const props = { label, disabled, required };
  if (field.choices)
    return (
      <Select
        label={label}
        value={input}
        disabled={disabled}
        onValueChange={set}
        options={[
          required
            ? { value: "", label: t("Choose an option"), disabled: true }
            : { value: "", label: unset },
          ...field.choices,
        ]}
      />
    );
  if (field.type === "images")
    return (
      <FileField
        label={label}
        disabled={disabled}
        multiple={field.multiple}
        description={Array.isArray(value) ? value.map((file) => file.name).join(", ") : description}
        accept="image/png,image/jpeg"
        onFiles={set}
      />
    );
  if (field.type === "date") return <DatePicker {...props} value={input} onChange={set} />;
  if (field.type === "datetime") return <DateTimePicker {...props} value={input} onChange={set} />;
  if (field.type === "number")
    return (
      <NumberField {...props} value={input} min={0} onChange={(event) => set(event.target.value)} />
    );
  if (field.type === "textarea" || field.type === "lines" || field.type === "links")
    return (
      <TextareaField
        {...props}
        description={description}
        value={input}
        minRows={2}
        onChange={(event) => set(event.target.value)}
      />
    );
  return (
    <TextField
      {...props}
      description={description}
      value={input}
      onChange={(event) => set(event.target.value)}
    />
  );
}

/** An identifier field the owner picks from the account's own list instead of typing. */
export function RefField({
  client,
  accountId,
  source,
  field,
  value,
  disabled,
  enabled,
  set,
  unset,
}: {
  client: SocialClient;
  accountId: string;
  source: YouTubeRefSource;
  enabled: boolean;
  field: YouTubeFormField;
  value: string;
  disabled: boolean;
  set(value: string): void;
  unset: string;
}) {
  const query = useQuery({
    queryKey: [
      ...socialQueryScope(client),
      "youtube",
      accountId,
      "ref",
      source.action,
      JSON.stringify(source.input ?? {}),
    ],
    queryFn: () => client.request(source.action, { accountId, ...source.input }),
    staleTime: 30_000,
    enabled,
  });
  const rows = listRows(query.data);
  const options = youtubeRefOptions(rows, value);
  const placeholder = query.isPending
    ? t("Loading…")
    : field.required
      ? options.length
        ? t("Choose an option")
        : t("Nothing to choose from yet")
      : unset;
  return (
    <Select
      label={field.label}
      value={value}
      disabled={disabled || (field.required && !options.length)}
      error={
        query.isError
          ? presentRemoteError(query.error, { explicit: true }) ||
            t("Could not load this list. Enter an ID instead.")
          : undefined
      }
      onValueChange={set}
      options={[{ value: "", label: placeholder, disabled: Boolean(field.required) }, ...options]}
    />
  );
}
