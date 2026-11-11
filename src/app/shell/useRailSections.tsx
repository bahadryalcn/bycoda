import { InlineAction } from "../../shared/ui/ActionHost";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { useT } from "../../shared/i18n";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Bot, Clock, Folder, FolderTree, MoreHorizontal, Pin } from "../../shared/ui/icons";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import {
  applyShownSectionOrder,
  isDefaultRailSectionOrder,
  loadRailSectionOrder,
  loadRailSectionCollapse,
  toggleRailSectionCollapse,
  resetRailSectionOrder,
  saveRailSectionOrder,
  subscribeRailSectionOrder,
  type CollapsibleRailSection,
  type RailSectionId,
} from "../../features/projects/model/railSections";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";

/** Classes for a header that drags: grab cursor, and no touch scrolling. */
export const RAIL_DRAG_HANDLE = "cursor-grab touch-none";

/**
 * Every section header is one compact 28px row (the shared compact control
 * height, so it follows the density setting) with no extra block padding: the
 * sections stay the same size while one is dragged with only its header
 * showing.
 */
export const RAIL_SECTION_HEADER =
  "group flex min-h-(--ui-control-height-compact) items-center gap-1 px-2";

/** Label style shared by every section header, whether it collapses or not. */
export const RAIL_SECTION_LABEL = "text-ui-secondary font-medium text-(--ui-text)";

/**
 * The block around one section (header plus body). Two spacing roles live here, not in
 * the ledger: an open section leaves 12px after its body, a collapsed one only a hairline
 * so a closed rail stays a tight list of headers. Pass `data-collapsed` when closed.
 */
export const RAIL_SECTION_BLOCK =
  "reorder-item rail-reorder-block mb-3 shrink-0 data-[collapsed]:mb-0.5";

/**
 * One header for every rail section. Anatomy, left to right: a flexible label track
 * (optional leading icon, which turns into the collapse chevron on hover or focus; label;
 * optional count) and a persistent right-aligned slot with the section's own actions and,
 * when the section can be reordered, its options menu. Dragging starts anywhere on the
 * header except that slot.
 */
export function RailSectionHeader({
  label,
  drag,
  collapsed = false,
  onToggleCollapsed,
  controlsId,
  icon,
  count,
  actions,
  onLabelClick,
  labelClickLabel,
  selected = false,
}: {
  label: string;
  /** Present when the section can be reordered; adds the drag handle, shortcuts and options menu. */
  drag?: RailSectionDrag;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Id of the element the toggle shows and hides. */
  controlsId?: string;
  /** Leading mark, for example a clock or a status dot. Without one the chevron is always shown. */
  icon?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  /** Makes the label text open the section's page; the chevron still collapses. Needs `onToggleCollapsed`. */
  onLabelClick?: () => void;
  /** Accessible name of the label button, for example "Open Crews". */
  labelClickLabel?: string;
  selected?: boolean;
}) {
  const t = useT();
  const collapsible = onToggleCollapsed != null;
  const sectionIcons = [
    [t("Pinned"), Pin],
    [t("Groups"), FolderTree],
    [t("Projects"), Folder],
    [t("Last sessions"), Clock],
    [t("Crews"), Bot],
  ] as const;
  const SectionIcon = sectionIcons.find(([name]) => name === label)?.[1];
  return (
    <SectionLabel
      selected={selected}
      host
      compactRail
      collapsible={collapsible}
      expanded={!collapsed}
      onExpandedChange={onToggleCollapsed}
      controls={controlsId}
      labelAction={
        collapsible && onLabelClick
          ? {
              label: labelClickLabel ?? label,
              toggleLabel: label,
              onClick: onLabelClick,
              current: selected,
            }
          : undefined
      }
      icon={icon ?? (SectionIcon ? <SectionIcon className="icon-sm" /> : undefined)}
      chevron="hover"
      // SectionLabel types `count` as a number; it renders any node, and LiveAgentsPreview passes one.
      count={count as number | null | undefined}
      headerProps={{
        ...drag?.headerProps,
        "data-rail-section-header": "",
        tabIndex: drag ? 0 : undefined,
        "aria-keyshortcuts": drag ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
        title: drag ? t("Drag to reorder") : undefined,
      }}
      className={`px-2 ${drag ? RAIL_DRAG_HANDLE : ""} rounded-md focus-visible:bg-(--ui-surface-hover) @max-[140px]/rail:px-0`}
      classNames={{
        count: "ms-auto ps-1",
        actions: "cursor-default",
      }}
      actionsProps={{ "data-rail-section-actions": "" }}
      actions={
        actions || drag ? (
          <>
            {actions}
            {drag ? (
              <span className="contents @max-[140px]/rail:hidden">
                <SectionMenuButton label={label} onOpen={drag.openMenu} />
              </span>
            ) : null}
          </>
        ) : undefined
      }
    >
      {label}
    </SectionLabel>
  );
}

