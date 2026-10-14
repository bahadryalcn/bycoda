import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { selectProjectRange } from "../model/projectSelection";
import {
  assignProjectsToNamedGroup,
  loadProjectGroups,
  loadProjectGroupAssignments,
  saveProjectGroupAssignments,
  type ProjectGroup,
} from "../model/projectGroups";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

type Selection = {
  active: boolean;
  selected: ReadonlySet<string>;
  toggle: (path: string, range?: boolean, includeAnchor?: boolean) => void;
  rememberAnchor: (path: string) => void;
  clear: () => void;
  selectAll: () => void;
  openActions: (anchor: HTMLElement, point?: { x: number; y: number }) => void;
};
const Context = createContext<Selection | null>(null);
export const useProjectMultiSelect = () => useContext(Context);

type Props = {
  paths: string[];
  groups: ProjectGroup[];
  busy: (path: string) => boolean;
  onMove: (selected: ReadonlySet<string>, step: -1 | 1) => void;
  canMove: (selected: ReadonlySet<string>, step: -1 | 1) => boolean;
  onRemove?: (paths: string[]) => void | Promise<void>;
  children: ReactNode;
};

export function ProjectMultiSelect({
  paths,
  groups,
  busy,
  onMove,
  canMove,
  onRemove,
  children,
}: Props) {
  useLocale();
  const [stored, setStored] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    point?: { x: number; y: number };
  } | null>(null);
  const [newGroupAnchor, setNewGroupAnchor] = useState<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const latestPaths = useRef(paths);
  const deletionStarted = useRef(false);
  latestPaths.current = paths;
  // A bulk removal can succeed for some projects before another fails. Keep
  // the failed/unprocessed part selected and retryable as the rail updates.
  useEffect(() => {
    if (!deleting || !deletionStarted.current) return;
    const available = new Set(paths.map(pathKey));
    const remaining = deleting.filter((path) => available.has(pathKey(path)));
    if (remaining.length !== deleting.length) setDeleting(remaining.length ? remaining : null);
  }, [paths, deleting]);
  const chosen = paths.filter((path) => stored.has(pathKey(path)));
  const active = chosen.length > 0;
  const selected = new Set(chosen.map(pathKey));
  const reset = () => {
    deletionStarted.current = false;
    setStored(new Set());
    setAnchor(null);
    setMenu(null);
    setNewGroupAnchor(null);
    setDeleting(null);
    setError(false);
  };
  const selectAll = () => {
    setStored(new Set(paths.map(pathKey)));
  };
  const toggle = (path: string, range = false, includeAnchor = range) => {
    if (!paths.some((allowed) => pathKey(allowed) === pathKey(path))) return;
    setStored((current) => {
      const initial = !active && includeAnchor && anchor != null
        ? new Set([pathKey(anchor)])
        : current;
      return selectProjectRange(paths, initial, anchor, path, range);
    });
    if (!range || anchor == null) setAnchor(path);
  };
  const moveTo = (groupId: string | null) => {
    const assignments = loadProjectGroupAssignments();
    for (const path of chosen) {
      if (groupId == null) delete assignments[pathKey(path)];
      else assignments[pathKey(path)] = groupId;
    }
    setError(!saveProjectGroupAssignments(assignments));
  };
  const groupItems: ExplorerMenuItem[] = [
    { kind: "item", id: "new", label: t("New group…") },
    { kind: "sep" },
    ...groups.map((group) => ({
      kind: "item" as const,
      id: `group:${group.id}`,
      label: group.name,
    })),
    { kind: "item", id: "ungrouped", label: t("Ungrouped") },
  ];
  const canDelete = chosen.length > 0 && !chosen.some(busy);
  const actionItems: ExplorerMenuItem[] = [
    { kind: "item", id: "all", label: t("Select all") },
    {
      kind: "item",
      id: "clear",
      label: t("Clear selection"),
      disabled: !chosen.length,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "group",
      label: t("Move to group"),
      disabled: !chosen.length,
      submenu: groupItems,
    },
    {
      kind: "item",
      id: "up",
      label: t("Move up"),
      disabled: !canMove(selected, -1),
    },
    {
      kind: "item",
      id: "down",
      label: t("Move down"),
      disabled: !canMove(selected, 1),
    },
    ...(onRemove
      ? [
          { kind: "sep" } as const,
          {
            kind: "item" as const,
            id: "delete",
            label: t("Delete selected"),
            danger: true,
            disabled: !canDelete,
            title: chosen.some(busy)
              ? t("Working projects cannot be deleted together.")
              : undefined,
          },
        ]
      : []),
  ];
  const pick = (id: string) => {
    const trigger = menu?.anchor ?? null;
    setMenu(null);
    if (id === "all") selectAll();
    else if (id === "clear") reset();
    else if (id === "up" || id === "down") onMove(selected, id === "up" ? -1 : 1);
    else if (id === "delete" && canDelete) {
      deletionStarted.current = false;
      setDeleting([...chosen]);
    } else if (id === "ungrouped") moveTo(null);
    else if (id.startsWith("group:")) moveTo(id.slice(6));
    else if (id === "new") {
      setName("");
      setError(false);
      setNewGroupAnchor(trigger);
    }
  };
  const deletionValid =
    deleting != null && deleting.every((path) => selected.has(pathKey(path)) && !busy(path));
  return (
    <Context.Provider
      value={{
        active,
        selected,
        toggle,
        rememberAnchor: setAnchor,
        clear: reset,
        selectAll,
        openActions: (anchor, point) => setMenu({ anchor, point }),
      }}
    >
      {error && !newGroupAnchor ? (
        <p role="alert" className="px-3 py-1 text-[11px] text-danger">
          {t("Could not save project changes. Try again.")}
        </p>
      ) : null}
      {children}
      {menu ? (
        <ExplorerMenu
          {...(menu.point ? { x: menu.point.x, y: menu.point.y } : { anchor: menu.anchor })}
          ariaLabel={t("Project options")}
          items={actionItems}
          onPick={pick}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {newGroupAnchor ? (
        <Popover
          anchor={newGroupAnchor}
          width={240}
          className="p-2"
          role="dialog"
          aria-label={t("New group name")}
          onDismiss={() => setNewGroupAnchor(null)}
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!chosen.length || !name.trim()) return;
              const existing = loadProjectGroups().find(
                (group) => group.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
              );
              if (existing && !groups.some((allowed) => allowed.id === existing.id)) {
                setError(true);
                return;
              }
              const saved = !!assignProjectsToNamedGroup(name, chosen);
              setError(!saved);
              if (saved) setNewGroupAnchor(null);
            }}
          >
            <label
              className="px-1 text-xs font-medium text-content/70"
              htmlFor="project-selection-group-name"
            >
              {t("New group name")}
            </label>
            <input
              id="project-selection-group-name"
              autoFocus
              className="min-w-0 rounded-md border border-content/10 bg-content/5 px-2 py-1.5 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-accent"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? (
              <p role="alert" className="px-1 text-[11px] text-danger">
                {t("Could not save project changes. Try again.")}
              </p>
            ) : null}
            <div className="flex justify-end gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-content/60 hover:bg-content/8 active:bg-content/12 focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setNewGroupAnchor(null)}
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={!chosen.length || !name.trim()}
                className="rounded-md bg-content/8 px-2 py-1 text-xs text-content/85 hover:bg-content/12 active:bg-content/15 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"
              >
                {t("Group")}
              </button>
            </div>
          </form>
        </Popover>
      ) : null}
      {deleting ? (
        <RemoveProjectDialog
          name={t("{p0} projects", { p0: deleting.length })}
          path={deleting[0]}
          paths={deleting}
          onCancel={() => setDeleting(null)}
          confirmDisabled={!deletionValid}
          onConfirm={async () => {
            if (!deletionValid) return;
            deletionStarted.current = true;
            try {
              await onRemove?.([...deleting]);
            } catch (reason) {
              const available = new Set(latestPaths.current.map(pathKey));
              const remaining = deleting.filter((path) => available.has(pathKey(path)));
              setDeleting(remaining.length ? remaining : null);
              throw reason;
            }
            reset();
          }}
        />
      ) : null}
    </Context.Provider>
  );
}
