import { t } from "../../../../shared/i18n";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TagInput } from "../../../../shared/ui/TagInput";
import { TextField } from "../../../../shared/ui/TextField";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_NAMES, type SocialPlatform } from "../../model/social";
import type { AudienceFilter, InteractionKind, PersonStage } from "../../model/audience";
import { ALL_STAGES, interactionLabel, stageLabel, uniqueTags } from "./audienceModel";
import "./audience.css";

const SOURCE_KINDS: readonly InteractionKind[] = [
  "comment",
  "like",
  "share",
  "quote",
  "mention",
  "dm",
  "follower",
  "search",
  "reply",
  "import",
  "email",
];

/** Writes one filter field and drops it again when it is emptied, so an empty filter stays empty. */
export function withFilterField(filter: AudienceFilter, patch: AudienceFilter): AudienceFilter {
  const next: AudienceFilter = { ...filter, ...patch };
  for (const key of Object.keys(next) as (keyof AudienceFilter)[]) {
    const value = next[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    }
  }
  return next;
}

function toggle<T>(values: readonly T[] | undefined, value: T): T[] {
  const current = values ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function CheckGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  selected: readonly T[] | undefined;
  onToggle: (value: T) => void;
}) {
  return (
    <FieldGroup legend={legend} gap="sm">
      {options.map((option) => (
        <Checkbox
          checked={selected?.includes(option.value) ?? false}
          onChange={() => onToggle(option.value)}
          label={<span>{option.label}</span>}
          key={option.value}
          className="audience-check"
        />
      ))}
    </FieldGroup>
  );
}

/** Conditions of a segment. Every condition is optional; the caller decides whether an empty filter is allowed. */
export function SegmentFilterFields({
  value,
  onChange,
  disabled,
}: {
  value: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  disabled?: boolean;
}) {
  return (
    <div className="audience-stack">
      <TagInput
        label={t("Has all of these tags")}
        placeholder={t("Add a tag")}
        value={value.tags ?? []}
        inputProps={{ disabled }}
        normalize={(values) => uniqueTags(values).slice(0, 40)}
        onValueChange={(tags) => onChange(withFilterField(value, { tags: uniqueTags(tags) }))}
      />
      <TextField
        label={t("Language")}
        placeholder={t("For example en or tr")}
        value={value.language ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange(withFilterField(value, { language: event.target.value.trim() }))
        }
      />
      <NumberField
        label={t("Minimum interest score")}
        min={0}
        max={100}
        value={value.minScore === undefined ? "" : String(value.minScore)}
        disabled={disabled}
        onChange={(event) => {
          const parsed = event.target.value === "" ? undefined : Number(event.target.value);
          onChange(
            withFilterField(value, {
              minScore: parsed === undefined || Number.isNaN(parsed) ? undefined : parsed,
            }),
          );
        }}
      />
      <TextField
        label={t("Name or text contains")}
        value={value.query ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(withFilterField(value, { query: event.target.value }))}
      />
      <CheckGroup<SocialPlatform>
        legend={t("Accounts on")}
        options={SOCIAL_PLATFORMS.map((platform) => ({
          value: platform,
          label: SOCIAL_PLATFORM_NAMES[platform],
        }))}
        selected={value.platforms}
        onToggle={(platform) =>
          onChange(withFilterField(value, { platforms: toggle(value.platforms, platform) }))
        }
      />
      <CheckGroup<PersonStage>
        legend={t("Stage is one of")}
        options={ALL_STAGES.map((stage) => ({ value: stage, label: stageLabel(stage) }))}
        selected={value.stages}
        onToggle={(stage) =>
          onChange(withFilterField(value, { stages: toggle(value.stages, stage) }))
        }
      />
      <CheckGroup<InteractionKind>
        legend={t("Came in through")}
        options={SOURCE_KINDS.map((kind) => ({ value: kind, label: interactionLabel(kind) }))}
        selected={value.sources}
        onToggle={(kind) =>
          onChange(withFilterField(value, { sources: toggle(value.sources, kind) }))
        }
      />
    </div>
  );
}
