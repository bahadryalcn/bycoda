import { Button } from "../../../shared/ui/Button";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { Text } from "../../../shared/ui/Text";
import { useId, type ReactNode } from "react";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { t, useLocale } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import type { CrewAgent, CrewPolicy } from "../model/crew";

export type CrewPolicyErrors = {
  maxParallel: string;
  maxAssignments: string;
  maxRunMinutes: string;
};

/** A compact titled block of settings; blocks are separated by spacing, not frames. */
function Section({
  title,
  description,
  info,
  children,
}: {
  title: string;
  /** Explanation behind an info icon, one paragraph per entry. */
  description?: string | string[];
  info?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const paragraphs = description ? [description].flat() : [];
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <SectionLabel as="h3" labelId={headingId}>
          {title}
        </SectionLabel>
        {info}
        {paragraphs.length ? (
          <InfoPopover label={t("About {p0}", { p0: title })}>
            {paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </InfoPopover>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">{children}</div>
    </section>
  );
}

/**
 * One setting: label and description on the left, the control close to it on the
 * right (or under the label for wide controls). The whole block stays inside its
 * column, so a label and its control are never pushed to opposite ends of a dialog.
 */
function Line({
  label,
  description,
  info,
  stacked = false,
  children,
}: {
  label: string;
  description?: string;
  info?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div
      className={`flex min-w-0 gap-x-3 gap-y-1.5 ${stacked ? "flex-col" : "flex-wrap items-center justify-between"}`}
    >
      <div className={`min-w-0 ${stacked ? "" : "flex-1 basis-40"}`}>
        <div className="flex min-w-0 items-center gap-1">
          <Text id={labelId} size="secondary" tone="inherit">
            {label}
          </Text>
          {info}
          {description ? (
            <InfoPopover label={t("About {p0}", { p0: label })}>
              <p>{description}</p>
            </InfoPopover>
          ) : null}
        </div>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className={`flex min-w-0 items-center gap-2 [&_.bycoda-arc-select]:min-h-(--ui-control-height-compact) [&_.bycoda-arc-select]:py-0 [&_.bycoda-arc]:[--control-height-md:var(--ui-control-height-compact)] ${stacked ? "" : "min-w-28 shrink-0 justify-end"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** A whole-number limit. An error moves the field under its label so the message has room. */
function LimitLine({
  label,
  description,
  min,
  max,
  value,
  error,
  onChange,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  value: number;
  error: string;
  onChange: (value: number) => void;
}) {
  return (
    <Line label={label} description={description} stacked={!!error}>
      <div className={error ? "w-full max-w-72" : "w-28"}>
        <NumberField
          label={label}
          hideLabel
          min={min}
          max={max}
          value={value}
          error={error || undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </Line>
  );
}

/**
 * The crew's advanced settings in two compact columns: model rules, execution limits,
 * appearance and maintenance. Permissions and bulk models live above the roster. Everything
 * except appearance is part of the crew draft. The draft stays with the editor; this
 * component only edits it. It lays out inside the editor's `crew-editor` container.
 */
export function CrewWorkingSettings({
  policy,
  errors,
  onPolicyChange,
  appearance,
  appearanceSavedNow,
  appearanceOnHost = false,
  maintenance,
}: {
  agents: CrewAgent[];
  policy: CrewPolicy;
  errors: CrewPolicyErrors;
  onPolicyChange: (patch: Partial<CrewPolicy>) => void;
  /** The appearance picker, owned by the editor. */
  appearance: ReactNode;
  /** Existing crew: appearance is already stored on this device; a new crew saves it on create. */
  appearanceSavedNow: boolean;
  /** Existing crew on a host that stores the look with the crew, shared by every device. */
  appearanceOnHost?: boolean;
  /** Copy and delete actions, owned by the editor. */
  maintenance?: ReactNode;
}) {
  useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-x-10 gap-y-5 @min-[48rem]/crew-editor:grid-cols-2">
        <Section title={t("Models")}>
          <Button variant="link" onClick={() => openModelsSettings("order")}>
            {t("Manage models")}
          </Button>
        </Section>

        <div className="flex min-w-0 flex-col gap-5">
          <Section title={t("Execution limits")}>
            <LimitLine
              label={t("Members working at once")}
              description={t("How many assignments can run at the same time.")}
              min={1}
              max={4}
              value={policy.maxParallel}
              error={errors.maxParallel}
              onChange={(value) => onPolicyChange({ maxParallel: value })}
            />
            <LimitLine
              label={t("Assignments per work")}
              description={t("The most assignments the coordinator can hand out for one work.")}
              min={1}
              max={20}
              value={policy.maxAssignments}
              error={errors.maxAssignments}
              onChange={(value) => onPolicyChange({ maxAssignments: value })}
            />
            <LimitLine
              label={t("Minutes per assignment")}
              description={t("An assignment running longer than this is stopped.")}
              min={1}
              max={240}
              value={policy.maxRunMinutes}
              error={errors.maxRunMinutes}
              onChange={(value) => onPolicyChange({ maxRunMinutes: value })}
            />
          </Section>
          <Section title={t("Appearance")}>
            <Line
              label={t("Crew icon and color")}
              description={
                appearanceOnHost
                  ? t("Saved with the crew and shown on every device.")
                  : appearanceSavedNow
                    ? t("Saved on this device right away.")
                    : t("Saved with the crew when you create it.")
              }
            >
              {appearance}
            </Line>
          </Section>
          {maintenance}
        </div>
      </div>
    </div>
  );
}
