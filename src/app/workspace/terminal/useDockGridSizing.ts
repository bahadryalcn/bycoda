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
  const paintDockSize = useCallback(
    (size: number) => {
      const dock = findProjectTerminal(projectTerminalsRef.current, projectCwdRef.current);
      const el = dockGridRef.current;
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
    const el = dockGridRef.current;
    if (!el) return;
    const side = dockVisible && currentProjectDock ? currentProjectDock.side : null;
    // A live drag keeps its painted size. A hidden dock has no drag, so its row always
    // goes, even when a drag's end was lost; otherwise an empty row stays under the chat.
    if (dockDragSize.current != null && side) return;
    dockDragSize.current = null;
    applyDockGridStyle(el, side, currentProjectDock?.size ?? 0);
  }, [currentProjectDock, dockVisible]);
  return { dockGridRef, paintDockSize, commitDockSize };
}
