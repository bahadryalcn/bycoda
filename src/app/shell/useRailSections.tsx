import { t, useLocale } from "../../shared/i18n";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "../../shared/ui/icons";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import {
  applyShownSectionOrder,
  isDefaultRailSectionOrder,
  loadRailSectionOrder,
  moveRailSection,
  resetRailSectionOrder,
  saveRailSectionOrder,
  subscribeRailSectionOrder,
  type RailSectionId,
} from "../../features/projects/model/railSections";
import type { MoveStep } from "../../shared/lib/reorder";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";

/** Classes for a header that drags: grab cursor, and no touch scrolling. */
export const RAIL_DRAG_HANDLE = "cursor-grab touch-none";

/**
 * Every section header is the same height, so the sections stay the same size
 * while one is dragged with only its header showing.
 */
export const RAIL_SECTION_HEADER = "group flex min-h-[30px] items-center gap-1 px-3 pb-1.5 pt-1";

/** The "..." on a section header; it shows on hover or keyboard focus. */
export function SectionMenuButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (x: number, y: number) => void;
}) {
  useLocale();
  return (
    <button
      type="button"
      data-no-drag
      title={t("Section options")}
      aria-label={t("{p0} section options", { p0: label })}
      aria-haspopup="menu"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(rect.left, rect.bottom);
      }}
      className="hidden size-5 shrink-0 cursor-default place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
    >
      <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Alt+Up / Alt+Down, the keyboard way to move a section or a group. */
export function moveStepForKey(event: KeyboardEvent): "up" | "down" | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  return null;
}

/** A move reorders the DOM, which can drop focus; put it back. */
export function keepFocus(element: HTMLElement) {
  requestAnimationFrame(() => {
    if (element.isConnected && document.activeElement !== element) {
      element.focus();
    }
  });
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
  const move = (id: RailSectionId, step: MoveStep) => {
    const next = moveRailSection(order, id, step, shown);
    if (next.join() !== order.join()) commit(next);
  };
  const sortable = useAnimatedReorder(
    shownOrder,
    (ids) => commit(applyShownSectionOrder(order, ids)),
    "y",
    undefined,
    { foldOnDrag: true },
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
        const step = moveStepForKey(event);
        if (step) {
          event.preventDefault();
          event.stopPropagation();
          move(id, step);
          keepFocus(event.target as HTMLElement);
        } else if (
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
        if (action === "up" || action === "down") move(id, action);
        else if (action === "reset") resetRailSectionOrder();
      }}
      onClose={() => setMenu(null)}
    />
  ) : null;

  return { order, drag, folded, element };
}
