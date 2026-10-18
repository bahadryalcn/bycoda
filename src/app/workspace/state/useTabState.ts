import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { newDefaultSession } from "../../../features/sessions/model/session";
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
  const [tabs, setTabsState] = useState<WorkspaceTab[]>(() =>
    (windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab]).map(isolateTerminalPanes),
  );
  const setTabs = useCallback(
    (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => {
      setTabsState((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        if (next === previous) return previous;
        return next.map((tab) => normalizeSessionPreview(isolateTerminalPanes(tab)));
      });
    },
    [],
  );
  const [activeTabId, setActiveTabIdState] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  return { tabs, setTabs, activeTabId, setActiveTabIdState };
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
