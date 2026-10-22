import { useEffect, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../../platform/tauri/platform";
import { retainAsyncSubscription } from "../../../shared/lib/asyncSubscription";
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
    const unlisten: Array<Promise<() => void>> = [
      listen("new_tab", () => run("new", actions.current.onNew)),
      listen("close_other_tabs", () => run("close-others", actions.current.onCloseOtherTabs)),
      listen("close_all_tabs", () => run("close-all", actions.current.onCloseAllTabs)),
      listen("close_tab", () => run("close", actions.current.onClosePane)),
      listen<boolean>("toggle_autosave", ({ payload }) => {
        const saved = saveAutosave(payload);
        if (saved !== payload && IS_MAC) {
          void invoke("autosave_set_enabled", { enabled: saved });
        }
      }),
      listen("next_tab", () => run("next", actions.current.onNext)),
      listen("prev_tab", () => run("prev", actions.current.onPrev)),
      listen("back_tab", () => run("back", actions.current.onVisitBack)),
      listen("forward_tab", () => run("forward", actions.current.onVisitForward)),
      listen("split_right", () => run("split-right", () => actions.current.onSplit("right"))),
      listen("split_down", () => run("split-down", () => actions.current.onSplit("down"))),
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
        listen(event, () => run(event, () => actions.current.onArrangeActiveTab(preset))),
      ),
      listen("new_terminal", () => run("new-terminal", actions.current.onNewTerminal)),
      listen("new_terminal_tab", () => run("new-terminal-tab", actions.current.onNewTerminalTab)),
      listen("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listen("focus_left", () => run("focus-left", () => actions.current.onFocusDir("left"))),
      listen("focus_right", () => run("focus-right", () => actions.current.onFocusDir("right"))),
      listen("focus_up", () => run("focus-up", () => actions.current.onFocusDir("up"))),
      listen("focus_down", () => run("focus-down", () => actions.current.onFocusDir("down"))),
      listen("toggle_sidebar", () => run("toggle_sidebar", actions.current.onToggleSidebar)),
      listen("toggle_session_sidebar", () =>
        run("toggle_session_sidebar", actions.current.onToggleSessionSidebar),
      ),
      listen("open_project", () => {
        void actions.current.pickProject();
      }),
      listen("go_to_file", () => run("go_to_file", actions.current.onGoToFile)),
      listen("open_command_palette", () =>
        run("open_command_palette", actions.current.onOpenCommandPalette),
      ),
      listen("reload", () => run("reload", actions.current.onReload)),
      listen("open_search", () => actions.current.onOpenSearch()),
      listen("open_inbox", () => actions.current.onOpenInbox()),
      listen("open_notes", () => actions.current.onOpenNotes()),
      listen("usage_guide", openUsageGuide),
      listen("open_settings", () => actions.current.openSettings()),
      listen("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listen("find_in_project", () => actions.current.onFindInProject()),
      listen("find", () => {
        openFindInActiveEditor();
      }),
      listen("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      // Every window hears the click; only the one holding the session acts.
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
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
      listen("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    const releases = unlisten.map((registration) =>
      retainAsyncSubscription(registration, (error) =>
        console.warn("Menu subscription failed", error),
      ),
    );
    return () => releases.forEach((release) => release());
  }, [run]);
}
