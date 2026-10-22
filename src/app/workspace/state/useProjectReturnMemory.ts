import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  reconcileProjectReturn,
  type ProjectReturnMemory,
} from "../../../features/projects/model/projectReturn";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ResumedWorkspace } from "../../model/appLifecycle";

export interface ProjectReturnMemoryDeps {
  resumed: ResumedWorkspace | null;
  tabs: WorkspaceTab[];
  activeTabId: string;
  sessions: Session[];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
}

/** Remembers which project each tab returns to, reconciled whenever tabs or sessions change. */
export function useProjectReturnMemory({
  resumed,
  tabs,
  activeTabId,
  sessions,
  tabsRef,
  activeTabIdRef,
}: ProjectReturnMemoryDeps) {
  const projectReturnRef = useRef<ProjectReturnMemory>(resumed?.projectReturnMemory ?? new Map());
  const readProjectReturnMemory = useCallback(() => {
    projectReturnRef.current = reconcileProjectReturn({
      memory: projectReturnRef.current,
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
      activeTabId: activeTabIdRef.current,
    });
    return projectReturnRef.current;
  }, []);
  useEffect(() => {
    readProjectReturnMemory();
  }, [activeTabId, tabs, sessions, readProjectReturnMemory]);
  return { projectReturnRef, readProjectReturnMemory };
}
