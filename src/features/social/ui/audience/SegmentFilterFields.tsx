import type { ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { Text } from "../../../../shared/ui/Text";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TagInput } from "../../../../shared/ui/TagInput";
import { TextField } from "../../../../shared/ui/TextField";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_NAMES, type SocialPlatform } from "../../model/social";
import type { AudienceFilter, InteractionKind, PersonStage } from "../../model/audience";
import { PlatformIcon } from "../common/PlatformIcon";
import {
  ALL_STAGES,
  filterSummary,
  interactionLabel,
  stageLabel,
  stageTone,
  uniqueTags,
} from "./audienceModel";
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
  disabled,
}: {
  legend: string;
  options: readonly { value: T; label: ReactNode }[];
  selected: readonly T[] | undefined;
  onToggle: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <FieldGroup legend={legend} layout="row" gap="sm" disabled={disabled}>
      {options.map((option) => (
        <Checkbox
          checked={selected?.includes(option.value) ?? false}
          onChange={() => onToggle(option.value)}
          label={option.label}
          key={option.value}
          tone="primary"
          size="secondary"
          leading="inherit"
          className="audience-check"
        />
      ))}
    </FieldGroup>
  );
}

/** How many of the optional conditions (tags, language, score, text) are set. */
function detailCount(filter: AudienceFilter): number {
  return [filter.tags?.length, filter.language, filter.minScore !== undefined, filter.query].filter(
    Boolean,
  ).length;
}

/**
 * Conditions of a segment: the pickers people use most (accounts, stage, how they came in) first,
 * the rest behind one disclosure that opens by itself when a condition in it is set. Every
 * condition is optional; the caller decides whether an empty filter is allowed.
 */
export function SegmentFilterFields({
  value,
  onChange,
  disabled,
}: {
  value: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  disabled?: boolean;
}) {
  const summary = filterSummary(value);
  const extra = detailCount(value);
  return (
    <div className="audience-stack">
      <Text as="p" tone="secondary" className="audience-muted">
        {summary.length
          ? t("People who match all of: {p0}.", { p0: summary.join("; ") })
          : t("No conditions yet. Pick at least one below.")}
      </Text>
      <CheckGroup<SocialPlatform>
        legend={t("Accounts on")}
        disabled={disabled}
        options={SOCIAL_PLATFORMS.map((platform) => ({
          value: platform,
          label: (
            <span className="audience-choice">
              <PlatformIcon platform={platform} />
              <span>{SOCIAL_PLATFORM_NAMES[platform]}</span>
            </span>
          ),
        }))}
        selected={value.platforms}
        onToggle={(platform) =>
          onChange(withFilterField(value, { platforms: toggle(value.platforms, platform) }))
        }
      />
      <CheckGroup<PersonStage>
        legend={t("Stage is one of")}
        disabled={disabled}
        options={ALL_STAGES.map((stage) => ({
          value: stage,
          label: (
            <Badge size="sm" tone={stageTone(stage)}>
              {stageLabel(stage)}
            </Badge>
          ),
        }))}
        selected={value.stages}
        onToggle={(stage) =>
          onChange(withFilterField(value, { stages: toggle(value.stages, stage) }))
        }
      />
      <CheckGroup<InteractionKind>
        legend={t("Came in through")}
        disabled={disabled}
        options={SOURCE_KINDS.map((kind) => ({
          value: kind,
          label: <span>{interactionLabel(kind)}</span>,
        }))}
        selected={value.sources}
        onToggle={(kind) =>
          onChange(withFilterField(value, { sources: toggle(value.sources, kind) }))
        }
      />
      <Disclosure summary={t("More conditions")} count={extra || undefined} defaultOpen={extra > 0}>
        <div className="audience-stack">
          <TagInput
            label={t("Has all of these tags")}
            placeholder={t("Add a tag")}
            value={value.tags ?? []}
            inputProps={{ disabled }}
            normalize={(values) => uniqueTags(values).slice(0, 40)}
            onValueChange={(tags) => onChange(withFilterField(value, { tags: uniqueTags(tags) }))}
          />
          <div className="audience-pair">
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
          </div>
          <TextField
            label={t("Name or text contains")}
            value={value.query ?? ""}
            disabled={disabled}
            onChange={(event) => onChange(withFilterField(value, { query: event.target.value }))}
          />
        </div>
      </Disclosure>
    </div>
  );
}
