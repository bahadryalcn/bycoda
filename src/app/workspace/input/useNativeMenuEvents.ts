import { useEffect, type MutableRefObject } from "react";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  zoomInUiScale,
  zoomOutUiScale,
} from "../../../features/settings/model/uiScale";
import { saveAutosave } from "../../../features/settings/model/settings";
import { openFindInActiveEditor } from "../../../features/files/editor/editorFindBridge";
import { openUsageGuide } from "../../../features/onboarding/model/usageGuide";
import {
  BACKGROUND_NOTIFICATION_TARGETS,
  NOTIFICATION_CLICK_EVENT,
} from "../../../features/notifications/model/notifications";
import { isLeadWindow } from "../../../features/notifications/hooks/useBackgroundNotifications";
import { requestSummaryPanel } from "../../../features/tasks/model/dailySummaryClient";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { restoreWindowFocus } from "../../model/windowFocus";
import { runUpdateFlow } from "../../model/updater";
import type { WorkspaceActions, WorkspaceRun } from "./useWorkspaceActions";

export interface NativeMenuEventDeps {
  actions: MutableRefObject<WorkspaceActions>;
  run: WorkspaceRun;
}

/** Subscribes to native menu and app-level Tauri events for the workspace. */
export function useNativeMenuEvents({ actions, run }: NativeMenuEventDeps): void {
  useEffect(() => {
    const unlisten = [
      listenWindow("new_tab", () => run("new", actions.current.onNew)),
      listenWindow("close_other_tabs", () => run("close-others", actions.current.onCloseOtherTabs)),
      listenWindow("close_all_tabs", () => run("close-all", actions.current.onCloseAllTabs)),
      listenWindow("close_tab", () => run("close", actions.current.onClosePane)),
      // Autosave is a shared setting; every workspace applies the broadcast.
      listenWindow<boolean>("toggle_autosave", ({ payload }) => {
        const saved = saveAutosave(payload);
        if (saved !== payload && IS_MAC) {
          void invoke("autosave_set_enabled", { enabled: saved });
        }
      }),
      listenWindow("next_tab", () => run("next", actions.current.onNext)),
      listenWindow("prev_tab", () => run("prev", actions.current.onPrev)),
      listenWindow("back_tab", () => run("back", actions.current.onVisitBack)),
      listenWindow("forward_tab", () => run("forward", actions.current.onVisitForward)),
      listenWindow("split_right", () => run("split-right", () => actions.current.onSplit("right"))),
      listenWindow("split_down", () => run("split-down", () => actions.current.onSplit("down"))),
      ...(
        [
          ["layout_columns", "columns"],
          ["layout_rows", "rows"],
          ["layout_grid", "grid"],
          ["layout_main_left", "main-left"],
          ["layout_main_top", "main-top"],
          ["layout_equalize", "equalize"],
        ] as const
      ).map(([event, preset]) =>
        listenWindow(event, () => run(event, () => actions.current.onArrangeActiveTab(preset))),
      ),
      listenWindow("new_terminal", () => run("new-terminal", actions.current.onNewTerminal)),
      listenWindow("new_terminal_tab", () =>
        run("new-terminal-tab", actions.current.onNewTerminalTab),
      ),
      listenWindow("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listenWindow("focus_left", () => run("focus-left", () => actions.current.onFocusDir("left"))),
      listenWindow("focus_right", () =>
        run("focus-right", () => actions.current.onFocusDir("right")),
      ),
      listenWindow("focus_up", () => run("focus-up", () => actions.current.onFocusDir("up"))),
      listenWindow("focus_down", () => run("focus-down", () => actions.current.onFocusDir("down"))),
      listenWindow("toggle_sidebar", () => run("toggle_sidebar", actions.current.onToggleSidebar)),
      listenWindow("toggle_session_sidebar", () =>
        run("toggle_session_sidebar", actions.current.onToggleSessionSidebar),
      ),
      listenWindow("open_project", () => {
        void actions.current.pickProject();
      }),
      listenWindow("go_to_file", () => run("go_to_file", actions.current.onGoToFile)),
      listenWindow("open_command_palette", () =>
        run("open_command_palette", actions.current.onOpenCommandPalette),
      ),
      listenWindow("reload", () => run("reload", actions.current.onReload)),
      listenWindow("open_search", () => actions.current.onOpenSearch()),
      listenWindow("open_inbox", () => actions.current.onOpenInbox()),
      listenWindow("open_notes", () => actions.current.onOpenNotes()),
      listenWindow("usage_guide", openUsageGuide),
      listenWindow("open_settings", () => actions.current.openSettings()),
      listenWindow("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listenWindow("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listenWindow("find_in_project", () => actions.current.onFindInProject()),
      listenWindow("find", () => {
        openFindInActiveEditor();
      }),
      listenWindow("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      // Every window hears the click; only the one holding the session acts.
      listenWindow<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
        const background =
          sessionId === BACKGROUND_NOTIFICATION_TARGETS.tasks
            ? actions.current.onOpenTasks
            : sessionId === BACKGROUND_NOTIFICATION_TARGETS.automations
              ? actions.current.onOpenAutomations
              : sessionId === BACKGROUND_NOTIFICATION_TARGETS.summary
                ? () => {
                    requestSummaryPanel();
                    actions.current.onOpenTasks();
                  }
                : sessionId === BACKGROUND_NOTIFICATION_TARGETS.assistant
                  ? () =>
                      window.dispatchEvent(
                        new CustomEvent("bycoda:open-assistant", { detail: { tab: "today" } }),
                      )
                  : sessionId === BACKGROUND_NOTIFICATION_TARGETS.account
                    ? () => actions.current.openSettings("account")
                    : null;
        if (background) {
          // Background work is not held by a window: the one that announced
          // it answers the click.
          void isLeadWindow().then((lead) => {
            if (!lead) return;
            const win = getCurrentWindow();
            void restoreWindowFocus(win).catch((error) => {
              console.warn("App operation failed", error);
            });
            background();
          });
          return;
        }
        if (!sessionsRef.current.some((s) => s.id === sessionId)) return;
        const win = getCurrentWindow();
        // Windows leaves a minimized window minimized when it is only focused.
        void restoreWindowFocus(win).catch((error) => {
          console.warn("App operation failed", error);
        });
        actions.current.onOpenApprovalSession(sessionId);
      }),
      listenWindow("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listenWindow("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listenWindow("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    return () => unlisten.forEach((release) => release());
  }, [run]);
}
