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
  const dockGridRef = useRef<HTMLDivElement>(null);
  const dockDragSize = useRef<number | null>(null);
  const paintDockSize = useCallback((size: number) => {
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwdRef.current);
    const el = dockGridRef.current;
    if (!dock || !el) return;
    dockDragSize.current = size;
    applyDockGridStyle(el, dock.side, size);
  }, []);
  const commitDockSize = useCallback(
    (size: number) => {
      dockDragSize.current = null;
      onProjectTerminalSize(size);
    },
    [onProjectTerminalSize],
  );
  useLayoutEffect(() => {
    if (dockDragSize.current != null) return;
    const el = dockGridRef.current;
    if (!el) return;
    applyDockGridStyle(
      el,
      dockVisible && currentProjectDock ? currentProjectDock.side : null,
      currentProjectDock?.size ?? 0,
    );
  }, [currentProjectDock, dockVisible]);
  return { dockGridRef, paintDockSize, commitDockSize };
}
