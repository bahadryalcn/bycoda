import type { ReactNode, RefObject } from "react";
import type { PopoverSize } from "../lib/popover";
import type { PopoverAnchor } from "./Popover";

export type DropdownMenuAction = {
  kind: "item";
  id: string;
  /** Accessible name and type-ahead key; also the visible text unless `content` replaces it. */
  label: string;
  icon?: ReactNode;
  description?: string;
  /** Replaces the visible label and description (a project name with a badge, a two-line model row). */
  content?: ReactNode;
  /** Secondary text or glyphs after the label, before the check or chevron (a parent folder). */
  trailing?: ReactNode;
  shortcut?: string;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  selectionRole?: "radio" | "checkbox";
  badge?: string;
  /** Overrides the menu's `closeOnSelect` for this row. */
  closeOnSelect?: boolean;
  /**
   * Makes the row a branch: a flyout opens on hover, ArrowRight, Enter or click and closes on
   * ArrowLeft or Escape. Picking a leaf calls `onPick` with its id and closes the whole menu.
   * Branch rows are never picked themselves.
   */
  submenu?: DropdownMenuItem[];
  /** Accessible name of the flyout; defaults to the row label. */
  submenuLabel?: string;
  submenuWidth?: number;
  submenuMaxHeight?: number;
  /** Like `submenu`, but the flyout hosts free-form content (a color and icon panel) instead of rows. */
  panel?: ReactNode;
};

export type DropdownMenuItem =
  | { kind: "sep" }
  | DropdownMenuAction
  /** Non-interactive or form content between rows. Keys typed inside it stay with its controls. */
  | { kind: "content"; id: string; node: ReactNode }
  | { kind: "group"; id: string; label: string; items: DropdownMenuAction[] };

/** A filter field above the rows. Focus stays in the field while arrows move the highlighted row. */
export interface DropdownMenuSearch {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}

export interface DropdownMenuProps {
  /** An element, a ref, or a `{ x, y }` point (right-click menus). */
  anchor: PopoverAnchor;
  label: string;
  items: DropdownMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /**
   * Minimum width step, the same `sm | md | lg` rem steps as Popover (15.5, 17.5, 20rem); the menu
   * grows with its longest row up to 800px. Use this instead of a pixel `width`.
   */
  size?: PopoverSize;
  /**
   * Exception to `size`: `"content"` takes the trigger's width as the minimum, a number is a
   * minimum in px. Wins over `size`; the default is 228px.
   */
  width?: number | "content";
  gap?: number;
  maxHeight?: number;
  /** Compact for long lists of labels, comfortable for rows with multiple lines of content. */
  density?: "compact" | "comfortable";
  /** Uses the same frosted surface as anchored detail popovers. */
  frosted?: boolean;
  /**
   * Whether picking a row closes the menu. Defaults to true, except checkbox rows that stay open
   * for the next toggle. A row's own `closeOnSelect` wins.
   */
  closeOnSelect?: boolean;
  /** Adds a filter field. The caller filters `items`; the menu only moves the highlight. */
  search?: DropdownMenuSearch;
  /**
   * How the current row is shown. `focus` (default): the row holds DOM focus. `state`: the row is
   * highlighted by state (`data-highlighted`, `aria-activedescendant` on the menu) and the arrow,
   * Home, End, Enter and Space keys are taken at the window, so the trigger (a composer) keeps
   * focus. A search field already implies `state`.
   */
  highlight?: "focus" | "state";
  /** Row to focus (or highlight, with `search` or `highlight="state"`) on open. Defaults to the first enabled row. */
  initialActiveId?: string;
  /** Bound mounted rows for long, flat lists of leaf actions. Keyboard navigation spans all items. */
  windowed?: boolean;
  /** Do not dismiss on a press matching this selector (a control that owns the menu). */
  ignore?: string;
  /** Called instead of `onClose` for Escape when it returns true (a nested editor handled it). */
  onEscape?: () => boolean;
  [attribute: `data-${string}`]: string | boolean | undefined;
}

export function actionsOf(items: DropdownMenuItem[]): DropdownMenuAction[] {
  return items.flatMap((item) =>
    item.kind === "item" ? [item] : item.kind === "group" ? item.items : [],
  );
}

export const isField = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.matches("input, textarea, select, [contenteditable]");
