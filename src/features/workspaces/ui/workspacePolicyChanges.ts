import { t } from "../../../shared/i18n";
import type { PendingChange } from "../../../shared/ui/settings";
import type { WorkspacePolicy } from "../model/contracts";
import { lifecycleLabel } from "../model/workspacePresentation";

const GIB = 1_073_741_824;
const DAY = 86_400_000;
const RETENTION_STATES = ["idle", "finished", "merged", "abandoned"] as const;

const retention = (period: number | "never") =>
  period === "never" ? t("Never") : t("{p0} days", { p0: period / DAY });
const same = (a: unknown, b: unknown) => Object.is(a, b) || (a !== a && b !== b);

/** Every unsaved field of the workspace policy draft, each revertible alone. */
export function workspacePolicyChanges(
  draft: WorkspacePolicy,
  saved: WorkspacePolicy,
  update: (next: WorkspacePolicy) => void,
): PendingChange[] {
  const changes: PendingChange[] = [];
  if (draft.defaultMode !== saved.defaultMode)
    changes.push({
      id: "defaultMode",
      label: t("Default workspace"),
      detail: draft.defaultMode === "worktree" ? t("Worktree") : t("Current checkout"),
      revert: () => update({ ...draft, defaultMode: saved.defaultMode }),
    });
  if (draft.pinned !== saved.pinned)
    changes.push({
      id: "pinned",
      label: t("Pin workspaces"),
      detail: draft.pinned ? t("On") : t("Off"),
      revert: () => update({ ...draft, pinned: saved.pinned }),
    });
  for (const state of RETENTION_STATES) {
    if (draft.retention[state] === saved.retention[state]) continue;
    changes.push({
      id: `retention:${state}`,
      scope: t("Automatic cleanup"),
      label: t("{p0} retention", { p0: lifecycleLabel(state) }),
      detail: retention(draft.retention[state] as number | "never"),
      revert: () =>
        update({ ...draft, retention: { ...draft.retention, [state]: saved.retention[state] } }),
    });
  }
  const limits = [
    ["budgetBytes", t("Directory budget (GiB)"), GIB],
    ["warningRatio", t("Warn at (%)"), 0.01],
    ["minimumFreeBytes", t("Minimum free space (GiB)"), GIB],
  ] as const;
  for (const [field, label, unit] of limits) {
    if (same(draft.disk[field], saved.disk[field])) continue;
    const value = draft.disk[field] / unit;
    changes.push({
      id: `disk:${field}`,
      scope: t("Limits"),
      label,
      detail: Number.isFinite(value) ? String(Math.round(value * 100) / 100) : undefined,
      revert: () => update({ ...draft, disk: { ...draft.disk, [field]: saved.disk[field] } }),
    });
  }
  return changes;
}
