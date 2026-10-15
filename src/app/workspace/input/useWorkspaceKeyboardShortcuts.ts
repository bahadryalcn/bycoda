import { useEffect, type MutableRefObject } from "react";
import { setNativeFullscreen } from "../../../platform/tauri/fullscreen";
import { invoke } from "@tauri-apps/api/core";
import { isFullscreenShortcut } from "../../../platform/tauri/platform";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  zoomInUiScale,
  zoomOutUiScale,
} from "../../../features/settings/model/uiScale";
import { resolveZoomKeybinding } from "../../../features/settings/model/zoomKeybinding";
import { LAYOUT_SHORTCUTS, resolveAppShortcut } from "../../../features/settings/model/appShortcuts";
import {
  keybindingPressed,
  matchCustomKeybinding,
} from "../../../features/settings/model/settings";
import {
  shouldHandleListNavigation,
  tabCommand,
  tabCommandForKeybinding,
  tabCommandKeybinding,
} from "../../../features/workspace/model/tabKeys";
import { handleEditorFindKey } from "../../../features/files/editor/editorFindBridge";
import type { WorkspaceActions, WorkspaceRun } from "./useWorkspaceActions";

export interface WorkspaceKeyboardShortcutDeps {
  actions: MutableRefObject<WorkspaceActions>;
  run: WorkspaceRun;
  nativeFullscreenRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  settingsOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
  filePickerOpenRef: MutableRefObject<boolean>;
  whatsNewVersionRef: MutableRefObject<string | null>;
  onToggleMaximizePane: (paneId?: string) => void;
}

