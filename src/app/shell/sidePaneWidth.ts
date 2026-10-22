/** Narrowest the main column gets when side panes are dragged wider or the window shrinks. */
export const MAIN_PANE_MIN_WIDTH = 360;

export type SidePane = "rail" | "workspace";

/**
 * Widest a side pane may grow: its own cap and window share, less what the
 * other side pane already takes, so the main column keeps its minimum. Never
 * below `floor`, so a wide neighbour can't push the rail under the macOS
 * traffic lights; the neighbour gives way on its next clamp instead.
 */
export function sidePaneMaxWidth(self: SidePane, cap: number, share: number, floor: number) {
  const other: SidePane = self === "rail" ? "workspace" : "rail";
  const otherWidth =
    document.querySelector<HTMLElement>(`[data-side-pane="${other}"]`)?.offsetWidth ?? 0;
  const viewport = window.innerWidth;
  return Math.max(
    floor,
    Math.min(cap, Math.floor(viewport * share), viewport - otherWidth - MAIN_PANE_MIN_WIDTH),
  );
}
