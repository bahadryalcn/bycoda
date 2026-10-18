import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  lastProjectPath,
  loadRecents,
  looksLikeProject,
  rememberProject,
} from "../../../features/projects/model/recents";
import {
  reconcileProjectReturn,
  type ProjectReturnMemory,
} from "../../../features/projects/model/projectReturn";
import {
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "../../../features/sessions/model/inFlight";
import {
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "../../../features/sessions/data/sessionStore";
import type { Session } from "../../../features/sessions/model/session";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../../../features/workspace/model/workspaceSnapshot";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";
import { useServerTerminalRestoreState } from "../../../features/connections/model/serverTerminalRestoreState";

export interface WorkspaceSnapshotSyncDeps {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  projectCwd: string;
  projectTerminals: ProjectTerminalDockState["projectTerminals"];
  lastDockSide: ProjectTerminalDockState["lastDockSide"];
  windowTransfer: WindowTransferPayload | null | undefined;
  toolWindow: ToolWindow | null | undefined;
  keepWorkspaceTab: (tab: WorkspaceTab) => boolean;
  projectReturnRef: MutableRefObject<ProjectReturnMemory>;
  /** `projectWorktree?.path` at the call site (same value, used only as a dependency). */
  projectWorktreePath: string | undefined;
  /** `workspaceNavigation.revision` at the call site (same value, used only as a dependency). */
  workspaceNavigationRevision: number;
  remoteBindingRevision: number;
  inFlightSyncKey: MutableRefObject<string | null>;
  sawInFlight: MutableRefObject<boolean>;
  workspaceSyncKey: MutableRefObject<string | null>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<ReturnType<typeof loadRecents>>>;
}

/**
 * In-flight session sync, debounced workspace snapshot save and the one-time
 * `default_cwd` seed. Three effects in their original order.
 */
export function useWorkspaceSnapshotSync({
  tabs,
  sessions,
  activeTabId,
  projectCwd,
  projectTerminals,
  lastDockSide,
  windowTransfer,
  toolWindow,
  keepWorkspaceTab,
  projectReturnRef,
  projectWorktreePath,
  workspaceNavigationRevision,
  remoteBindingRevision,
  inFlightSyncKey,
  sawInFlight,
  workspaceSyncKey,
  setProjectCwd,
  setRecents,
}: WorkspaceSnapshotSyncDeps): void {
  const serverRestore = useServerTerminalRestoreState();
  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (!shouldWriteInFlightSnapshot(key, refs, inFlightSyncKey.current, sawInFlight.current)) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch((error) => {
      console.warn("App operation failed", error);
    });
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer || toolWindow) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      reconcileProjectReturn({
        memory: projectReturnRef.current,
        tabs,
        sessions,
        activeTabId,
      }),
      projectTerminals,
      lastDockSide ?? undefined,
      keepWorkspaceTab,
    );
    const key = workspaceSnapshotKey(snapshot);
    if (workspaceSyncKey.current === key) return;
    const timer = window.setTimeout(() => {
      workspaceSyncKey.current = key;
      void saveWorkspaceSnapshot(snapshot).catch(() => {
        if (workspaceSyncKey.current === key) workspaceSyncKey.current = null;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    toolWindow,
    keepWorkspaceTab,
    projectWorktreePath,
    workspaceNavigationRevision,
    remoteBindingRevision,
    serverRestore.initialized,
    serverRestore.restore,
  ]);

  useEffect(() => {
    if (lastProjectPath()) return;
    void invoke<string>("default_cwd")
      .then((cwd) => {
        if (!looksLikeProject(cwd)) return;
        setProjectCwd(cwd);
        setRecents((prev) => (prev.length > 0 ? prev : rememberProject(cwd)));
        setSessions((prev) => prev.map((s) => (s.cwd === "~" ? { ...s, cwd } : s)));
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
  }, []);
}
