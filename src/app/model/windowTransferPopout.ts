import type { Session } from "../../features/sessions/model/session";
import type { WorkspaceTab } from "../../features/workspace/model/layout";
import { leafIds } from "../../features/workspace/model/layout";
import { filterTabsForProject } from "../../features/workspace/model/workspaceTabGroups";

/** Pointer travel past the window edge before a tab drag counts as a pop-out. */
const POP_OUT_MARGIN = 6;

/** True when a dragged tab was released clearly outside the window. */
export function isPointerOutsideWindow(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = POP_OUT_MARGIN,
): boolean {
  return x < -margin || y < -margin || x > width + margin || y > height + margin;
}

/** Top-left of the new window so the dropped tab lands under the pointer. */
export function popOutPosition(screenX: number, screenY: number): { x: number; y: number } {
  return { x: Math.round(screenX - 120), y: Math.round(screenY - 16) };
}

/** CSS coordinates scale with webview zoom; native placement uses physical pixels. */
export function pointerWindowMovePosition(
  event: Pick<PointerEvent, "screenX" | "screenY" | "clientX" | "clientY">,
): WindowMovePosition {
  return {
    ...popOutPosition(event.screenX, event.screenY),
    clientX: event.clientX,
    clientY: event.clientY,
    pixelRatio: window.devicePixelRatio,
  };
}

/** Convert legacy OS-logical points to the receiving webview's current CSS pixels. */
export function windowDropPointToClient(
  point: { x: number; y: number; scaleFactor?: number },
  pixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio,
): { x: number; y: number } {
  const ratio =
    point.scaleFactor && Number.isFinite(pixelRatio) && pixelRatio > 0
      ? point.scaleFactor / pixelRatio
      : 1;
  return { x: point.x * ratio, y: point.y * ratio };
}

/** Sessions in `tabIds` that are streaming or waiting on the user. Their turn
 * lives in this window's harness listeners, so the new window cannot adopt it. */
export function busySessionsInTabs(
  tabs: WorkspaceTab[],
  sessions: Session[],
  tabIds: string[],
): Session[] {
  const ids = new Set(tabIds);
  const inTabs = new Set<string>();
  for (const tab of tabs) {
    if (!ids.has(tab.id)) continue;
    for (const id of leafIds(tab.layout)) inTabs.add(id);
  }
  return sessions.filter((session) => inTabs.has(session.id) && session.busy);
}

export type TabMoveRemainder = {
  remaining: WorkspaceTab[];
  closeWindow: boolean;
  /** The project has no tab left here, so a blank session must be seeded. */
  needsSeed: boolean;
  /** Tab to show next when the active tab moved away; null keeps the current. */
  nextActiveTabId: string | null;
};

/** What the source window keeps after `movingIds` leave it. */
export function planTabMoveRemainder(
  tabs: WorkspaceTab[],
  sessions: Session[],
  movingIds: string[],
  activeTabId: string,
  projectCwd: string,
  secondaryWindow = false,
): TabMoveRemainder {
  const moving = new Set(movingIds);
  const remaining = tabs.filter((tab) => !moving.has(tab.id));
  const inProject = filterTabsForProject(remaining, sessions, projectCwd);
  const movedSessionIds = new Set(
    tabs.filter((tab) => moving.has(tab.id)).flatMap((tab) => leafIds(tab.layout)),
  );
  const ownsOtherRunningWork = sessions.some(
    (session) => session.busy && !movedSessionIds.has(session.id),
  );
  const closeWindow = secondaryWindow && remaining.length === 0 && !ownsOtherRunningWork;
  const needsSeed = !closeWindow && inProject.length === 0;
  const nextActiveTabId = moving.has(activeTabId) ? (inProject[0]?.id ?? null) : null;
  return { remaining, closeWindow, needsSeed, nextActiveTabId };
}

export type WindowMovePosition = {
  x: number;
  y: number;
  targetWindowLabel?: string;
  clientX?: number;
  clientY?: number;
  pixelRatio?: number;
};

/** Tabs waiting for a running response to finish before moving windows. */
export type PendingWindowMoves = Record<string, Partial<WindowMovePosition> | null>;

export function queueWindowMoves(
  pending: PendingWindowMoves,
  tabIds: string[],
  position?: Partial<WindowMovePosition>,
): PendingWindowMoves {
  const next = { ...pending };
  for (const id of tabIds) next[id] = position ?? null;
  return next;
}

export function dropWindowMoves(pending: PendingWindowMoves, tabIds: string[]): PendingWindowMoves {
  if (!tabIds.some((id) => id in pending)) return pending;
  const next = { ...pending };
  for (const id of tabIds) delete next[id];
  return next;
}

/** Queued tabs that can move now (`ready`) or no longer exist (`gone`). */
export function settlePendingWindowMoves(
  pending: PendingWindowMoves,
  tabs: WorkspaceTab[],
  sessions: Session[],
): { ready: string[]; gone: string[] } {
  const ready: string[] = [];
  const gone: string[] = [];
  for (const id of Object.keys(pending)) {
    if (!tabs.some((tab) => tab.id === id)) gone.push(id);
    else if (busySessionsInTabs(tabs, sessions, [id]).length === 0) ready.push(id);
  }
  return { ready, gone };
}
