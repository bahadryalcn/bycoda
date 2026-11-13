import { useRef, useState, type ComponentProps } from "react";
import { useEditorFileOpen } from "../../../src/app/workspace/files/useEditorFileOpen";
import {
  useSessionPaneProps,
  type SessionPaneDeps,
} from "../../../src/app/workspace/layout/useSessionPaneProps";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { createRoot } from "react-dom/client";
import { PaneTree } from "../../../src/features/workspace/ui/PaneTree";
import {
  leaf,
  movePane,
  newEditorPane,
  newFileTab,
  setSplitRatio,
  splitPane,
  type LayoutNode,
  type WorkspaceTab,
} from "../../../src/features/workspace/model/layout";
import { applyMoveFileBetweenPanes } from "../../../src/features/workspace/model/workspaceTabGroups";
import { TitleBar } from "../../../src/app/shell/TitleBar";
import { DetachedWorkingBar } from "../../../src/app/shell/DetachedWorkingBar";
import { newSession } from "../../../src/features/sessions/model/session";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import { languageReady } from "../../../src/shared/i18n";
import "../support/w7-shell.css";

// Real pane tree and chat content. Provider/native callbacks stay inert.
const sessions = ["Alpha", "Beta", "Gamma"].map((title) => ({
  ...newSession("claude", "/fixture"),
  title,
}));
const initial = splitPane(
  splitPane(leaf(sessions[0].id), sessions[0].id, "right", sessions[1].id),
  sessions[1].id,
  "down",
  sessions[2].id,
);
const withFiles = new URLSearchParams(location.search).has("files");
const withChrome = new URLSearchParams(location.search).has("chrome");
const initialEditors = [
  newEditorPane(newFileTab("/fixture/alpha.ts", "/fixture")),
  newEditorPane(newFileTab("/fixture/beta.ts", "/fixture")),
];
const initialFileLayout = splitPane(
  leaf(initialEditors[0].id),
  initialEditors[0].id,
  "right",
  initialEditors[1].id,
);
const noop = () => {};
const callbacks = Object.fromEntries(
  [
    "onCwdChange",
    "onBranchChange",
    "onWorkspaceModeChange",
    "onWorktreeBaseChange",
    "onModelChange",
    "onModelSettingsChange",
    "onRuntimeModeChange",
    "onSubmit",
    "onSaveDraft",
    "onRemoveDraft",
    "onStop",
    "onPlaceSessionInFolder",
    "onDeleteQueuedMessage",
    "onEditQueuedMessage",
    "onQueuedMessageEditingChange",
    "onSteerQueuedMessage",
    "onResumeQueue",
    "onUsageLimitResume",
    "onUsageLimitResumeAtReset",
    "onUsageLimitDismiss",
    "onApproval",
    "onQuestionReply",
    "onOpenFile",
    "onOpenDiff",
    "onOpenPlan",
    "onUpdatePlan",
    "onBuildPlan",
    "onSelectFile",
    "onCloseFile",
    "onCloseOtherFiles",
    "onReorderFiles",
    "onFileDirtyChange",
    "onFileErrorCountChange",
    "onDetachPane",
    "onNewTerminal",
  ].map((name) => [name, noop]),
) as Pick<
  ComponentProps<typeof PaneTree>,
  | "onCwdChange"
  | "onBranchChange"
  | "onWorkspaceModeChange"
  | "onWorktreeBaseChange"
  | "onModelChange"
  | "onModelSettingsChange"
  | "onRuntimeModeChange"
  | "onSubmit"
  | "onSaveDraft"
  | "onRemoveDraft"
  | "onStop"
  | "onPlaceSessionInFolder"
  | "onDeleteQueuedMessage"
  | "onEditQueuedMessage"
  | "onQueuedMessageEditingChange"
  | "onSteerQueuedMessage"
  | "onResumeQueue"
  | "onUsageLimitResume"
  | "onUsageLimitResumeAtReset"
  | "onUsageLimitDismiss"
  | "onApproval"
  | "onQuestionReply"
  | "onOpenFile"
  | "onOpenDiff"
  | "onOpenPlan"
  | "onUpdatePlan"
  | "onBuildPlan"
  | "onSelectFile"
  | "onCloseFile"
  | "onCloseOtherFiles"
  | "onReorderFiles"
  | "onFileDirtyChange"
  | "onFileErrorCountChange"
  | "onDetachPane"
  | "onNewTerminal"
>;

