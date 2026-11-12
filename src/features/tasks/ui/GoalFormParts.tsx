import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { MAX_RUNNING_TASKS_LIMIT } from "../model/hostSettings";
import "./task-goals.css";

/** A titled group of goal settings. Option rows sit in one hairline frame; other content is `framed={false}`. */
export function GoalSection({
  title,
  framed = true,
  children,
}: {
  title: string;
  framed?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="goal-section" aria-label={title}>
      <SectionLabel as="h3">{title}</SectionLabel>
      <div
        {...surfaceAttributes(
          framed ? { frame: "card", edge: "all", radius: "card" } : {},
          framed ? "goal-section-rows" : "goal-section-pad",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A settings-style row: title and one muted line on the left, the control on the right. */
export function GoalOption({
  title,
  description,
  reason,
  disabled,
  children,
}: {
  title: string;
  description?: string;
  /** Why the row is unavailable; stays visible while `disabled`. */
  reason?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="goal-option" data-disabled={disabled || undefined}>
      <span className="goal-option-text">
        <Text as="span" size="secondary" tone={disabled ? "disabled" : "primary"} leading="inherit">
          {title}
        </Text>
        {description ? (
          <Text size="micro" tone="secondary" leading="inherit" className="goal-option-description">
            {description}
          </Text>
        ) : null}
        {disabled && reason ? (
          <Text size="micro" tone="muted" leading="inherit" className="goal-option-reason">
            {reason}
          </Text>
        ) : null}
      </span>
      <span className="goal-option-control">{children}</span>
    </div>
  );
}

/** A choice saved with the form (Plan it / Save): a Checkbox at the end of a shared form row. */
export function GoalCheckOption({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <GoalOption title={title} description={description}>
      <Checkbox
        aria-label={title}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </GoalOption>
  );
}

/** `0` is the machine's own limit; the rest cap this goal's running tasks. */
export function GoalConcurrencyOption({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <GoalOption
      title={t("Concurrent tasks in this goal")}
      description={t("How many of this goal's tasks may run at once.")}
    >
      <SearchableSelect
        hideLabel
        label={t("Concurrent tasks in this goal")}
        searchable={false}
        value={String(value)}
        options={[
          { value: "0", label: t("Use machine limit") },
          ...Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
            value: String(index + 1),
            label: String(index + 1),
          })),
        ]}
        onChange={(next) => onChange(Number(next))}
      />
    </GoalOption>
  );
}

export function GoalExecutionModeOption({
  isolate,
  description,
  disabled,
  onChange,
}: {
  isolate?: boolean;
  description?: string;
  disabled?: boolean;
  onChange: (isolate: boolean | undefined) => void;
}) {
  return (
    <GoalOption title={t("Execution mode")} description={description} disabled={disabled}>
      <Select
        hideLabel
        disabled={disabled}
        label={t("Execution mode")}
        value={isolate === undefined ? "automatic" : isolate ? "isolated" : "shared"}
        options={[
          { value: "automatic", label: t("Automatic") },
          { value: "shared", label: t("Shared checkout") },
          { value: "isolated", label: t("Separate worktree") },
        ]}
        onValueChange={(value) =>
          onChange(value === "automatic" ? undefined : value === "isolated")
        }
      />
    </GoalOption>
  );
}
