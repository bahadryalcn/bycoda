import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useProjectMenu } from "../../../src/app/shell/useProjectMenu";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../../src/features/projects/model/projectGroups";
import { pathKey } from "../../../src/shared/lib/paths";
import { Button } from "../../../src/shared/ui/Button";
import { ContextMenu, type ContextMenuItem } from "../../../src/shared/ui/ContextMenu";
import { DropdownMenu, type DropdownMenuItem } from "../../../src/shared/ui/DropdownMenu";
import { InfoPopover } from "../../../src/shared/ui/InfoPopover";
import { MenuRow } from "../../../src/shared/ui/MenuRow";
import { NativePopupHost } from "../../../src/shared/ui/NativePopupHost";
import {
  ContextMenu as ArcContextMenu,
  contextMenuExampleItems,
} from "../../../src/shared/ui/arc/context-menu/context-menu";
import {
  Archive,
  Copy,
  ExternalLink,
  Folder,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "../../../src/shared/ui/icons";
import "../../../src/styles/index.css";

// Fixture-only: theme and density come from the URL; nothing is persisted and no
// menu action performs a real operation.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
const density = query.get("density");
if (density) document.documentElement.dataset.controlDensity = density;

const LONG =
  "Rename the current checkout and every linked worktree to match the long upstream branch name";

const dropdownItems: DropdownMenuItem[] = [
  { kind: "item", id: "rename", label: "Rename", icon: <Pencil />, shortcut: "F2" },
  { kind: "item", id: "copy", label: "Copy path", icon: <Copy />, shortcut: "Ctrl+Shift+C" },
  { kind: "item", id: "archive", label: "Archive", icon: <Archive />, disabled: true },
  { kind: "item", id: "long", label: LONG, icon: <Folder /> },
  { kind: "sep" },
  { kind: "item", id: "pinned", label: "Pinned", icon: <Pin />, checked: true },
  { kind: "item", id: "notify", label: "Notify on finish", checked: false },
  {
    kind: "group",
    id: "merge",
    label: "Merge method",
    items: [
      { kind: "item", id: "m-merge", label: "Merge commit", checked: true, selectionRole: "radio" },
      { kind: "item", id: "m-squash", label: "Squash", checked: false, selectionRole: "radio" },
      {
        kind: "item",
        id: "m-rebase",
        label: "Rebase",
        badge: "new",
        checked: false,
        selectionRole: "radio",
      },
    ],
  },
  { kind: "sep" },
  { kind: "item", id: "delete", label: "Delete", icon: <Trash2 />, danger: true },
];

const describedItems: DropdownMenuItem[] = [
  {
    kind: "item",
    id: "plan",
    label: "Plan mode",
    icon: <Plus />,
    description: "Review a plan before the agent changes files",
    checked: true,
  },
  {
    kind: "item",
    id: "auto",
    label: "Auto-accept edits",
    icon: <Pencil />,
    description: "Apply file edits without asking, keep prompting for commands",
    checked: false,
  },
  {
    kind: "item",
    id: "export",
    label: "Export transcript",
    icon: <ExternalLink />,
    description: "Disabled until the session finishes",
    disabled: true,
  },
  { kind: "item", id: "short", label: "No description row", icon: <Copy />, shortcut: "Ctrl+K" },
  {
    kind: "item",
    id: "wipe",
    label: "Clear history",
    icon: <Trash2 />,
    description: "Removes this session from the list",
    danger: true,
  },
];

const pointItems: ContextMenuItem[] = [
  { kind: "item", id: "open", label: "Open", icon: <Folder />, shortcut: "Enter" },
  { kind: "item", id: "rename", label: "Rename", icon: <Pencil />, shortcut: "F2" },
  {
    kind: "item",
    id: "more",
    label: "Open with",
    icon: <Copy />,
    submenu: [
      { kind: "item", id: "editor", label: "Editor" },
      { kind: "item", id: "terminal", label: "Terminal", checked: true },
      { kind: "sep" },
      { kind: "item", id: "finder", label: "Reveal in file manager" },
    ],
  },
  { kind: "item", id: "locked", label: "Move to trash", disabled: true, title: "Locked" },
  {
    kind: "item",
    id: "described",
    label: "Add to project",
    description: "Group this folder with related work",
    icon: <Plus />,
  },
  { kind: "sep" },
  { kind: "item", id: "delete", label: "Delete", icon: <Trash2 />, danger: true },
];

type Which =
  | "dropdown"
  | "described"
  | "native-host"
  | "ctx-center"
  | "ctx-right"
  | "ctx-bottom"
  | "ctx-anchor";

function Fixture() {
  const [open, setOpen] = useState<Which | null>(null);
  const [picked, setPicked] = useState("none");
  const [host, setHost] = useState<HTMLElement | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    saveProjectGroups([{ id: "fixture", name: "Design / Creative", collapsed: false }]);
    saveProjectGroupAssignments({ [pathKey("/fixture/design")]: "fixture" });
  }, []);
  const project = useProjectMenu({
    projectPaths: ["/fixture/design"],
    onRemoveProject: async () => {},
  });
  const trigger = (id: Which, label: string) => (
    <Button
      ref={(element) => {
        refs.current[id] = element;
      }}
      key={id}
      type="button"
      data-trigger={id}
      aria-haspopup="menu"
      aria-expanded={open === id}
      onClick={() => setOpen((current) => (current === id ? null : id))}
    >
      {label}
    </Button>
  );
  const close = () => setOpen(null);
  const pick = (id: string) => {
    setPicked(id);
    setOpen(null);
  };
  const anchorFor = (id: Which) => refs.current[id] ?? null;
  return (
    <main className="min-h-screen bg-background-base p-4 text-content" data-fixture="menus">
      <div className="flex flex-wrap items-center gap-2">
        {trigger("dropdown", "Dropdown menu")}
        {trigger("described", "Described rows")}
        {trigger("native-host", "Native host")}
        {trigger("ctx-center", "Context at point")}
        {trigger("ctx-right", "Context right edge")}
        {trigger("ctx-bottom", "Context bottom edge")}
        {trigger("ctx-anchor", "Context anchored")}
        <Button type="button" onClick={() => project.openGroupMenu("fixture", 24, 120)}>
          Project group menu
        </Button>
        <InfoPopover label="About menus">
          <p>Menus open at a point or from a trigger. Arrow keys move, Enter chooses.</p>
          <p>Escape closes the menu and returns focus to the trigger that opened it.</p>
        </InfoPopover>
        <output data-testid="picked" className="text-ui-caption text-(--ui-text-secondary)">
          {picked}
        </output>
      </div>

      <section className="mt-4 grid max-w-3xl grid-cols-2 gap-4" aria-label="Static rows">
        <Panel title="MenuRow states">
          <MenuRow role="menuitem" data-testid="row-plain">
            Plain row
          </MenuRow>
          <MenuRow role="menuitem" data-testid="row-highlight" data-highlighted="true">
            Highlighted row
          </MenuRow>
          <MenuRow role="menuitem" data-testid="row-expanded" aria-haspopup="menu" aria-expanded>
            Expanded branch
          </MenuRow>
          <MenuRow role="menuitem" data-testid="row-danger" destructive>
            Destructive row
          </MenuRow>
          <MenuRow role="menuitem" data-testid="row-disabled" disabled>
            Disabled row
          </MenuRow>
        </Panel>
        <Panel title="Arc ContextMenu (standalone)">
          <ArcContextMenu items={contextMenuExampleItems} label="Arc context menu">
            <span className="block px-3 py-2">Click or right-click target</span>
          </ArcContextMenu>
        </Panel>
      </section>

      {open === "dropdown" ? (
        <DropdownMenu
          anchor={anchorFor("dropdown")}
          label="Item actions"
          items={dropdownItems}
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {open === "described" ? (
        <DropdownMenu
          anchor={anchorFor("described")}
          label="Session modes"
          items={describedItems}
          width={280}
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {/* Fixture stand-in for a native popup window: the OS positions, clips and frames the real one. */}
      <div
        ref={setHost}
        data-testid="native-host"
        // Inline geometry: Tailwind does not scan tests/browser for utilities.
        style={{
          position: "fixed",
          right: 16,
          top: 56,
          width: 288,
          overflow: "hidden",
          display: open === "native-host" ? "block" : "none",
          border: "1px solid var(--color-stroke)",
          borderRadius: "var(--ui-radius-popup)",
          background: "var(--ui-surface-raised)",
          boxShadow: "var(--ui-elevation-floating)",
        }}
      />
      {open === "native-host" ? (
        <NativePopupHost.Provider value={host}>
          <DropdownMenu
            anchor={anchorFor("native-host")}
            label="Native host actions"
            items={dropdownItems.slice(0, 5)}
            onPick={pick}
            onClose={close}
          />
        </NativePopupHost.Provider>
      ) : null}
      {open === "ctx-center" ? (
        <ContextMenu
          x={Math.round(window.innerWidth / 3)}
          y={160}
          ariaLabel="Point actions"
          items={pointItems}
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {open === "ctx-right" ? (
        <ContextMenu
          x={window.innerWidth - 24}
          y={160}
          ariaLabel="Edge actions"
          items={pointItems}
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {open === "ctx-bottom" ? (
        <ContextMenu
          x={Math.round(window.innerWidth / 2)}
          y={window.innerHeight - 24}
          ariaLabel="Bottom actions"
          items={pointItems}
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {open === "ctx-anchor" ? (
        <ContextMenu
          anchor={anchorFor("ctx-anchor")!}
          ariaLabel="Anchored actions"
          items={[
            { kind: "item", id: "a", label: "Show hidden files", checked: true },
            { kind: "item", id: "b", label: "Show ignored files", checked: false },
            { kind: "sep" },
            { kind: "item", id: "c", label: LONG, icon: <Folder /> },
          ]}
          side="bottom"
          align="start"
          onPick={pick}
          onClose={close}
        />
      ) : null}
      {project.element}
    </main>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-(--ui-radius-popup) border border-stroke bg-(--ui-surface-raised) p-1">
      <div className="px-2 py-1 text-ui-caption text-(--ui-text-secondary)">{title}</div>
      <div role="menu" aria-label={title} className="flex flex-col">
        {children}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