function HtmlLinkFixture() {
  const [session] = useState(() => ({
    ...newSession("claude", "/fixture"),
    title: "HTML conversation",
    blocks: [
      {
        id: "html-answer",
        role: "assistant" as const,
        text: "Your updated document is ready.\n\n[Open updated HTML](/fixture/canim-anam.html)",
        timestamp: Date.now(),
      },
    ],
  }));
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    {
      kind: "session",
      id: "html-conversation",
      layout: leaf(session.id),
      focusedId: session.id,
      editorPanes: [],
      terminalPanes: [],
    },
  ]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef("html-conversation");
  const cwdRef = useRef("/fixture");
  const sessionsRef = useRef([session]);
  const navigationToken = useRef(0);
  const { onOpenFile } = useEditorFileOpen({
    activeTabId: "html-conversation",
    activeTabIdRef,
    tabsRef,
    sessionsRef,
    sidebarCwdRef: cwdRef,
    gitCwdRef: cwdRef,
    activateTab: (id) => {
      activeTabIdRef.current = id;
    },
    insertBesideActive: (previous, tab) => [...previous, tab],
    setTabs: (update) =>
      setTabs((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        tabsRef.current = next;
        return next;
      }),
    setActiveTabId: noop,
    setProjectTerminalFocused: noop,
    setComposerFocused: noop,
    setEditorNavigation: noop,
    editorNavigationToken: navigationToken,
  });
  const { sessionPaneProps } = useSessionPaneProps({
    ...callbacks,
    tabs,
    movingWindows: new Set(),
    windowTransferPending: false,
    workspaceNavigation: { pending: null },
    visibleRecents: [],
    onKeepSession: noop,
    onOpenFile,
  } as unknown as SessionPaneDeps);
  const tab = tabs[0];
  return (
    <main className="flex h-dvh min-h-0 min-w-0 flex-col bg-background-base text-content">
      <PaneTree
        {...callbacks}
        {...sessionPaneProps}
        layout={tab.layout}
        sessions={[session]}
        editorPanes={tab.editorPanes}
        dirtyFileIds={new Set()}
        fileErrorCounts={new Map()}
        visible
        focusedId={tab.focusedId}
        composerFocused={false}
        recents={[]}
        onFocus={(focusedId) =>
          setTabs((previous) => previous.map((entry) => ({ ...entry, focusedId })))
        }
        onClose={noop}
        onCompactContext={() => false}
        onRatio={noop}
        onMovePane={noop}
      />
      <output data-testid="html-workspace-count" className="sr-only">
        {tabs.length}
      </output>
      <output data-testid="html-editor-count" className="sr-only">
        {tab.editorPanes.length}
      </output>
    </main>
  );
}

function Fixture() {
  const [layout, setLayout] = useState<LayoutNode>(withFiles ? initialFileLayout : initial);
  const [focused, setFocused] = useState(withFiles ? initialEditors[0].id : sessions[0].id);
  const [editors, setEditors] = useState(withFiles ? initialEditors : []);
  return (
    <main className="flex h-dvh min-h-0 min-w-0 flex-col bg-background-base text-content">
      {withChrome ? (
        <>
          <TitleBar
            tabs={[
              {
                id: "fixture",
                title: "Alpha",
                project: "fixture",
                more: [],
                sessionCount: 3,
                harnesses: ["claude"],
                busyHarnesses: [],
                files: [],
                multiPane: true,
              },
            ]}
            detached
            activeId="fixture"
            cwd="/fixture"
            onToggleSidebar={noop}
            onNew={noop}
            onSelect={noop}
            onClose={noop}
            onCloseMany={noop}
            onReorder={noop}
            onReturnToMain={noop}
            layout={{ current: null, canArrange: true, onArrange: noop, onSplit: noop }}
          />
          <DetachedWorkingBar agents={[]} onSelectAgent={noop} />
        </>
      ) : (
        <div className="flex shrink-0 gap-2 text-xs">
          <button onClick={() => setLayout(initial)}>Reset layout</button>
          <button
            onClick={() =>
              setLayout((node) => movePane(node, sessions[2].id, sessions[0].id, "center"))
            }
          >
            Group Gamma with Alpha
          </button>
        </div>
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        <PaneTree
          {...callbacks}
          layout={layout}
          sessions={sessions}
          editorPanes={editors}
          dirtyFileIds={new Set()}
          fileErrorCounts={new Map()}
          visible
          focusedId={focused}
          composerFocused={false}
          recents={[]}
          onFocus={setFocused}
          onClose={noop}
          onCompactContext={() => false}
          onRatio={(id, index, ratio) => setLayout((node) => setSplitRatio(node, id, index, ratio))}
          onMovePane={(from, to, edge, position) =>
            setLayout((node) => movePane(node, from, to, edge, position))
          }
          onMoveFile={(fileId, targetPaneId, edge, targetFileId, position) => {
            const tab: WorkspaceTab = {
              kind: "session",
              id: "fixture",
              layout,
              focusedId: focused,
              editorPanes: editors,
              terminalPanes: [],
            };
            const result = applyMoveFileBetweenPanes({
              tabs: [tab],
              fileId,
              targetPaneId,
              edge,
              targetFileId,
              position,
            });
            if (!result) return;
            setLayout(result.tabs[0].layout);
            setEditors(result.tabs[0].editorPanes);
            setFocused(result.focusedId);
          }}
        />
      </div>
      <output data-testid="layout" className="sr-only">
        {JSON.stringify(layout)}
      </output>
      <output data-testid="editors" className="sr-only">
        {JSON.stringify(editors)}
      </output>
    </main>
  );
}
if (new URLSearchParams(location.search).has("html-link")) {
  localStorage.setItem("bycoda.fileTabMode", "workspace");
}
if (new URLSearchParams(location.search).has("theme")) {
  applyThemePreference(
    new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
  );
}
// The app resolves durable session owners at boot before any pane renders;
// the fixture mounts chat panes directly, so it hydrates the same store first.
void Promise.all([languageReady, flushHostSessionBindings()]).then(() =>
  createRoot(document.getElementById("root")!).render(
    new URLSearchParams(location.search).has("html-link") ? <HtmlLinkFixture /> : <Fixture />,
  ),
);
