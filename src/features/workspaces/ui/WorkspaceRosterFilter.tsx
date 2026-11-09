import { t } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { RosterFilter } from "../model/workspacePresentation";

/** Exclusive roster view; combines with the text search in the toolbar. */
export function WorkspaceRosterFilter({
  value,
  onValueChange,
}: {
  value: RosterFilter;
  onValueChange: (value: RosterFilter) => void;
}) {
  return (
    <SegmentedControl
      label={t("Filter worktrees")}
      value={value}
      onValueChange={(next) => onValueChange(next as RosterFilter)}
      options={[
        { value: "all", label: t("All") },
        { value: "active", label: t("Active") },
        { value: "attention", label: t("Needs attention") },
      ]}
    />
  );
}
