import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { newDefaultSession } from "../../../features/sessions/model/session";
import {
  getSessions,
  useShellSessionsSelector,
} from "../../../features/sessions/model/sessionsStore";
import { shallowArrayEqual } from "../../../features/sessions/model/stableBlocks";
import {
  delegatedSessionIds,
  withoutDelegatedTabs,
  withoutHiddenSessionTabs,
} from "../../../features/workspace/model/delegatedWorkspace";
import { lastProjectPath } from "../../../features/projects/model/recents";
import {
  isolateTerminalPanes,
  newTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { normalizeSessionPreview } from "../../../features/workspace/model/sessionPreview";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ResumedWorkspace } from "../../model/appLifecycle";

export interface WorkspaceSeedDeps {
  toolWindow: ToolWindow | null;
}

/** First session and tab for a window that has nothing restored. */
export function useWorkspaceSeed({ toolWindow }: WorkspaceSeedDeps) {
  const [seed] = useState(() => {
    const cwd = toolWindow?.cwd ?? lastProjectPath() ?? "~";
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  return seed;
}

export interface TabStateDeps {
  seed: ReturnType<typeof useWorkspaceSeed>;
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
}

/** Tab list (with pane isolation on every write) and the active tab id. */
export function useTabState({ seed, windowTransfer, resumed }: TabStateDeps) {
  // Only the ids of hidden child sessions matter here, so the root does not
  // re-render for a status, tool or title change of an ordinary conversation.
  const hiddenSessionIds = useShellSessionsSelector(delegatedSessionIds, shallowArrayEqual);
  const [storedTabs, setTabsState] = useState<WorkspaceTab[]>(() =>
    (windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab]).map(isolateTerminalPanes),
  );
  const setTabs = useCallback(
    (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => {
      setTabsState((previous) => {
        const visible = withoutDelegatedTabs(previous, getSessions());
        const next = withoutDelegatedTabs(
          typeof update === "function" ? update(visible) : update,
          getSessions(),
        );
        if (next === previous) return previous;
        const normalized = next.map((tab) => normalizeSessionPreview(isolateTerminalPanes(tab)));
        // An update that changed nothing must not commit a new array: every
        // consumer of `tabs` would re-render (a shell prompt sends one per line).
        return normalized.length === previous.length &&
          normalized.every((tab, index) => tab === previous[index])
          ? previous
          : normalized;
      });
    },
    [],
  );
  const [activeTabId, setActiveTabIdState] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  const tabs = useMemo(
    () => withoutHiddenSessionTabs(storedTabs, hiddenSessionIds),
    [storedTabs, hiddenSessionIds],
  );
  if (tabs !== storedTabs) {
    // Drop a delegated child's pane for good: a shell that reloads without its
    // lineage must not bring the tab back and pull focus from the parent.
    setTabsState(tabs);
    if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabIdState(tabs[0]?.id ?? "");
  }
  return {
    tabs,
    setTabs,
    activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? ""),
    setActiveTabIdState,
  };
}

export interface ActiveTabSetterDeps {
  cancel: () => void;
  setActiveTabIdState: Dispatch<SetStateAction<string>>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocusToken: Dispatch<SetStateAction<number>>;
}

/** Every ordinary tab activation supersedes an unfinished workspace request. */
export function useActiveTabSetter({
  cancel,
  setActiveTabIdState,
  setProjectTerminalFocused,
  setComposerFocusToken,
}: ActiveTabSetterDeps) {
  return useCallback(
    (id: string) => {
      cancel();
      setActiveTabIdState(id);
      setProjectTerminalFocused(false);
      setComposerFocusToken((token) => token + 1);
    },
    [cancel, setActiveTabIdState, setProjectTerminalFocused, setComposerFocusToken],
  );
}
