import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { flushSync } from "react-dom";
import { t } from "../../../shared/i18n";
import { newSession, type Session } from "../../../features/sessions/model/session";
import {
  splitProjectTerminalsForMove,
  type ProjectTerminalDock,
} from "../../../features/projects/model/projectTerminal";
import {
  isFilesystemTab,
  leafIds,
  newTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";
import { collectWindowTransfer } from "../../model/windowTransfer";
import {
  busySessionsInTabs,
  planTabMoveRemainder,
  queueWindowMoves,
  type PendingWindowMoves,
  type WindowMovePosition,
} from "../../model/windowTransferPopout";
import { abortQuit, relinquishTransferredWindow } from "../../model/appLifecycle";
import type { TabActivation } from "../tabs/useTabActivation";

export interface MoveTabsOptions {
  position?: WindowMovePosition;
  targetWindowLabel?: string;
}

export type MoveTabsOutcome = "failed" | "queued" | "relocated" | "transferred";

export interface MoveTabsToNewWindowDeps {
  activateTab: TabActivation["activateTab"];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  projectTerminalsRef: MutableRefObject<ProjectTerminalDock[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectCwdRef: MutableRefObject<string>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  movingTabIds: MutableRefObject<Set<string>>;
  movingSessionIds: MutableRefObject<Set<string>>;
  skipForgetSessionIds: MutableRefObject<Set<string>>;
  setMovingWindows: Dispatch<SetStateAction<Set<string>>>;
  setPendingWindowMoves: Dispatch<SetStateAction<PendingWindowMoves>>;
  setProjectTerminals: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
}

/** Pops tabs out into a new window. Tabs, their sessions and project
 * terminal docks are handed to the new window's boot, then removed here.
 * Tabs with a turn in flight are queued: their stream is parsed by this
 * window's harness listeners, which a new window cannot take over. */
export function useMoveTabsToNewWindow(deps: MoveTabsToNewWindowDeps): {
  onMoveTabsToNewWindow: (
    tabIds: string[],
    opts?: MoveTabsOptions,
  ) => Promise<MoveTabsOutcome | undefined>;
} {
  const {
    activateTab,
    tabsRef,
    sessionsRef,
    projectTerminalsRef,
    activeTabIdRef,
    projectCwdRef,
    dirtyFilesRef,
    movingTabIds,
    movingSessionIds,
    skipForgetSessionIds,
    setMovingWindows,
    setPendingWindowMoves,
    setProjectTerminals,
    setSessions,
    setTabs,
    setDirtyFiles,
  } = deps;

  const onMoveTabsToNewWindow = useCallback(
    async (
      tabIds: string[],
      opts?: {
        position?: WindowMovePosition;
        targetWindowLabel?: string;
      },
    ) => {
      const movingTabs = tabsRef.current.filter((tab) => tabIds.includes(tab.id));
      if (movingTabs.length === 0) return;
      const movingIds = movingTabs.map((tab) => tab.id);
      if (movingIds.some((id) => movingTabIds.current.has(id))) return;
      const sessionIdsInMove = new Set(movingTabs.flatMap((tab) => leafIds(tab.layout)));
      if ([...sessionIdsInMove].some((id) => movingSessionIds.current.has(id))) return;
      if (
        tabsRef.current.some(
          (tab) =>
            !movingIds.includes(tab.id) &&
            leafIds(tab.layout).some((id) => sessionIdsInMove.has(id)),
        )
      ) {
        void message(
          "This conversation is also open in another tab. Close the duplicate tab before moving it to a new window.",
          {
            get title() {
              return t("Move to new window");
            },
          },
        );
        return "failed" as const;
      }
      // A shell cannot change windows: the source would kill the pty its
      // twin in the new window just respawned under the same id.
      if (filesInWorkspaceTabs(movingTabs).some((file) => file.terminal)) {
        void message("Close terminal tabs before moving this workspace to another window.", {
          get title() {
            return t("Move tab");
          },
        });
        return "failed" as const;
      }
      // A running turn lives in this window's harness listeners, so the
      // move waits until it finishes rather than dropping the stream.
      if (busySessionsInTabs(tabsRef.current, sessionsRef.current, movingIds).length > 0) {
        setPendingWindowMoves((prev) =>
          queueWindowMoves(prev, movingIds, {
            ...opts?.position,
            targetWindowLabel: opts?.targetWindowLabel,
          }),
        );
        return "queued" as const;
      }
      for (const id of movingIds) movingTabIds.current.add(id);
      // Freeze composer input before collecting its draft, attachments and model.
      flushSync(() => setMovingWindows(new Set(movingTabIds.current)));
      const lockedSessionIds = [] as string[];
      for (const tab of movingTabs) {
        for (const id of leafIds(tab.layout)) lockedSessionIds.push(id);
      }
      for (const id of lockedSessionIds) movingSessionIds.current.add(id);
      try {
        const dirtyIds = new Set(
          filesInWorkspaceTabs(movingTabs)
            .filter((file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id))
            .map((file) => file.id),
        );
        if (dirtyIds.size > 0) {
          void message("Save the unsaved files before moving this tab to another window.", {
            get title() {
              return t("Move tab");
            },
          });
          return "failed" as const;
        }

        const plan = planTabMoveRemainder(
          tabsRef.current,
          sessionsRef.current,
          movingIds,
          activeTabIdRef.current,
          projectCwdRef.current,
          getCurrentWindow().label !== "main",
        );
        const splitDocks = splitProjectTerminalsForMove(
          projectTerminalsRef.current,
          movingTabs,
          plan.remaining,
          sessionsRef.current,
        );
        if (splitDocks.moving.some((dock) => dock.pane.files.some((file) => file.terminal))) {
          void message(
            "Close project terminal tabs before moving this workspace to another window.",
            {
              get title() {
                return t("Move tab");
              },
            },
          );
          return "failed" as const;
        }
        const payload = collectWindowTransfer(
          tabsRef.current,
          sessionsRef.current,
          movingIds,
          activeTabIdRef.current,
          new Set(),
          projectCwdRef.current,
          splitDocks.moving,
        );
        if (!payload) return;

        const sessionIds = new Set(payload.sessions.map((session) => session.id));
        for (const id of sessionIds) skipForgetSessionIds.current.add(id);
        try {
          const outcome = await invoke<string>("move_window_tabs", {
            transfer: JSON.stringify(payload),
            targetWindowLabel: opts?.targetWindowLabel ?? null,
            x: opts?.position?.x ?? null,
            y: opts?.position?.y ?? null,
            clientX: opts?.position?.clientX ?? null,
            clientY: opts?.position?.clientY ?? null,
            pixelRatio: opts?.position?.pixelRatio ?? null,
            relocate: getCurrentWindow().label !== "main" && plan.remaining.length === 0,
          });
          if (outcome === "relocated") {
            for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
            return "relocated" as const;
          }
        } catch (error) {
          for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
          void message(
            `Could not move the conversation to a new window. Your tab is still here.\n\n${error instanceof Error ? error.message : String(error)}`,
            {
              get title() {
                return t("Move to new window");
              },
            },
          );
          return "failed" as const;
        }

        let closeDrainedWindow = false;
        flushSync(() => {
          const currentPlan = planTabMoveRemainder(
            tabsRef.current,
            sessionsRef.current,
            movingIds,
            activeTabIdRef.current,
            projectCwdRef.current,
            getCurrentWindow().label !== "main",
          );
          setProjectTerminals(
            (prev) =>
              splitProjectTerminalsForMove(
                prev,
                movingTabs,
                currentPlan.remaining,
                sessionsRef.current,
              ).remaining,
          );
          let remainingTabs = currentPlan.remaining;
          let nextActive = currentPlan.nextActiveTabId;
          closeDrainedWindow = currentPlan.closeWindow;
          if (currentPlan.needsSeed && !closeDrainedWindow) {
            const seedSession = sessionsRef.current.find((session) => sessionIds.has(session.id));
            const session = newSession(
              seedSession?.harness ?? "claude",
              seedSession?.cwd ?? projectCwdRef.current,
              seedSession?.model,
              seedSession?.runtimeMode,
              seedSession?.modelSettings,
            );
            const tab = newTab(session.id);
            setSessions((prev) => [...prev.filter((entry) => !sessionIds.has(entry.id)), session]);
            remainingTabs = [...remainingTabs, tab];
            nextActive = tab.id;
          } else {
            setSessions((prev) => prev.filter((session) => !sessionIds.has(session.id)));
          }
          setTabs(remainingTabs);
          if (nextActive) activateTab(nextActive);
          setDirtyFiles((prev) => {
            const next = new Set(prev);
            for (const id of dirtyIds) next.delete(id);
            return next;
          });
        });
        if (closeDrainedWindow) {
          relinquishTransferredWindow();
          try {
            await getCurrentWindow().destroy();
          } catch (error) {
            abortQuit();
            void message(
              `The tab was moved, but its empty window could not close.\n\n${String(error)}`,
              {
                get title() {
                  return t("Move tab");
                },
              },
            );
          }
        }
        for (const id of sessionIds) skipForgetSessionIds.current.delete(id);
        return "transferred" as const;
      } finally {
        for (const id of movingIds) movingTabIds.current.delete(id);
        setMovingWindows(new Set(movingTabIds.current));
        for (const id of lockedSessionIds) movingSessionIds.current.delete(id);
      }
    },
    [activateTab],
  );

  return { onMoveTabsToNewWindow };
}
