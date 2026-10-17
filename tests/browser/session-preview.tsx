import { useRef, useState } from "react";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { LastSessionsRows } from "../../src/app/shell/LastSessionsSection";
import { toTitleTab } from "../../src/app/workspace/helpers/tabHelpers";
import {
  useOpenSessionActions,
  type OpenSessionActionsDeps,
} from "../../src/app/workspace/sessions/useOpenSessionActions";
import { useTabState } from "../../src/app/workspace/state/useTabState";
import { newDefaultSession } from "../../src/features/sessions/model/session";
import { resetSessionsStore } from "../../src/features/sessions/model/sessionsStore";
import { getComposerDraft, setComposerDraft } from "../../src/features/sessions/model/draftCache";
import { leafIds, newTab } from "../../src/features/workspace/model/layout";
import { TextareaField } from "../../src/shared/ui/TextareaField";

// Isolated fixture. Exercises real opening, draft promotion, list and title-strip APIs.
export function SessionPreviewFixture() {
  const [sessions] = useState(() => {
    const values = Array.from({ length: 10 }, (_, index) => ({
      ...newDefaultSession("G:/preview-fixture"),
      id: `preview-${index}`,
      title: `Discussion ${index + 1}`,
    }));
    resetSessionsStore(values);
    return values;
  });
  const { tabs, setTabs, activeTabId, setActiveTabIdState } = useTabState({
    seed: { session: sessions[0], tab: newTab(sessions[0].id) },
    windowTransfer: null,
    resumed: { tabs: [], activeTabId: "" } as never,
  });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [, refreshDraft] = useState(0);
  const actions = useOpenSessionActions({
    sessions,
    tabsRef,
    setTabs,
    setActiveTabId: setActiveTabIdState,
    setProjectTerminalFocused: () => {},
    setComposerFocused: () => {},
    setInspectedWorkerId: () => {},
    followProject: () => {},
    appendTab: (tab) => setTabs((previous) => [...previous, tab]),
    insertBesideActive: (previous, tab) => [...previous, tab],
    ensureOpenSession: async (id) => sessions.find((session) => session.id === id) ?? null,
    focusOpenSession: (id) => {
      const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(id));
      if (!tab) return false;
      setActiveTabIdState(tab.id);
      return true;
    },
    replaceBlankPaneWithSession: () => false,
    linkedSessionUpdatesRef: useRef(new Map()),
    revealLinkedSessionUpdate: () => {},
    orchestrator: {
      forSession: () => undefined,
    } as unknown as OpenSessionActionsDeps["orchestrator"],
    workspaceNavigation: { cancel: () => {} },
  });
  const active = tabs.find((tab) => tab.id === activeTabId)?.focusedId;
  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background-base text-content">
      <TitleBar
        tabs={tabs.map((tab) => toTitleTab(tab, sessions, new Set(), new Set()))}
        activeId={activeTabId}
        cwd="G:/preview-fixture"
        onSelect={setActiveTabIdState}
        onNew={() => {}}
        onClose={(id) => setTabs((previous) => previous.filter((tab) => tab.id !== id))}
        onCloseMany={() => {}}
        onReorder={() => {}}
        onKeepSession={actions.onKeepSession}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="w-40 shrink-0 overflow-auto border-e border-stroke">
          <LastSessionsRows
            rows={sessions.map((session) => ({
              ...session,
              updatedAt: 1,
              pinned: false,
              pinnable: true,
              remote: false,
            }))}
            activeSessionId={active}
            searchActive={false}
            onOpenSession={actions.onPreviewHistorySession}
            onOpenProject={() => {}}
            onTogglePin={() => {}}
            groupLabels={{}}
            groupColors={{}}
            groupCustomColors={{}}
            groupLogos={{}}
            groupMascots={{}}
          />
        </aside>
        <main className="min-w-0 flex-1 p-3">
          <output aria-label="Active discussion">
            {sessions.find((session) => session.id === active)?.title}
          </output>
          {active && (
            <TextareaField
              key={active}
              label="Draft"
              value={getComposerDraft(active) ?? ""}
              onChange={(event) => {
                setComposerDraft(active, event.currentTarget.value);
                refreshDraft((value) => value + 1);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
