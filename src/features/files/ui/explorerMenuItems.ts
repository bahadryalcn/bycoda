import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { IS_MAC, IS_WIN, MOD, SHIFT } from "../../../platform/tauri/platform";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import type { ExplorerMenuItem } from "./ExplorerMenu";
import type { Clip, MenuTarget } from "./fileTreeSupport";
import { parentPath } from "../../../shared/lib/paths";

export const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

/** Menu item ids that mutate the filesystem or start another operation: disabled while one runs. */
export const BUSY_MENU_ITEMS = [
  "new-file",
  "new-folder",
  "cut",
  "paste",
  "duplicate",
  "rename",
  "delete",
  "reveal",
];

/** Where a context-menu create lands: folders and the root create inside themselves, a file beside itself. */
export function menuCreateParent(target: MenuTarget): string {
  return target.isDir ? target.path : parentPath(target.path);
}

/**
 * Context menu for the root, a folder, a file or a multi-selection. `createInLabel` names the
 * folder New File / New Folder will create in, so the menu states the target it will use.
 */
export function explorerItems(
  target: MenuTarget,
  clip: Clip | null,
  canOpenTerminal: boolean,
  canInspectGit: boolean,
  selectionCount: number,
  canOpenSelection: boolean,
  createInLabel: string,
): ExplorerMenuItem[] {
  const pasteParent = menuCreateParent(target);
  const createIn = t("In {p0}", { p0: createInLabel });
  const pasteBlocked = clip?.entries.some(
    (entry) =>
      entry.isDir && (pasteParent === entry.path || pasteParent.startsWith(`${entry.path}/`)),
  );
  return [
    ...(selectionCount > 1 && canOpenSelection
      ? [{ kind: "item" as const, id: "open", label: t("Open"), shortcut: "Enter" }]
      : []),
    {
      kind: "item",
      id: "new-file",
      get label() {
        return t("New File");
      },
      description: createIn,
    },
    {
      kind: "item",
      id: "new-folder",
      get label() {
        return t("New Folder");
      },
      description: createIn,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "cut",
      get label() {
        return t("Cut");
      },
      shortcut: `${MOD}X`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "copy",
      get label() {
        return t("Copy");
      },
      shortcut: `${MOD}C`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "paste",
      get label() {
        return t("Paste");
      },
      shortcut: `${MOD}V`,
      disabled: pasteBlocked,
    },
    {
      kind: "item",
      id: "duplicate",
      get label() {
        return t("Duplicate");
      },
      disabled: target.isRoot,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "copy-path",
      get label() {
        return t("Copy Path");
      },
      shortcut: `${MOD}${SHIFT}C`,
    },
    {
      kind: "item",
      id: "copy-relative-path",
      get label() {
        return t("Copy Relative Path");
      },
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "rename",
      get label() {
        return t("Rename");
      },
      shortcut: "F2",
      disabled: target.isRoot || selectionCount > 1,
    },
    {
      kind: "item",
      id: "delete",
      get label() {
        return t("Delete");
      },
      shortcut: "⌫",
      disabled: target.isRoot,
      danger: true,
    },
    { kind: "sep" },
    ...(canInspectGit && !target.isDir && selectionCount <= 1
      ? [
          {
            kind: "item" as const,
            id: "git-history",
            get label() {
              return t("File History");
            },
          },
          {
            kind: "item" as const,
            id: "git-blame",
            get label() {
              return t("Blame");
            },
          },
          { kind: "sep" as const },
        ]
      : []),
    ...(canOpenTerminal
      ? [
          {
            kind: "item" as const,
            id: "open-terminal",
            get label() {
              return t("Open in Terminal");
            },
          },
        ]
      : []),
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
  ];
}

/**
 * Context menu with the busy-operation gate applied: nothing that mutates can start while one runs.
 * `createReason` (no usable root or machine) disables New File / New Folder alone and replaces their
 * "In {folder}" line with the reason, so the user sees why instead of a silent dead item.
 */
export function gateBusyMenuItems(
  items: ExplorerMenuItem[],
  busy: boolean,
  createReason?: string,
): ExplorerMenuItem[] {
  if (!busy && !createReason) return items;
  return items.map((item) => {
    if (item.kind !== "item") return item;
    const create = item.id === "new-file" || item.id === "new-folder";
    if (create && createReason) return { ...item, disabled: true, description: createReason };
    return busy && BUSY_MENU_ITEMS.includes(item.id) ? { ...item, disabled: true } : item;
  });
}

type HeaderMenuOptions = {
  /** The header is too narrow for Collapse All and Search as direct actions. */
  narrow: boolean;
  canSearch: boolean;
  /** Why creating is unavailable right now; absent when it is available. */
  busyReason?: string;
  showExcluded: boolean;
  excludedDefault: boolean;
};

/**
 * Explorer actions menu, in priority groups: creation, then (only when the header is
 * too narrow for direct icons) tree management and search, then the rarely used reveal and
 * view preferences. Collapse All and Search live in the header; the menu repeats them only
 * when they would otherwise be unreachable.
 */
export function explorerHeaderItems(
  { narrow, canSearch, busyReason, showExcluded, excludedDefault }: HeaderMenuOptions,
  icon: (id: "new-file" | "new-folder" | "collapse" | "search" | "reveal") => ReactNode,
): DropdownMenuItem[] {
  return [
    {
      kind: "item",
      id: "new-file",
      label: t("New File"),
      disabled: Boolean(busyReason),
      description: busyReason,
      icon: icon("new-file"),
    },
    {
      kind: "item",
      id: "new-folder",
      label: t("New Folder"),
      disabled: Boolean(busyReason),
      description: busyReason,
      icon: icon("new-folder"),
    },
    ...(narrow
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "collapse",
            label: t("Collapse All"),
            icon: icon("collapse"),
          },
          ...(canSearch
            ? [
                {
                  kind: "item" as const,
                  id: "search",
                  label: t("Search in files"),
                  shortcut: `${MOD}${SHIFT}F`,
                  icon: icon("search"),
                },
              ]
            : []),
        ]
      : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "reveal",
      label: t(REVEAL_LABEL),
      disabled: Boolean(busyReason),
      icon: icon("reveal"),
    },
    {
      kind: "item",
      id: "excluded",
      label: t("Show excluded files"),
      checked: showExcluded,
      selectionRole: "checkbox",
    },
    { kind: "item", id: "reset", label: t("Reset"), disabled: showExcluded === excludedDefault },
  ];
}
