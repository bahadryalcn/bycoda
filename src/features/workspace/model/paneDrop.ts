import { useSyncExternalStore } from "react";
import { paneEdgeFromPoint, type PaneEdge, type PaneTabDropPosition } from "./layout";

export type PaneDrop = {
  fromId: string;
  overId: string | null;
  edge: PaneEdge;
  tabPosition?: PaneTabDropPosition;
  targetFileId?: string;
  invalid?: boolean;
};

export type TitleTabDropPosition = "before" | "after";

export type TitleTabDrop = {
  fromId: string;
  targetTabId: string;
  position: TitleTabDropPosition;
  invalid?: boolean;
};

let drop: PaneDrop | null = null;
const listeners = new Set<() => void>();
let titleTabDrop: TitleTabDrop | null = null;
const titleTabListeners = new Set<() => void>();

function subscribeNoop() {
  return () => {};
}

function getNullDrop(): PaneDrop | null {
  return null;
}

export function setExternalPaneDrop(next: PaneDrop | null) {
  if (
    drop?.fromId === next?.fromId &&
    drop?.overId === next?.overId &&
    drop?.edge === next?.edge &&
    drop?.tabPosition === next?.tabPosition &&
    drop?.targetFileId === next?.targetFileId &&
    drop?.invalid === next?.invalid
  ) {
    return;
  }
  if (drop == null && next == null) return;
  drop = next;
  for (const listener of listeners) listener();
}

export function subscribeExternalPaneDrop(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getExternalPaneDrop() {
  return drop;
}

export function setExternalTitleTabDrop(next: TitleTabDrop | null) {
  if (
    titleTabDrop?.fromId === next?.fromId &&
    titleTabDrop?.targetTabId === next?.targetTabId &&
    titleTabDrop?.position === next?.position &&
    titleTabDrop?.invalid === next?.invalid
  ) {
    return;
  }
  if (titleTabDrop == null && next == null) return;
  titleTabDrop = next;
  for (const listener of titleTabListeners) listener();
}

export function subscribeExternalTitleTabDrop(listener: () => void) {
  titleTabListeners.add(listener);
  return () => {
    titleTabListeners.delete(listener);
  };
}

export function getExternalTitleTabDrop() {
  return titleTabDrop;
}

/** Overlay for a drag that starts outside the pane tree (sidebar cards). */
export function useExternalPaneDrop(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeExternalPaneDrop : subscribeNoop,
    enabled ? getExternalPaneDrop : getNullDrop,
  );
}

/** Insertion marker for a pane being detached into the title tab strip. */
export function useExternalTitleTabDrop() {
  return useSyncExternalStore(
    subscribeExternalTitleTabDrop,
    getExternalTitleTabDrop,
    getNullTitleTabDrop,
  );
}

function getNullTitleTabDrop(): TitleTabDrop | null {
  return null;
}

/** Share native cross-window previews with the exact same local docking overlays. */
export function applyWindowDragPreview(
  token: string,
  x: number,
  y: number,
  invalid = false,
  isFileDrag = false,
) {
  const title = titleTabDropFromPoint(x, y);
  const pane = title ? null : paneDropFromPoint(x, y);
  setExternalTitleTabDrop(title ? { fromId: token, ...title, invalid } : null);
  setExternalPaneDrop(
    pane
      ? {
          fromId: token,
          overId: pane.id,
          edge: pane.edge,
          tabPosition: pane.targetFileId && !isFileDrag ? undefined : pane.tabPosition,
          targetFileId: isFileDrag ? pane.targetFileId : undefined,
          invalid: invalid || pane.invalid,
        }
      : invalid && !title
        ? { fromId: token, overId: null, edge: "center", invalid: true }
        : null,
  );
}

export function clearWindowDragPreview(token?: string) {
  if (drop?.fromId.startsWith("window:") && (!token || drop.fromId === token))
    setExternalPaneDrop(null);
  if (titleTabDrop?.fromId.startsWith("window:") && (!token || titleTabDrop.fromId === token))
    setExternalTitleTabDrop(null);
}

export function paneDropFromPoint(
  x: number,
  y: number,
): {
  id: string;
  edge: PaneEdge;
  tabPosition?: PaneTabDropPosition;
  targetFileId?: string;
  invalid?: boolean;
} | null {
  const el = document.elementFromPoint(x, y);
  const pane = el?.closest("[data-pane-id]") as HTMLElement | null;
  const surface = el?.closest("[data-surface-pane-id]") as HTMLElement | null;
  const id = surface?.dataset.surfacePaneId ?? pane?.dataset.paneId;
  if (!id || (!pane && !surface)) return null;
  const invalid = Boolean((surface ?? pane)!.closest("[inert]"));
  if (surface) {
    const fileTab = el?.closest("[data-surface-tab-id]") as HTMLElement | null;
    const rect = fileTab?.getBoundingClientRect();
    return {
      id,
      edge: "center",
      ...(fileTab?.dataset.surfaceTabId && rect
        ? {
            targetFileId: fileTab.dataset.surfaceTabId,
            tabPosition: x < rect.left + rect.width / 2 ? ("before" as const) : ("after" as const),
          }
        : {}),
      ...(invalid ? { invalid: true } : {}),
    };
  }
  const tab = el?.closest("[data-pane-tab-id]") as HTMLElement | null;
  if (tab?.dataset.paneTabId && pane?.contains(tab)) {
    const rect = tab.getBoundingClientRect();
    return {
      id: tab.dataset.paneTabId,
      edge: "center",
      tabPosition: x < rect.left + rect.width / 2 ? "before" : "after",
      ...(invalid ? { invalid: true } : {}),
    };
  }
  return {
    id,
    edge: paneEdgeFromPoint(x, y, pane!.getBoundingClientRect()),
    ...(invalid ? { invalid: true } : {}),
  };
}

/** Resolve where a pane should become a new tab within the title tab strip. */
export function titleTabDropFromPoint(
  x: number,
  y: number,
): { targetTabId: string; position: TitleTabDropPosition } | null {
  const el = document.elementFromPoint(x, y);
  const strip = el?.closest("[data-title-tab-strip]") as HTMLElement | null;
  if (!strip) return null;

  const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-title-tab-id]"));
  if (tabs.length === 0) return null;

  const direct = el?.closest("[data-title-tab-id]") as HTMLElement | null;
  const target =
    direct && strip.contains(direct)
      ? direct
      : tabs.reduce((nearest, tab) => {
          const center = (tab.getBoundingClientRect().left + tab.getBoundingClientRect().right) / 2;
          const nearestCenter =
            (nearest.getBoundingClientRect().left + nearest.getBoundingClientRect().right) / 2;
          return Math.abs(x - center) < Math.abs(x - nearestCenter) ? tab : nearest;
        });
  const targetTabId = target.dataset.titleTabId;
  if (!targetTabId) return null;
  const rect = target.getBoundingClientRect();
  return {
    targetTabId,
    position: x < rect.left + rect.width / 2 ? "before" : "after",
  };
}
