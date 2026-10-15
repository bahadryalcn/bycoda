import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  applyWindowDragPreview,
  clearWindowDragPreview,
} from "../../features/workspace/model/paneDrop";
import type { WindowTabDragHover } from "./windowDragPreview";
import { windowDropPointToClient } from "./windowTransferPopout";

export function useWindowDragPreview(
  openPaneIds?: () => ReadonlySet<string>,
  canReceiveAtPoint?: (x: number, y: number) => boolean,
) {
  const openPaneIdsRef = useRef(openPaneIds);
  openPaneIdsRef.current = openPaneIds;
  const canReceiveRef = useRef(canReceiveAtPoint);
  canReceiveRef.current = canReceiveAtPoint;
  useEffect(() => {
    const revisions = new Map<string, number>();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let active: string | undefined;
    let disposed = false;
    const closed = new Set<string>();
    const listening = getCurrentWebviewWindow().listen<WindowTabDragHover>(
      "window_tab_drag_hover",
      ({ payload }) => {
        if (disposed || payload.revision <= (revisions.get(payload.sourceWindowLabel) ?? -1))
          return;
        revisions.set(payload.sourceWindowLabel, payload.revision);
        const token = `window:${payload.sourceWindowLabel}:${payload.dragId}`;
        if (payload.ended) {
          closed.add(token);
          if (closed.size > 64) closed.delete(closed.values().next().value!);
          clearWindowDragPreview(token);
          if (active === token) {
            clearTimeout(watchdog);
            active = undefined;
          }
          return;
        }
        if (closed.has(token)) return;
        if (typeof payload.x !== "number" || typeof payload.y !== "number") return;
        if (active && active !== token) clearWindowDragPreview(active);
        active = token;
        const point = windowDropPointToClient({
          x: payload.x,
          y: payload.y,
          scaleFactor: payload.scaleFactor,
        });
        const ids = openPaneIdsRef.current?.();
        const invalid =
          Boolean(ids && (payload.sourceIds ?? [payload.sourceId]).some((id) => ids.has(id))) ||
          canReceiveRef.current?.(point.x, point.y) === false;
        applyWindowDragPreview(
          token,
          point.x,
          point.y,
          invalid,
          payload.sourceId.startsWith("file:"),
        );
        clearTimeout(watchdog);
        // Source sends heartbeats while hovering; a crashed source cannot leave an overlay behind.
        watchdog = setTimeout(() => {
          clearWindowDragPreview(token);
          active = undefined;
        }, 1800);
      },
    );
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      if (active) clearWindowDragPreview(active);
      void listening.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}
