import { t } from "../../../shared/i18n";
import type { PendingChange } from "../../../shared/ui/settings";
import type { PromptTemplate } from "../../sessions/public/promptTemplates";

const fields = () =>
  [
    ["name", t("Template name")],
    ["trigger", t("Template trigger")],
    ["body", t("Template text")],
  ] as const;

/**
 * Every unsaved template edit: added and removed templates and each changed field, grouped by
 * template, each revertible alone.
 */
export function templateChanges(
  rows: readonly PromptTemplate[],
  baseline: readonly PromptTemplate[],
  setRows: (rows: PromptTemplate[]) => void,
): PendingChange[] {
  const changes: PendingChange[] = [];
  for (const row of rows) {
    const before = baseline.find((entry) => entry.id === row.id);
    const scope = row.name || t("New template");
    if (!before) {
      changes.push({
        id: `${row.id}:new`,
        scope,
        label: t("New template"),
        revert: () => setRows(rows.filter((entry) => entry.id !== row.id)),
      });
      continue;
    }
    for (const [field, label] of fields()) {
      if ((row[field] ?? "") === (before[field] ?? "")) continue;
      changes.push({
        id: `${row.id}:${field}`,
        scope,
        label,
        revert: () =>
          setRows(
            rows.map((entry) =>
              entry.id === row.id ? { ...entry, [field]: before[field] } : entry,
            ),
          ),
      });
    }
  }
  baseline.forEach((before, index) => {
    if (rows.some((row) => row.id === before.id)) return;
    changes.push({
      id: `${before.id}:removed`,
      scope: before.name,
      label: t("Removed"),
      revert: () => {
        const next = [...rows];
        next.splice(Math.min(index, next.length), 0, before);
        setRows(next);
      },
    });
  });
  return changes;
}
