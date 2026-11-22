import type { ReactNode, RefObject } from "react";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { t } from "../../../shared/i18n/git";
import { pathKey } from "../../../shared/lib/paths";
import { FolderTree, GitBranch } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { CheckoutIdentity, CheckoutStatus } from "./CheckoutIdentity";
import { worktreeGroupLabel, type WorktreeRow } from "../model/worktreeRows";

/** Active-path marker of the leading "All worktrees" row. */
export const ALL_WORKTREES_ACTIVE = "*all-worktrees*";

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
  all?: { selected: boolean; onPick: () => void };
}) {
  const byKey = (key: string | null | undefined) =>
    key == null ? undefined : rows.find((row) => pathKey(row.path) === key);
  const allOption = all
    ? [
        {
          value: ALL_WORKTREES_ACTIVE,
          title: t("All worktrees"),
          icon: <FolderTree className="icon-sm shrink-0" tone="secondary" />,
          disabled,
        },
      ]
    : [];
  return usePickerList({
    options: [
      ...allOption,
      ...rows.map((row) => ({
        value: pathKey(row.path),
        // The one row format: bold branch, muted folder, marker; the full path is the hint.
        title: (
          <Tooltip label={row.path} asChild>
            <span className="flex min-w-0">
              <CheckoutIdentity
                icon={false}
                title={row.title}
                detail={row.folder}
                marker={row.current ? t("This session") : undefined}
              />
            </span>
          </Tooltip>
        ),
        textValue: `${row.title} ${row.folder}`,
        group: worktreeGroupLabel(
          row.group,
          rows.filter((other) => other.group === row.group).length,
        ),
        icon: <GitBranch className="icon-sm shrink-0" tone="secondary" />,
        trailing: (
          <>
            <CheckoutStatus dirty={row.tree.dirty} ahead={row.tree.unpushed ?? 0} />
            {trailing?.(row)}
          </>
        ),
        disabled,
      })),
    ],
    value: all?.selected ? ALL_WORKTREES_ACTIVE : value == null ? null : pathKey(value),
    activeValue:
      activePath == null
        ? null
        : activePath === ALL_WORKTREES_ACTIVE
          ? ALL_WORKTREES_ACTIVE
          : pathKey(activePath),
    onActiveValueChange: (key) =>
      onActivePathChange(key === ALL_WORKTREES_ACTIVE ? key : byKey(key)?.path),
    inputRef,
    onChange: (key) => {
      if (key === ALL_WORKTREES_ACTIVE) return all?.onPick();
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
