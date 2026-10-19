import { useEffect, type MutableRefObject } from "react";
import { retainAsyncSubscription } from "../../../shared/lib/asyncSubscription";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  closeBusyWindow,
  hasInFlightSessions,
  hideCurrentWindow,
  persistLiveTranscripts,
  persistQuitState,
  setQuitWorkspace,
} from "../../model/appLifecycle";
import { loadCloseToTray } from "../../../features/settings/model/settings";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type {
  DockSide,
  ProjectTerminalDock as ProjectTerminal,
} from "../../../features/projects/model/projectTerminal";
import type { ProjectReturnMemory } from "../../../features/projects/model/projectReturn";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ToolWindow } from "../../model/toolWindows";

export interface SessionPersistenceFlushDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectCwdRef: MutableRefObject<string>;
  projectTerminalsRef: MutableRefObject<ProjectTerminal[]>;
  lastDockSideRef: MutableRefObject<DockSide | null>;
  readProjectReturnMemory: () => ProjectReturnMemory;
  flushHarnessEvents: () => void;
  keepWorkspaceTab: (tab: WorkspaceTab) => boolean;
  windowTransfer: WindowTransferPayload | null | undefined;
  toolWindow: ToolWindow | null | undefined;
}

// Window quit/close flush: persists the workspace snapshot before the window
// closes or hides. Keeps the effect's position and deps from Workspace.
export function useSessionPersistenceFlush({
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  projectTerminalsRef,
  lastDockSideRef,
  readProjectReturnMemory,
  flushHarnessEvents,
  keepWorkspaceTab,
  windowTransfer,
  toolWindow,
}: SessionPersistenceFlushDeps): void {
  useEffect(() => {
    let releaseClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      readProjectReturnMemory,
      flushHarnessEvents,
      () => lastDockSideRef.current,
      keepWorkspaceTab,
    );
    releaseClose = retainAsyncSubscription(
      getCurrentWindow().onCloseRequested((event) => {
        // Listening here makes close our job. Letting the default path run
        // calls JS `window.destroy`, which Tauri denies without a permission.
        event.preventDefault();
        const toTray = loadCloseToTray();
        // Every actual destroy shares editor, terminal and strict persistence gates.
        if (
          !toTray &&
          (!hasInFlightSessions(sessionsRef.current) || (!windowTransfer && !toolWindow && !IS_MAC))
        ) {
          void closeBusyWindow().catch((error) => console.warn("Closing window failed", error));
          return;
        }
        if (hasInFlightSessions(sessionsRef.current)) {
          flushHarnessEvents();
          // Not `persistQuitState`: that marks the live turns interrupted.
          void persistLiveTranscripts(sessionsRef.current).catch((error) =>
            console.warn("Persisting live transcripts failed", error),
          );
          void hideCurrentWindow().catch((error) => console.warn("Hiding window failed", error));
          return;
        }
        void persistQuitState(
          sessionsRef.current,
          tabsRef.current,
          activeTabIdRef.current,
          projectCwdRef.current,
          readProjectReturnMemory(),
          "unload",
          projectTerminalsRef.current,
          lastDockSideRef.current ?? undefined,
          keepWorkspaceTab,
        )
          .then(() => {
            void hideCurrentWindow().catch((error) => console.warn("Closing window failed", error));
          })
          .catch((error) => console.warn("Persisting close state failed", error));
      }),
      (error) => console.warn("Window close subscription failed", error),
    );
    return () => {
      releaseQuit();
      releaseClose?.();
    };
  }, [flushHarnessEvents, readProjectReturnMemory, windowTransfer, toolWindow]);
}
