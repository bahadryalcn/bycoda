import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { PaneTree } from "../../src/features/workspace/ui/PaneTree";
import {
  leaf,
  movePane,
  newEditorPane,
  newFileTab,
  setSplitRatio,
  splitPane,
  type LayoutNode,
  type WorkspaceTab,
} from "../../src/features/workspace/model/layout";
import { applyMoveFileBetweenPanes } from "../../src/features/workspace/model/workspaceTabGroups";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { newSession } from "../../src/features/sessions/model/session";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

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

function Fixture() {
  const [layout, setLayout] = useState<LayoutNode>(withFiles ? initialFileLayout : initial);
  const [focused, setFocused] = useState(withFiles ? initialEditors[0].id : sessions[0].id);
  const [editors, setEditors] = useState(withFiles ? initialEditors : []);
  return (
    <main className="flex h-screen min-h-0 min-w-0 flex-col bg-background-base text-content">
      {withChrome ? (
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
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