/** Window-level keydown dispatch for workspace chords (capture phase). */
export function useWorkspaceKeyboardShortcuts({
  actions,
  run,
  nativeFullscreenRef,
  searchViewOpenRef,
  settingsOpenRef,
  inboxViewOpenRef,
  notesViewOpenRef,
  automationsViewOpenRef,
  filePickerOpenRef,
  whatsNewVersionRef,
  onToggleMaximizePane,
}: WorkspaceKeyboardShortcutDeps): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The tour owns keyboard navigation; workspace chords must not run underneath it.
      if (document.querySelector('[data-usage-guide-running="true"]')) return;
      // The Quick Composer recorder owns the next key combination, including
      // bindings that the workspace would normally handle in capture phase.
      if (document.querySelector('[data-shortcut-recorder-active="true"]')) return;
      // Never act on a chord while an IME is composing: tabCommand and the
      // editor guards already do, and the app shortcut resolver does too, so
      // this keeps the whole handler consistent for whatever is added next.
      if (e.isComposing) return;
      const customCommand = matchCustomKeybinding(e);
      const pressed = (command: string, defaultMatch: boolean) =>
        keybindingPressed(command, e, defaultMatch);
      const layout = customCommand ? LAYOUT_SHORTCUTS[customCommand] : undefined;
      if (layout) {
        if (
          searchViewOpenRef.current || settingsOpenRef.current || inboxViewOpenRef.current ||
          notesViewOpenRef.current || automationsViewOpenRef.current || filePickerOpenRef.current ||
          whatsNewVersionRef.current || document.querySelector('[role="dialog"], [role="menu"], [data-model-picker]')
        ) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) run(`arrange-${layout}`, () => actions.current.onArrangeActiveTab(layout));
        return;
      }
      if (
        e.key === "Escape" &&
        nativeFullscreenRef.current &&
        !document.querySelector('[role="menu"], [role="dialog"], [data-model-picker]') &&
        !document.documentElement.classList.contains("is-grabbing") &&
        !document.body.style.cursor.includes("resize")
      ) {
        e.preventDefault();
        e.stopPropagation();
        void setNativeFullscreen(false)
          .then((full) => { nativeFullscreenRef.current = full; })
          .catch(console.warn);
        return;
      }
      if (
        pressed(
          "Pane: Toggle Maximized",
          (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === "Enter",
        )
      ) {
        if (
          !searchViewOpenRef.current &&
          !settingsOpenRef.current &&
          !inboxViewOpenRef.current &&
          !notesViewOpenRef.current &&
          !automationsViewOpenRef.current &&
          !filePickerOpenRef.current
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) onToggleMaximizePane();
        }
        return;
      }
      if (pressed("App: Toggle Full Screen", isFullscreenShortcut(e))) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          void setNativeFullscreen()
            .then((full) => { nativeFullscreenRef.current = full; })
            .catch(console.warn);
        }
        return;
      }
      // A rebound zoom chord may be Option-only, so it is resolved outside the
      // Cmd/Ctrl guard that only the browser-standard defaults need.
      const zoom = resolveZoomKeybinding(e);
      if (zoom) {
        e.preventDefault();
        e.stopPropagation();
        if (zoom === "zoom-in") {
          const next = saveUiScale(zoomInUiScale(loadUiScale()));
          void applyUiScale(next);
        } else if (zoom === "zoom-out") {
          const next = saveUiScale(zoomOutUiScale(loadUiScale()));
          void applyUiScale(next);
        } else {
          saveUiScale(UI_SCALE_DEFAULT);
          void applyUiScale(UI_SCALE_DEFAULT);
        }
        return;
      }
      const cmd = customCommand ? tabCommandForKeybinding(customCommand, e) : tabCommand(e);
      if (cmd && pressed(tabCommandKeybinding(cmd), !customCommand)) {
        if (cmd === "archive-session") {
          if (e.repeat) return;
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        if (cmd === "toggle-notes") {
          if (e.repeat) return;
          actions.current.onToggleNotesPanel(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-session-in-tab" ||
          cmd === "next-session-in-tab" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .bycoda-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".bycoda-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" || cmd === "forward" || /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if ((cmd === "split-right" || cmd === "split-down") && target?.closest(".cm-editor")) {
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (cmd === "new") run("new", a.onNew);
        else if (cmd === "close-others") run("close-others", a.onCloseOtherTabs);
        else if (cmd === "close-all") run("close-all", a.onCloseAllTabs);
        else if (cmd === "close") run("close", a.onClosePane);
        else if (cmd === "next") run("next", a.onNext);
        else if (cmd === "prev") run("prev", a.onPrev);
        else if (cmd === "cycle-next") run("next", a.onNext);
        else if (cmd === "cycle-prev") run("prev", a.onPrev);
        else if (cmd === "back") run("back", a.onVisitBack);
        else if (cmd === "forward") run("forward", a.onVisitForward);
        else if (cmd === "split-right") run("split-right", () => a.onSplit("right"));
        else if (cmd === "split-down") run("split-down", () => a.onSplit("down"));
        else if (cmd === "new-terminal") run("new-terminal", a.onNewTerminal);
        else if (cmd === "new-terminal-tab") run("new-terminal-tab", a.onNewTerminalTab);
        else if (cmd === "toggle-terminal") run("toggle-terminal", a.onToggleProjectTerminal);
        else if (cmd === "prev-session") run("prev-session", () => a.onNavigateSessionList(-1));
        else if (cmd === "next-session") run("next-session", () => a.onNavigateSessionList(1));
        else if (cmd === "prev-session-in-tab")
          run("prev-session-in-tab", () => a.onNavigateSessionList(-1, true));
        else if (cmd === "next-session-in-tab")
          run("next-session-in-tab", () => a.onNavigateSessionList(1, true));
        else if (cmd === "prev-project") run("prev-project", () => a.onNavigateProjectList(-1));
        else if (cmd === "next-project") run("next-project", () => a.onNavigateProjectList(1));
        else if (typeof cmd === "object" && "focus" in cmd)
          run(`focus-${cmd.focus}`, () => a.onFocusDir(cmd.focus));
        else if (typeof cmd === "object" && "activate" in cmd)
          run(`activate-${cmd.activate}`, () => a.onActivate(cmd.activate));
        return;
      }
      if (
        !searchViewOpenRef.current &&
        !inboxViewOpenRef.current &&
        !notesViewOpenRef.current &&
        !automationsViewOpenRef.current &&
        !(
          e.target instanceof Element && e.target.closest("[data-session-drop], [data-agent-tab]")
        ) &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const shortcut = resolveAppShortcut(e);
      if (shortcut) {
        if (
          shortcut === "App: Search" &&
          e.target instanceof Element &&
          e.target.closest(".bycoda-terminal") &&
          e.ctrlKey &&
          !e.metaKey
        ) {
          return;
        }
        // In the note editor the same chord makes the selection bold.
        if (
          shortcut === "App: Toggle Sidebar" &&
          e.key.toLowerCase() === "b" &&
          e.target instanceof Element &&
          e.target.closest("[data-note-editor] .cm-content")
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (shortcut === "App: New Window") run("new_window", () => void invoke("open_new_window"));
        else if (shortcut === "App: Open Project") run("open_project", () => void a.pickProject());
        else if (shortcut === "App: Toggle Sidebar") run("toggle_sidebar", a.onToggleSidebar);
        else if (shortcut === "App: Toggle Session Sidebar")
          run("toggle_session_sidebar", a.onToggleSessionSidebar);
        else if (shortcut === "App: Go to File") run("go_to_file", a.onGoToFile);
        else if (shortcut === "App: Command Palette")
          run("open_command_palette", a.onOpenCommandPalette);
        else if (shortcut === "View: Reload") run("reload", a.onReload);
        else if (shortcut === "App: Search") run("open_search", a.onOpenSearch);
        else if (shortcut === "App: Settings") run("open_settings", () => a.openSettings());
        else if (shortcut === "App: Find in Files") run("find_in_project", a.onFindInProject);
        else if (shortcut === "App: Open Inbox") run("open_inbox", () => a.onOpenInbox());
        else if (shortcut === "App: Open Notes") run("open_notes", () => a.onOpenNotes());
        else if (shortcut === "App: Open Tasks") run("open_tasks", () => a.onOpenTasks());
        else if (shortcut === "App: Open Automations") run("open_automations", () => a.onOpenAutomations());
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run]);
}
