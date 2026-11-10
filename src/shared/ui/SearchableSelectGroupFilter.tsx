import { useMemo } from "react";
import { t } from "../i18n";
import { SegmentedControl } from "./SegmentedControl";
import type { SearchableSelectOption } from "./SearchableSelect";

export const ALL_GROUPS = "";

/** "All" plus one entry per distinct `group`, in option order; empty when fewer than two groups exist. */
export function groupFilterSegments(options: readonly SearchableSelectOption[]) {
  const counts = new Map<string, number>();
  for (const option of options) {
    if (option.group) counts.set(option.group, (counts.get(option.group) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [
    { value: ALL_GROUPS, count: options.length, label: t("All") },
    ...[...counts].map(([value, count]) => ({ value, count, label: value })),
  ];
}

/** Options of the chosen group; ungrouped options (e.g. Global) show under "All" only. */
export function filterByGroup(options: readonly SearchableSelectOption[], group: string) {
  return group === ALL_GROUPS ? options : options.filter((option) => option.group === group);
}

/**
 * Single-row filter above a SearchableSelect list: "All" plus one entry per option group, with counts.
 * Internal to SearchableSelect (enable with its `groupFilter` prop); pointer presses keep focus in the search field.
 * @group choice
 * @use Only through SearchableSelect `groupFilter`.
 * @avoid Standalone filtering: SegmentedControl.
 */
export function SearchableSelectGroupFilter({
  options,
  value,
  onChange,
}: {
  options: readonly SearchableSelectOption[];
  value: string;
  onChange: (group: string) => void;
}) {
  const segments = useMemo(() => groupFilterSegments(options), [options]);
  if (segments.length === 0) return null;
  return (
    <div
      role="presentation"
      className="shrink-0 px-1 pt-1"
      onMouseDown={(event) => event.preventDefault()}
    >
      <SegmentedControl
        label={t("Filter")}
        selectionRole="pressed"
        value={segments.some((segment) => segment.value === value) ? value : ALL_GROUPS}
        onValueChange={onChange}
        options={segments.map((segment) => ({
          value: segment.value,
          label: segment.label,
          accessory: <span className="tabular-nums">{segment.count}</span>,
        }))}
      />
    </div>
  );
}
