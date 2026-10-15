import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "../../../platform/tauri/platform";
import type { FocusDir, SplitDir } from "../../../features/workspace/model/layout";
import type { LayoutPreset } from "../../../features/workspace/model/layoutPresets";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import {
  loadAutosave,
  loadKeybindingOverrides,
  type SettingsSectionId,
} from "../../../features/settings/model/settings";

/** Handler references that the keyboard shortcut and native menu listeners dispatch to. */
export interface WorkspaceActions {
  onArrangeActiveTab: (preset: LayoutPreset) => void;
  onNew: () => void;
  onArchiveFocusedSession: (event: KeyboardEvent) => void;
  onToggleNotesPanel: (event: KeyboardEvent) => void;
  onCloseOtherTabs: () => void;
  onCloseAllTabs: () => void;
  onClosePane: (sessionId?: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onVisitBack: () => void;
  onVisitForward: () => void;
  onActivate: (slot: number) => void;
  onSplit: (dir: SplitDir) => void;
  onFocusDir: (dir: FocusDir) => void;
  onToggleSidebar: () => void;
  onToggleSessionSidebar: () => void;
  onGoToFile: () => void;
  onOpenCommandPalette: () => void;
  onReload: () => void;
  onFindInProject: () => void;
  onOpenSearch: () => void;
  onOpenInbox: (routed?: boolean) => void;
  onOpenNotes: (routed?: boolean) => void;
  pickProject: () => void;
  onNewTerminal: () => void;
  onNewTerminalTab: () => void;
  onToggleProjectTerminal: () => void;
  onNavigateSessionList: (delta: number, inCurrentTab?: boolean) => void;
  onNavigateProjectList: (delta: number) => void;
  openSettings: (section?: SettingsSectionId, anchor?: SettingsAnchor) => void;
  onOpenApprovalSession: (sessionId: string) => void;
  onOpenTasks: (routed?: boolean) => void;
  onOpenAutomations: (routed?: boolean) => void;
}

/** Runs a named action, dropping an identical repeat within 80ms (duplicate native + DOM events). */
export type WorkspaceRun = (name: string, fn: () => void) => void;

export interface WorkspaceActionRegistry {
  actions: MutableRefObject<WorkspaceActions>;
  run: WorkspaceRun;
}

/**
 * Mirrors the handlers built each render into a ref (read by the long-lived
 * keyboard and native menu listeners) and provides the debounced `run` helper.
 * Call at the position of the former `actions` ref in Workspace.
 */
export function useWorkspaceActions(handlers: WorkspaceActions): WorkspaceActionRegistry {
  const actions = useRef(handlers);
  actions.current = handlers;

  const debounce = useRef({ name: "", at: 0 });
  const run = useCallback<WorkspaceRun>((name, fn) => {
    const now = performance.now();
    if (name === debounce.current.name && now - debounce.current.at < 80) return;
    debounce.current = { name, at: now };
    fn();
  }, []);

  useEffect(() => {
    if (!IS_MAC) return;
    void invoke("autosave_set_enabled", { enabled: loadAutosave() }).catch(console.error);
    void invoke("keybindings_set_overrides", {
      overrides: loadKeybindingOverrides(),
    }).catch(console.error);
  }, []);

  return { actions, run };
}
