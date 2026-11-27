import type { ReactNode, RefObject } from "react";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { t } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { Bot, FolderTree, GitBranch } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { CheckoutIdentity, CheckoutStatus } from "./CheckoutIdentity";
import { collapseAgentRows, worktreeGroupLabel, type WorktreeRow } from "../model/worktreeRows";

/** Active-path marker of the leading "All worktrees" row. */
export const ALL_WORKTREES_ACTIVE = "*all-worktrees*";
/** Active-path marker of the "… N more" row that ends a long agent group. */
export const MORE_AGENTS_ACTIVE = "*more-agents*";

/**
 * Controller for the one worktree list shared by the sidebar header and the composer
 * picker. Rows come from `worktreeRows`, so name, order and filter never differ.
 * Paths are compared by `pathKey`; `value` is the selected path.
 */
export function useWorktreeList({
  rows,
  value,
  activePath,
  onActivePathChange,
  inputRef,
  disabled = false,
  trailing,
  all,
  counts,
  agentsExpanded = false,
  onExpandAgents,
  onPick,
}: {
  rows: readonly WorktreeRow[];
  /** The selected worktree path, or null when none is. */
  value: string | null;
  activePath: string | null | undefined;
  onActivePathChange: (path: string | undefined) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  /** Non-interactive end content of a row, e.g. open tabs. */
  trailing?: (row: WorktreeRow) => ReactNode;
  onPick: (row: WorktreeRow) => void;
  /** A leading "All worktrees" row; `selected` takes the place of `value`. */
  all?: { selected: boolean; onPick: () => void; changes?: number };
  /** Uncommitted file count per worktree (by `pathKey`); a row without one shows a plain dot when dirty. */
  counts?: ReadonlyMap<string, number>;
  /** Long agent groups show five rows until expanded; picking "… N more" calls `onExpandAgents`. */
  agentsExpanded?: boolean;
  onExpandAgents?: () => void;
}) {
  const shown = onExpandAgents ? collapseAgentRows(rows, agentsExpanded) : { rows, hidden: 0 };
  const byKey = (key: string | null | undefined) =>
    key == null ? undefined : shown.rows.find((row) => pathKey(row.path) === key);
  const allOption = all
    ? [
        {
          value: ALL_WORKTREES_ACTIVE,
          title: t("All worktrees"),
          icon: <FolderTree className="icon-sm shrink-0" tone="secondary" />,
          disabled,
          trailing: all?.changes ? <CheckoutStatus changes={all.changes} /> : undefined,
        },
      ]
    : [];
  return usePickerList({
    options: [
      ...allOption,
      ...shown.rows.map((row) => ({
        value: pathKey(row.path),
        // The one row format: bold branch, muted folder, no text marker; the full path is the hint.
        title: (
          <Tooltip label={row.path} asChild>
            <span className="flex min-w-0" data-current-checkout={row.current || undefined}>
              <CheckoutIdentity icon={false} title={row.title} detail={row.detail} />
            </span>
          </Tooltip>
        ),
        textValue: `${row.title} ${row.folder}`,
        group: worktreeGroupLabel(
          row.group,
          rows.filter((other) => other.group === row.group).length,
        ),
        icon: row.agent ? (
          <Bot className="icon-sm shrink-0" tone="secondary" />
        ) : (
          <GitBranch className="icon-sm shrink-0" tone="secondary" />
        ),
        trailing: (
          <>
            <CheckoutStatus
              changes={counts?.get(pathKey(row.path))}
              dirty={row.tree.dirty}
              ahead={row.tree.unpushed ?? 0}
            />
            {trailing?.(row)}
          </>
        ),
        disabled,
      })),
      ...(shown.hidden
        ? [
            {
              value: MORE_AGENTS_ACTIVE,
              title: t("… {p0} more", { p0: shown.hidden }),
              textValue: "",
              group: worktreeGroupLabel(
                "agent",
                rows.filter((row) => row.group === "agent").length,
              ),
              disabled,
            },
          ]
        : []),
    ],
    value: all?.selected ? ALL_WORKTREES_ACTIVE : value == null ? null : pathKey(value),
    activeValue:
      activePath == null
        ? null
        : activePath === ALL_WORKTREES_ACTIVE || activePath === MORE_AGENTS_ACTIVE
          ? activePath
          : pathKey(activePath),
    onActiveValueChange: (key) =>
      onActivePathChange(
        key === ALL_WORKTREES_ACTIVE || key === MORE_AGENTS_ACTIVE ? key : byKey(key)?.path,
      ),
    inputRef,
    onChange: (key) => {
      if (key === ALL_WORKTREES_ACTIVE) return all?.onPick();
      if (key === MORE_AGENTS_ACTIVE) return onExpandAgents?.();
      const row = byKey(key);
      if (row) onPick(row);
    },
  });
}

/** The list body: loading, empty and rows for a controller from `useWorktreeList`. */
export function WorktreeList({
  controller,
  loading,
}: {
  controller: ReturnType<typeof useWorktreeList>;
  loading: boolean;
}) {
  return (
    <PickerList
      label={t("Worktrees")}
      controller={controller}
      loading={loading}
      loadingLabel={t("Loading worktrees…")}
      emptyLabel={t("No matching worktrees")}
      className="min-h-0 overflow-y-auto"
    />
  );
}
