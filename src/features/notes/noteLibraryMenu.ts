import { t } from "../../shared/i18n";
import type { ContextMenuItem } from "../../shared/ui/ContextMenu";
import type { NoteGrouping } from "./noteLibrary";

/** What a library menu was opened on. The identity is captured when the menu opens. */
export type NoteMenuTarget =
  | { kind: "note"; id: string; group: string }
  | { kind: "group"; key: string; label: string; path?: string; tag?: string }
  | { kind: "library" };

/** Where a new note goes: the same fields the toolbar "New note" resolves from the filters. */
export type NoteCreateScope = { sourceCwd?: string; tags?: string[] };

export type NoteMenuContext = {
  /** The note shown in the editor; the menu never switches it unless asked to open. */
  openId: string | null;
  selectionMode: boolean;
  checkedIds: ReadonlySet<string>;
  creating: boolean;
  deleting: boolean;
  collapsed?: boolean;
  /** Short description of where an empty-area "New note" lands. */
  scopeLabel?: string;
};

/** A group heading's creation scope, or null when the grouping carries none (no project, untagged). */
export function groupCreateScope(
  grouping: NoteGrouping,
  group: { key: string; path?: string },
): NoteCreateScope | null {
  if (grouping === "project") return group.path ? { sourceCwd: group.path } : null;
  if (grouping === "tag") {
    const tag = group.key.startsWith("tag:") ? group.key.slice(4) : "";
    return tag ? { tags: [tag] } : null;
  }
  return null;
}

/**
 * Notes a row menu may delete in bulk: the checked set only when the clicked note
 * belongs to it, so a right-click on an unchecked row never widens to the selection.
 */
export function noteMenuSelectedScope(
  noteId: string,
  selectionMode: boolean,
  checkedIds: ReadonlySet<string>,
): string[] {
  return selectionMode && checkedIds.has(noteId) && checkedIds.size > 1 ? [...checkedIds] : [];
}

const MENU_LABEL_LIMIT = 24;
/** Keeps a long project or tag name from wrapping the action; the menu header carries the full name. */
function shortGroupLabel(label: string) {
  const chars = [...label];
  return chars.length > MENU_LABEL_LIMIT
    ? `${chars.slice(0, MENU_LABEL_LIMIT - 1).join("")}…`
    : label;
}

export function noteMenuItems(target: NoteMenuTarget, context: NoteMenuContext): ContextMenuItem[] {
  if (target.kind === "library") {
    return [
      {
        kind: "item",
        id: "new-note",
        label: t("New note"),
        description: context.scopeLabel,
        disabled: context.creating,
      },
    ];
  }
  if (target.kind === "group") {
    return [
      {
        kind: "item",
        id: "new-note",
        label: t("New note in {p0}", { p0: shortGroupLabel(target.label) }),
        disabled: context.creating,
      },
      { kind: "sep" },
      {
        kind: "item",
        id: "toggle-group",
        label: context.collapsed ? t("Expand group") : t("Collapse group"),
      },
    ];
  }
  const checked = context.checkedIds.has(target.id);
  const selectedCount = noteMenuSelectedScope(
    target.id,
    context.selectionMode,
    context.checkedIds,
  ).length;
  return [
    ...(target.id === context.openId
      ? []
      : [{ kind: "item" as const, id: "open", label: t("Open note") }]),
    { kind: "item", id: "edit-title", label: t("Edit title") },
    { kind: "item", id: "add-to-chat", label: t("Add to chat") },
    { kind: "sep" },
    {
      kind: "item",
      id: "toggle-check",
      label: checked ? t("Deselect note") : t("Select note"),
      disabled: context.deleting,
    },
    {
      kind: "item",
      id: "delete",
      label: t("Delete note"),
      danger: true,
      disabled: context.deleting,
    },
    ...(selectedCount > 0
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "delete-selected",
            label: t("Delete selected ({p0})", { p0: selectedCount }),
            danger: true,
            disabled: context.deleting,
          },
        ]
      : []),
  ];
}
