import { useSyncExternalStore } from "react";
import {
  PROJECT_RAIL_WIDTH_MIN,
  SESSION_SIDEBAR_WIDTH_MIN,
} from "../../features/settings/model/appearance";
import { observeResize } from "../../shared/lib/observeResize";
import { MAIN_PANE_MIN_WIDTH } from "./sidePaneWidth";

/** Width of the compact project rail (`w-14` in `Sidebar.tsx`). */
const COMPACT_RAIL_WIDTH = 56;

/**
 * Main column the conversation keeps while the full rail and the session list are both open.
 * Narrower windows show the session list beside the compact rail instead of squeezing the
 * conversation between two narrow columns.
 */
const BOTH_PANES_MAIN_WIDTH = 560;

export interface ShellPaneState {
  rail: boolean;
  sidebar: boolean;
}

export interface FittedShellPanes extends ShellPaneState {
  /** A stored pane gave way, so the compact rail (and its sidebar drawer) must stay reachable. */
  compactRailForced: boolean;
}

/**
 * Which stored side panes fit beside a main column of `MAIN_PANE_MIN_WIDTH`. The stored
 * choices are never rewritten: a pane that does not fit stays closed only while the
 * window is that narrow (a large UI zoom shrinks the CSS viewport the same way), and the
 * compact rail and its sidebar drawer keep the navigation reachable.
 */
export function fitShellPanes(viewport: number, stored: ShellPaneState): FittedShellPanes {
  const room = viewport - MAIN_PANE_MIN_WIDTH;
  const bothFit =
    viewport - BOTH_PANES_MAIN_WIDTH >= PROJECT_RAIL_WIDTH_MIN + SESSION_SIDEBAR_WIDTH_MIN;
  const rail = stored.rail && (stored.sidebar ? bothFit : room >= PROJECT_RAIL_WIDTH_MIN);
  const sidebarRoom = rail ? bothFit : room >= COMPACT_RAIL_WIDTH + SESSION_SIDEBAR_WIDTH_MIN;
  const sidebar = stored.sidebar && sidebarRoom;
  return {
    rail,
    sidebar,
    compactRailForced: (stored.rail && !rail) || (stored.sidebar && !sidebar),
  };
}

function subscribeViewport(onChange: () => void) {
  return observeResize(document.documentElement, onChange);
}

/** Stored side-pane state narrowed to what fits the current viewport. */
export function useFittedShellPanes(stored: ShellPaneState): FittedShellPanes {
  const viewport = useSyncExternalStore(subscribeViewport, () => window.innerWidth);
  return fitShellPanes(viewport, stored);
}
