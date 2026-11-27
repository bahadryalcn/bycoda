import { t } from "../../../../shared/i18n";
import type { PendingChange } from "../../../../shared/ui/settings";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import {
  MODEL_ROLE_METADATA,
  modelChoicesEqual,
  modelRoleGroupLabel,
  modelRoleLabel,
} from "../../model/modelRoutingRoles";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Background work draft against its saved document, one line per thing the owner would
 * name: the model list, each group, each job, each limit and the subagent defaults. Jobs and
 * limits revert alone; list and group edits revert with Discard.
 */
export function orderChanges(
  base: OrderDraft,
  draft: OrderDraft,
  onChange: (draft: OrderDraft) => void,
): PendingChange[] {
  const changes: PendingChange[] = [];
  const models = t("Models");
  const before = base.routing;
  const after = draft.routing;
  const added = after.entries.filter((entry) => !before.entries.some((old) => old.id === entry.id));
  const removed = before.entries.filter(
    (entry) => !after.entries.some((next) => next.id === entry.id),
  );
  if (added.length)
    changes.push({
      id: "entries:added",
      scope: models,
      label: t("Models added"),
      detail: String(added.length),
    });
  if (removed.length)
    changes.push({
      id: "entries:removed",
      scope: models,
      label: t("Models removed"),
      detail: String(removed.length),
    });
  const kept = after.entries.filter((entry) => before.entries.some((old) => old.id === entry.id));
  const edited = kept.filter((entry) => {
    const old = before.entries.find((candidate) => candidate.id === entry.id);
    return !same(old, entry) || base.percentages[entry.id] !== draft.percentages[entry.id];
  });
  if (edited.length)
    changes.push({
      id: "entries:edited",
      scope: models,
      label: t("Model settings"),
      detail: String(edited.length),
    });
  const keptBefore = before.entries.filter((entry) => kept.some((next) => next.id === entry.id));
  if (
    !same(
      kept.map((entry) => entry.id),
      keptBefore.map((entry) => entry.id),
    )
  )
    changes.push({ id: "entries:order", scope: models, label: t("Model order") });
  const groups = t("Groups");
  for (const pool of after.pools) {
    const old = before.pools.find((candidate) => candidate.id === pool.id);
    if (!old)
      changes.push({ id: `pool:${pool.id}`, scope: groups, label: pool.name, detail: t("New") });
    else if (!same(old, pool))
      changes.push({
        id: `pool:${pool.id}`,
        scope: groups,
        label: pool.name,
        detail: t("Changed"),
      });
  }
  for (const pool of before.pools)
    if (!after.pools.some((candidate) => candidate.id === pool.id))
      changes.push({
        id: `pool:${pool.id}`,
        scope: groups,
        label: pool.name,
        detail: t("Removed"),
      });
  for (const { role, labelKey, group } of MODEL_ROLE_METADATA) {
    if (modelChoicesEqual(after.roles[role], before.roles[role], role)) continue;
    const choice = after.roles[role];
    changes.push({
      id: `role:${role}`,
      scope: modelRoleGroupLabel(group),
      label: modelRoleLabel(labelKey),
      detail:
        choice?.kind === "pool"
          ? t("Group: {p0}", {
              p0: after.pools.find((pool) => pool.id === choice.poolId)?.name ?? t("Unnamed group"),
            })
          : choice?.kind === "fixed"
            ? t("Fixed model")
            : choice
              ? t("Any model, in order")
              : t("Automatic"),
      revert: () => {
        const roles = { ...draft.routing.roles };
        const saved = before.roles[role];
        if (saved) roles[role] = saved;
        else delete roles[role];
        onChange({ ...draft, routing: { ...draft.routing, roles } });
      },
    });
  }
  if (!same(before.delegation, after.delegation))
    changes.push({ id: "delegation", scope: t("Subagents"), label: t("Subagents and advisor") });
  const limits = t("Work limits");
  const limit = (id: string, label: string, differs: boolean, revert: () => OrderDraft) => {
    if (differs) changes.push({ id, scope: limits, label, revert: () => onChange(revert()) });
  };
  limit(
    "limit:tasks",
    t("Max concurrent tasks"),
    base.limits.maxRunningTasks !== draft.limits.maxRunningTasks,
    () => ({ ...draft, limits: { ...draft.limits, maxRunningTasks: base.limits.maxRunningTasks } }),
  );
  limit(
    "limit:minutes",
    t("Daily agent minutes"),
    base.limits.dailyAgentMinutes !== draft.limits.dailyAgentMinutes,
    () => ({
      ...draft,
      limits: { ...draft.limits, dailyAgentMinutes: base.limits.dailyAgentMinutes },
    }),
  );
  limit(
    "limit:run",
    t("Default maximum run minutes"),
    base.maxRunMinutes !== draft.maxRunMinutes,
    () => ({ ...draft, maxRunMinutes: base.maxRunMinutes }),
  );
  limit("limit:caps", t("Token and cost limits"), !same(base.workCaps, draft.workCaps), () => ({
    ...draft,
    workCaps: base.workCaps,
  }));
  return changes;
}
