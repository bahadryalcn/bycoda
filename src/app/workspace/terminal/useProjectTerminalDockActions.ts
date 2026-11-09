import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  closeTerminalInDock,
  findProjectTerminal,
  mapProjectTerminal,
  patchProjectTerminals,
  reorderDockTerminals,
  selectDockTerminal,
  withDockOpen,
  withDockSide,
  withDockSize,
  type DockSide,
} from "../../../features/projects/model/projectTerminal";
import { canOpenTerminalIn } from "../../../features/projects/model/recents";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../../../features/terminal/model/terminalClose";
import { type TerminalMetaPatch } from "../../../features/terminal/model/terminalTab";
import {
  updateTerminalTab,
  withSurfacePanes,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { orderByIds } from "../../../shared/lib/reorder";
import { type ProjectTerminalDockState } from "./useProjectTerminalDockState";

export interface ProjectTerminalDockActionDeps {
  dock: ProjectTerminalDockState;
  projectCwd: string;
  projectCwdRef: MutableRefObject<string>;
  terminalCwd: string;
  focusProjectTerminal: () => void;
  openProjectTerminal: (cwd: string, profile?: string) => boolean;
  onOpenTerminal: (
    cwd: string,
    asWorkspaceTab?: boolean,
    occupySessionId?: string,
    profile?: string,
  ) => void;
  activeTabIdRef: MutableRefObject<string>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
}

/** Dock visibility, side, size, terminal selection, close and running-terminal actions. */
export function useProjectTerminalDockActions(deps: ProjectTerminalDockActionDeps) {
  const {
    dock,
    projectCwd,
    projectCwdRef,
    terminalCwd,
    focusProjectTerminal,
    openProjectTerminal,
    onOpenTerminal,
    activeTabIdRef,
    tabsRef,
    setActiveTabId,
    setComposerFocused,
    setTabs,
  } = deps;
  const { setProjectTerminals, setProjectTerminalFocused, setLastDockSide, projectTerminalsRef } =
    dock;

  const onToggleProjectTerminal = useCallback(() => {
    if (!canOpenTerminalIn(projectCwd)) return;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (!dock) {
      openProjectTerminal(terminalCwd);
      return;
    }
    const nextOpen = !dock.open;
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwd, (entry) => withDockOpen(entry, nextOpen)),
    );
    if (nextOpen) focusProjectTerminal();
    else setProjectTerminalFocused(false);
  }, [terminalCwd, focusProjectTerminal, openProjectTerminal, projectCwd]);

  const onHideProjectTerminal = useCallback(() => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) => withDockOpen(dock, false)),
    );
    setProjectTerminalFocused(false);
  }, []);

  const onProjectTerminalSide = useCallback((side: DockSide) => {
    setLastDockSide(side);
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSide(dock, side, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onProjectTerminalSize = useCallback((size: number) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSize(dock, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onSelectProjectTerminal = useCallback(
    (fileId: string) => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (dock) => selectDockTerminal(dock, fileId)),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onReorderProjectTerminals = useCallback((ids: string[]) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        reorderDockTerminals(dock, orderByIds(dock.pane.files, ids)),
      ),
    );
  }, []);

  const onCloseProjectTerminal = useCallback((fileId: string) => {
    const projectPath = projectCwdRef.current;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    const file = dock?.pane.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (entry) => closeTerminalInDock(entry, fileId)),
      );
    };
    // The last terminal takes the panel with it, so it asks even when idle.
    const last = dock?.pane.files.length === 1;
    void confirmCloseTerminal(file, { last }).then((ok) => ok && finishClose());
  }, []);

  /** Closes every terminal but `keepId`; without it, every terminal and the panel. */
  const onCloseProjectTerminals = useCallback((keepId?: string) => {
    const projectPath = projectCwdRef.current;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    if (!dock) return;
    if (keepId !== undefined && !dock.pane.files.some((file) => file.id === keepId)) return;
    const closingFiles = dock.pane.files.filter((file) => file.id !== keepId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));

    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (entry) => {
          if (keepId !== undefined && !entry.pane.files.some((file) => file.id === keepId)) {
            return entry;
          }
          // A terminal opened while the dialog was up stays.
          let next: typeof entry | null = entry;
          for (const id of closingIds) next = next && closeTerminalInDock(next, id);
          return next && keepId !== undefined ? selectDockTerminal(next, keepId) : next;
        }),
      );
    };

    void confirmCloseTerminals(closingFiles).then((ok) => ok && finishClose());
  }, []);

  const onTerminalMetaChange = useCallback((fileId: string, patch: TerminalMetaPatch) => {
    setProjectTerminals((prev) => patchProjectTerminals(prev, fileId, patch));
    setTabs((prev) => prev.map((tab) => updateTerminalTab(tab, fileId, patch)));
  }, []);

  const onToggleRunningTerminal = useCallback(
    (fileId: string) => {
      const dock = projectTerminalsRef.current.find((entry) =>
        entry.pane.files.some((file) => file.id === fileId),
      );
      if (dock) {
        if (dock.open) {
          setProjectTerminals((prev) =>
            mapProjectTerminal(prev, dock.projectPath, (entry) => withDockOpen(entry, false)),
          );
          setProjectTerminalFocused(false);
          return;
        }
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, dock.projectPath, (entry) =>
            withDockOpen(selectDockTerminal(entry, fileId), true),
          ),
        );
        focusProjectTerminal();
        return;
      }
      for (const tab of tabsRef.current) {
        for (const pane of tab.terminalPanes ?? []) {
          if (!pane.files.some((file) => file.id === fileId)) continue;
          const showing =
            activeTabIdRef.current === tab.id &&
            tab.focusedId === pane.id &&
            pane.activeFileId === fileId;
          if (showing) {
            setComposerFocused(true);
            setProjectTerminalFocused(false);
            return;
          }
          setActiveTabId(tab.id);
          setTabs((prev) =>
            prev.map((entry) => {
              if (entry.id !== tab.id) return entry;
              return withSurfacePanes(
                { ...entry, focusedId: pane.id },
                "terminal",
                (entry.terminalPanes ?? []).map((item) =>
                  item.id === pane.id ? { ...item, activeFileId: fileId } : item,
                ),
              );
            }),
          );
          setProjectTerminalFocused(false);
          setComposerFocused(false);
          return;
        }
      }
    },
    [focusProjectTerminal],
  );

  const onNewTerminalTab = useCallback(() => {
    onOpenTerminal(terminalCwd, true);
  }, [terminalCwd, onOpenTerminal]);

  return {
    onToggleProjectTerminal,
    onHideProjectTerminal,
    onProjectTerminalSide,
    onProjectTerminalSize,
    onSelectProjectTerminal,
    onReorderProjectTerminals,
    onCloseProjectTerminal,
    onCloseProjectTerminals,
    onTerminalMetaChange,
    onToggleRunningTerminal,
    onNewTerminalTab,
  };
}
