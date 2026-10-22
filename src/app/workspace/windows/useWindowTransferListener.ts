import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { flushSync } from "react-dom";
import { persistFingerprint } from "../../../features/sessions/data/sessionStore";
import type { Session } from "../../../features/sessions/model/session";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import {
  clearWindowDragPreview,
  paneDropFromPoint,
  titleTabDropFromPoint,
} from "../../../features/workspace/model/paneDrop";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";
import { lastUserBlockId } from "../helpers/sessionHelpers";
import {
  mergeWindowTransfer,
  parseWindowTransfer,
  removeWindowTransfer,
  restoreTransferredDrafts,
} from "../../model/windowTransfer";
import { windowDropPointToClient } from "../../model/windowTransferPopout";
import type { TabActivation } from "../tabs/useTabActivation";

export interface WindowTransferListenerDeps {
  activateTab: TabActivation["activateTab"];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  projectTerminalsRef: MutableRefObject<ProjectTerminalDock[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectCwdRef: MutableRefObject<string>;
  movingTabIds: MutableRefObject<Set<string>>;
  movingSessionIds: MutableRefObject<Set<string>>;
  skipForgetSessionIds: MutableRefObject<Set<string>>;
  observedSessions: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  lastBoundProvider: MutableRefObject<Map<string, string>>;
  lastPersistedUserBlock: MutableRefObject<Map<string, string>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setProjectTerminals: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setMovingWindows: Dispatch<SetStateAction<Set<string>>>;
}

/** Receives tabs moved from another window (`window_transfer_available`). */
export function useWindowTransferListener(deps: WindowTransferListenerDeps): void {
  const {
    activateTab,
    tabsRef,
    sessionsRef,
    projectTerminalsRef,
    activeTabIdRef,
    projectCwdRef,
    movingTabIds,
    movingSessionIds,
    skipForgetSessionIds,
    observedSessions,
    lastPersisted,
    lastBoundProvider,
    lastPersistedUserBlock,
    pendingPersist,
    setTabs,
    setSessions,
    setProjectTerminals,
    setProjectCwd,
    setMovingWindows,
  } = deps;

  useEffect(() => {
    // Scope this listener to the receiving webview; a global listener would
    // let every open window consume the same move notification.
    let disposed = false;
    const receiving = new Set<string>();
    const listening = getCurrentWebviewWindow().listen<string>(
      "window_transfer_available",
      async ({ payload: transferId }) => {
        if (disposed || receiving.has(transferId)) return;
        receiving.add(transferId);
        let rollback: (() => void) | undefined;
        let incomingTabIds: string[] = [];
        let incomingSessionIds = new Set<string>();
        try {
          const raw = await invoke<string | null>("take_window_transfer", {
            transferId,
          });
          if (!raw) return;
          if (disposed) throw new Error("The destination window is no longer ready.");
          const incoming = parseWindowTransfer(raw);
          const dropPoint = incoming.dropPoint ? windowDropPointToClient(incoming.dropPoint) : null;
          const paneTarget = dropPoint ? paneDropFromPoint(dropPoint.x, dropPoint.y) : null;
          const titleTarget = dropPoint ? titleTabDropFromPoint(dropPoint.x, dropPoint.y) : null;
          if (paneTarget?.invalid && !titleTarget)
            throw new Error("This panel is not ready to receive a transfer.");
          if (incoming.dropPoint && !paneTarget && !titleTarget)
            throw new Error("Drop the tab on a tab group or a panel to place it in this window.");
          if (
            paneTarget &&
            !titleTarget &&
            tabsRef.current.some(
              (tab) =>
                movingTabIds.current.has(tab.id) && leafIds(tab.layout).includes(paneTarget.id),
            )
          )
            throw new Error(
              "This panel is moving to another window. Wait for that move to finish.",
            );
          const beforeTabs = tabsRef.current;
          const merged = mergeWindowTransfer(
            beforeTabs,
            sessionsRef.current,
            projectTerminalsRef.current,
            incoming,
            paneTarget,
            titleTarget,
          );
          clearWindowDragPreview();
          const priorActive = activeTabIdRef.current;
          const priorCwd = projectCwdRef.current;
          incomingSessionIds = new Set(incoming.sessions.map((session) => session.id));
          const incomingPaneIds = new Set(incoming.tabs.flatMap((tab) => leafIds(tab.layout)));
          const incomingFileIds = new Set(
            filesInWorkspaceTabs(incoming.tabs).map((file) => file.id),
          );
          incomingTabIds = merged.tabs
            .filter(
              (tab) =>
                leafIds(tab.layout).some((id) => incomingPaneIds.has(id)) ||
                filesInWorkspaceTabs([tab]).some((file) => incomingFileIds.has(file.id)),
            )
            .map((tab) => tab.id);
          const priorObserved = new Map(
            incoming.sessions.map((session) => [
              session.id,
              observedSessions.current.get(session.id),
            ]),
          );
          const priorPersisted = new Map(
            incoming.sessions.map((session) => [session.id, lastPersisted.current.get(session.id)]),
          );
          const priorBound = new Map(
            incoming.sessions.map((session) => [
              session.id,
              lastBoundProvider.current.get(session.id),
            ]),
          );
          const priorUserBlock = new Map(
            incoming.sessions.map((session) => [
              session.id,
              lastPersistedUserBlock.current.get(session.id),
            ]),
          );
          const addedDockIds = new Set(
            merged.projectTerminals
              .filter((dock) => !projectTerminalsRef.current.includes(dock))
              .map((dock) => dock.pane.id),
          );
          rollback = () => {
            for (const id of incomingSessionIds) skipForgetSessionIds.current.add(id);
            flushSync(() => {
              setTabs((prev) =>
                removeWindowTransfer(prev, incoming, { before: beforeTabs, accepted: merged.tabs }),
              );
              setSessions((prev) => prev.filter((session) => !incomingSessionIds.has(session.id)));
              setProjectTerminals((prev) => prev.filter((dock) => !addedDockIds.has(dock.pane.id)));
              if (activeTabIdRef.current === merged.activeTabId) {
                setProjectCwd(priorCwd);
                activateTab(priorActive);
              }
            });
            // The imported draft is also the source's latest draft. Keep that
            // cache copy: restoring an older receiver copy would overwrite the
            // shared persisted draft while the source is still holding it.
            for (const id of incomingSessionIds) {
              const observed = priorObserved.get(id);
              if (observed) observedSessions.current.set(id, observed);
              else observedSessions.current.delete(id);
              const persisted = priorPersisted.get(id);
              if (persisted !== undefined) lastPersisted.current.set(id, persisted);
              else lastPersisted.current.delete(id);
              const bound = priorBound.get(id);
              if (bound !== undefined) lastBoundProvider.current.set(id, bound);
              else lastBoundProvider.current.delete(id);
              const userBlock = priorUserBlock.get(id);
              if (userBlock !== undefined) lastPersistedUserBlock.current.set(id, userBlock);
              else lastPersistedUserBlock.current.delete(id);
              pendingPersist.current.delete(id);
              skipForgetSessionIds.current.delete(id);
            }
          };
          restoreTransferredDrafts(incoming);
          for (const session of incoming.sessions) {
            observedSessions.current.set(session.id, session);
            lastPersisted.current.set(session.id, persistFingerprint(session));
            const userId = lastUserBlockId(session);
            if (userId) lastPersistedUserBlock.current.set(session.id, userId);
            if (session.providerSessionId)
              lastBoundProvider.current.set(session.id, session.providerSessionId);
          }
          flushSync(() => {
            for (const id of incomingTabIds) movingTabIds.current.add(id);
            for (const id of incomingSessionIds) movingSessionIds.current.add(id);
            setMovingWindows(new Set(movingTabIds.current));
            tabsRef.current = merged.tabs;
            projectTerminalsRef.current = merged.projectTerminals;
            setSessions(merged.sessions);
            setTabs(merged.tabs);
            setProjectTerminals(merged.projectTerminals);
            setProjectCwd(incoming.projectCwd);
            activateTab(merged.activeTabId);
          });
          await invoke("window_transfer_ready", { transferId });
        } catch (error) {
          rollback?.();
          await invoke("reject_window_transfer", {
            transferId,
            reason: String(error),
          }).catch(console.error);
          clearWindowDragPreview();
        } finally {
          receiving.delete(transferId);
          for (const id of incomingTabIds) movingTabIds.current.delete(id);
          for (const id of incomingSessionIds) movingSessionIds.current.delete(id);
          if (!disposed) setMovingWindows(new Set(movingTabIds.current));
        }
      },
    );
    return () => {
      disposed = true;
      clearWindowDragPreview();
      void listening.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [activateTab]);
}