/**
 * The "..." on a section header. Unlike row actions it is always visible, so the
 * section menu never depends on hover; it sits in the header's trailing slot.
 */
export function SectionMenuButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (x: number, y: number) => void;
}) {
  const t = useT();
  return (
    <InlineAction
      reveal="always"
      label={t("{p0} section options", { p0: label })}
      motion="none"
      type="button"
      data-no-drag
      tooltip={t("Section options")}
      aria-label={t("{p0} section options", { p0: label })}
      aria-haspopup="menu"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(rect.left, rect.bottom);
      }}
      className="shrink-0"
    >
      <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
    </InlineAction>
  );
}

/** What one section needs to be draggable by its header. */
export type RailSectionDrag = {
  /** Goes on the section's root element, which is what moves. */
  setRef: (element: HTMLElement | null) => void;
  /** True while a section is dragged: every section shows only its header. */
  folded: boolean;
  /** Spread on the header element. */
  headerProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onClickCapture: (event: MouseEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  };
  /** Opens the section's move menu at a point. */
  openMenu: (x: number, y: number) => void;
};

/**
 * The order of the rail's sections: saved, shared across windows, changed by
 * dragging a section header, its menu, or Alt+Up / Alt+Down on the header.
 * `shown` lists the sections currently on screen; the others keep their slot.
 */
export function useRailSections(shown: ReadonlySet<RailSectionId>) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(loadRailSectionCollapse);
  useEffect(() => subscribeRailSectionOrder(() => setCollapsed(loadRailSectionCollapse())), []);
  const [order, setOrder] = useState(loadRailSectionOrder);
  useEffect(() => subscribeRailSectionOrder(() => setOrder(loadRailSectionOrder())), []);
  const [menu, setMenu] = useState<{
    id: RailSectionId;
    x: number;
    y: number;
  } | null>(null);
  const shownOrder = useMemo(() => order.filter((id) => shown.has(id)), [order, shown]);
  const commit = (next: RailSectionId[]) => {
    setOrder(next);
    saveRailSectionOrder(next);
  };
  // Spoken name of a section: its header title, announced with its new place after a move.
  const sectionName = (id: RailSectionId) =>
    ({
      "last-sessions": t("Last sessions"),
      pinned: t("Pinned"),
      groups: t("Groups"),
      crews: t("Crews"),
      projects: t("Projects"),
    })[id];
  const sortable = useAnimatedReorder(
    shownOrder,
    (ids) => commit(applyShownSectionOrder(order, ids)),
    "y",
    undefined,
    { foldOnDrag: true, label: sectionName },
  );
  const folded = sortable.draggingId !== null;

  const drag = (id: RailSectionId): RailSectionDrag => ({
    setRef: (element) => sortable.setItemRef(id, element),
    folded,
    headerProps: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable.onItemPointerDown(id, event);
      },
      // The click that ends a drag must not toggle or open anything.
      onClickCapture: (event) => {
        if (!sortable.consumeClick()) return;
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDown: (event) => {
        // Alt+Up / Alt+Down: the same move, announcement and focus restore as a drag.
        if (sortable.onItemKeyDown(id, event)) return;
        if (
          event.target === event.currentTarget &&
          (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        ) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ id, x: rect.left, y: rect.bottom });
        }
      },
      onContextMenu: (event) => {
        event.preventDefault();
        setMenu({ id, x: event.clientX, y: event.clientY });
      },
    },
    openMenu: (x, y) => setMenu({ id, x, y }),
  });

  const position = menu ? shownOrder.indexOf(menu.id) : -1;
  const element: ReactNode = menu ? (
    <ExplorerMenu
      x={menu.x}
      y={menu.y}
      ariaLabel="Section actions"
      items={[
        {
          kind: "item",
          id: "up",
          get label() {
            return t("Move section up");
          },
          disabled: position <= 0,
        },
        {
          kind: "item",
          id: "down",
          get label() {
            return t("Move section down");
          },
          disabled: position < 0 || position >= shownOrder.length - 1,
        },
        { kind: "sep" },
        {
          kind: "item",
          id: "reset",
          get label() {
            return t("Reset rail order");
          },
          disabled: isDefaultRailSectionOrder(order),
        },
      ]}
      onPick={(action) => {
        const id = menu.id;
        setMenu(null);
        if (action === "up" || action === "down") sortable.moveBy(id, action === "up" ? -1 : 1);
        else if (action === "reset") resetRailSectionOrder();
      }}
      onClose={() => setMenu(null)}
    />
  ) : null;

  const toggleCollapsed = (id: CollapsibleRailSection) => {
    setCollapsed(toggleRailSectionCollapse(id, !collapsed[id]));
  };
  return { order, drag, folded, element, collapsed, toggleCollapsed };
}
