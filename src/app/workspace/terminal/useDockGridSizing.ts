import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from "react";
import {
  applyDockGridStyle,
  findProjectTerminal,
} from "../../../features/projects/model/projectTerminal";
import { type ProjectTerminalDockState } from "./useProjectTerminalDockState";

export interface DockGridSizingDeps {
  dock: ProjectTerminalDockState;
  projectCwdRef: MutableRefObject<string>;
  onProjectTerminalSize: (size: number) => void;
}

/** Paints the dock grid while dragging and keeps its style in sync with the committed dock. */
export function useDockGridSizing(deps: DockGridSizingDeps) {
  const { dock, projectCwdRef, onProjectTerminalSize } = deps;
  const { projectTerminalsRef, currentProjectDock, dockVisible } = dock;
  const dockGridEl = useRef<HTMLDivElement | null>(null);
  const dockDragSize = useRef<number | null>(null);
  const side = dockVisible && currentProjectDock ? currentProjectDock.side : null;
  const committed = useRef({ side, size: currentProjectDock?.size ?? 0 });
  // The grid element can mount again (a re-parented layout) while the dock stays the
  // same; the template lives only in its inline style, so every new element gets it.
  const dockGridRef = useCallback((el: HTMLDivElement | null) => {
    dockGridEl.current = el;
    if (!el) return;
    const { side, size } = committed.current;
    applyDockGridStyle(
      el,
      side,
      dockDragSize.current != null && side ? dockDragSize.current : size,
    );
  }, []);
  const paintDockSize = useCallback(
    (size: number) => {
      const dock = findProjectTerminal(projectTerminalsRef.current, projectCwdRef.current);
      const el = dockGridEl.current;
      if (!dock || !el) return;
      dockDragSize.current = size;
      applyDockGridStyle(el, dock.side, size);
    },
    [projectTerminalsRef, projectCwdRef],
  );
  const commitDockSize = useCallback(
    (size: number) => {
      dockDragSize.current = null;
      onProjectTerminalSize(size);
    },
    [onProjectTerminalSize],
  );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the dock grid's DOM template in step with the committed dock.
  useLayoutEffect(() => {
    committed.current = { side, size: currentProjectDock?.size ?? 0 };
    const el = dockGridEl.current;
    if (!el) return;
    // A live drag keeps its painted size. A hidden dock has no drag, so its row always
    // goes, even when a drag's end was lost; otherwise an empty row stays under the chat.
    if (dockDragSize.current != null && side) return;
    dockDragSize.current = null;
    applyDockGridStyle(el, side, currentProjectDock?.size ?? 0);
  }, [currentProjectDock, side]);
  return { dockGridRef, paintDockSize, commitDockSize };
}
