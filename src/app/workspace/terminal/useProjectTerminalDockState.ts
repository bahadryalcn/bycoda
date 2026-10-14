import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  findProjectTerminal,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../../features/projects/model/projectTerminal";

export interface ProjectTerminalDockStateDeps {
  /** Initial project docks (window transfer, else resumed snapshot). Lazy, as before. */
  initialProjectTerminals: () => ProjectTerminal[];
  /** Initial dock side for new projects. Lazy, as before. */
  initialLastDockSide: () => DockSide | null;
  projectCwd: string;
}

export interface ProjectTerminalDockState {
  projectTerminals: ProjectTerminal[];
  setProjectTerminals: Dispatch<SetStateAction<ProjectTerminal[]>>;
  lastDockSide: DockSide | null;
  setLastDockSide: Dispatch<SetStateAction<DockSide | null>>;
  lastDockSideRef: MutableRefObject<DockSide | null>;
  projectTerminalFocused: boolean;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  projectTerminalsRef: MutableRefObject<ProjectTerminal[]>;
  projectTerminalFocusedRef: MutableRefObject<boolean>;
  currentProjectDock: ProjectTerminal | undefined;
  dockVisible: boolean;
}

/** Project terminal dock state, its render-time ref mirrors, and the current project's dock. */
export function useProjectTerminalDockState(
  deps: ProjectTerminalDockStateDeps,
): ProjectTerminalDockState {
  const { initialProjectTerminals, initialLastDockSide, projectCwd } = deps;
  const [projectTerminals, setProjectTerminals] =
    useState<ProjectTerminal[]>(initialProjectTerminals);
  /** Dock side a brand-new project's terminal starts with, persisted in the workspace snapshot. */
  const [lastDockSide, setLastDockSide] = useState<DockSide | null>(initialLastDockSide);
  const lastDockSideRef = useRef(lastDockSide);
  lastDockSideRef.current = lastDockSide;
  const [projectTerminalFocused, setProjectTerminalFocused] = useState(false);
  const projectTerminalsRef = useRef(projectTerminals);
  projectTerminalsRef.current = projectTerminals;
  const projectTerminalFocusedRef = useRef(projectTerminalFocused);
  projectTerminalFocusedRef.current = projectTerminalFocused;
  const currentProjectDock = findProjectTerminal(projectTerminals, projectCwd);
  const dockVisible = !!currentProjectDock?.open;
  return {
    projectTerminals,
    setProjectTerminals,
    lastDockSide,
    setLastDockSide,
    lastDockSideRef,
    projectTerminalFocused,
    setProjectTerminalFocused,
    projectTerminalsRef,
    projectTerminalFocusedRef,
    currentProjectDock,
    dockVisible,
  };
}
