import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  layoutLeaves,
  splitPane,
  type SplitDir,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  arrangeSuggestedLayout,
  suggestedPaneCount,
  detectLayoutPreset,
  type LayoutPreset,
} from "../../../features/workspace/model/layoutPresets";
import { worktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { type Session } from "../../../features/sessions/model/session";
import { newWorkspaceSession } from "../../model/newWorkspaceSession";
import { type MaximizedPaneState } from "./useMaximizedPane";

export interface PaneLayoutActionDeps {
  activeTab: WorkspaceTab | undefined;
  sidebarCwd: string;
  sessionDefaults: Session | undefined;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingTabIds: MutableRefObject<Set<string>>;
  setMaximizedPane: Dispatch<SetStateAction<MaximizedPaneState>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Split the focused pane, and arrange every pane of the active tab by preset. */
export function usePaneLayoutActions({
  activeTab,
  sidebarCwd,
  sessionDefaults,
  tabsRef,
  sessionsRef,
  windowTransferPendingRef,
  movingTabIds,
  setMaximizedPane,
  setSessions,
  setTabs,
  setComposerFocused,
}: PaneLayoutActionDeps): {
  onSplit: (dir: SplitDir) => void;
  activeTabLayoutPreset: LayoutPreset | null;
  onArrangeActiveTab: (preset: LayoutPreset) => void;
} {
  const onSplit = useCallback(
    (dir: SplitDir) => {
      if (!activeTab) return;
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      setMaximizedPane(null);
      const focus = worktreeFocus(sidebarCwd);
      const session = newWorkspaceSession(sidebarCwd, sessionDefaults?.runtimeMode, focus);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return {
            ...t,
            layout: splitPane(t.layout, t.focusedId, dir, session.id),
            focusedId: session.id,
          };
        }),
      );
      setComposerFocused(true);
    },
    [activeTab, sidebarCwd, sessionDefaults?.runtimeMode],
  );

  const activeTabLayoutPreset = useMemo(
    () => (activeTab ? detectLayoutPreset(activeTab.layout) : null),
    [activeTab],
  );

  /** Rearranges every pane of the active tab (chats, files, terminals alike). */
  const onArrangeActiveTab = useCallback(
    (preset: LayoutPreset) => {
      if (!activeTab) return;
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      setMaximizedPane(null);
      const current = tabsRef.current.find((tab) => tab.id === activeTab.id);
      if (!current) return;
      const emptySessions =
        layoutLeaves(current.layout).length === 1
          ? Array.from({ length: suggestedPaneCount(preset) - 1 }, () =>
              newWorkspaceSession(sidebarCwd, sessionDefaults?.runtimeMode, worktreeFocus(sidebarCwd)),
            )
          : [];
      const next = tabsRef.current.map((tab) =>
        tab.id === current.id
          ? {
              ...tab,
              layout: arrangeSuggestedLayout(
                tab.layout,
                preset,
                emptySessions.map((session) => session.id),
                tab.focusedId,
              ),
            }
          : tab,
      );
      if (emptySessions.length) {
        sessionsRef.current = [...sessionsRef.current, ...emptySessions];
        setSessions(sessionsRef.current);
      }
      tabsRef.current = next;
      setTabs(next);
    },
    [activeTab, sidebarCwd, sessionDefaults?.runtimeMode],
  );

  return { onSplit, activeTabLayoutPreset, onArrangeActiveTab };
}
