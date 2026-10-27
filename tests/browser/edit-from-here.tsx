import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPane, type SessionPaneProps } from "../../src/features/sessions/ui/SessionPane";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { rewindConversationBeforeMessage } from "../../src/features/sessions/model/conversationRewind";
import {
  findModel,
  modelsFor,
  resolveModel,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { languageReady } from "../../src/shared/i18n";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

// Real SessionPane, transcript, dialog, Composer and conversation model. Only the
// native file-history boundary and outer controller callbacks are simulated.
const query = new URLSearchParams(location.search);
const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
const events = { rewinds: 0, sends: 0 };
let failRevert = query.has("failRevert");
let failConversation = query.has("failConversation");
const conversationAttempts: string[] = [];
let releaseRevert: (() => void) | undefined;
Object.assign(window, {
  editFixture: {
    calls,
    events,
    conversationAttempts,
    releaseRevert: () => releaseRevert?.(),
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "plugin:event|listen") return 1;
      if (command === "session_files_revert_plan") {
        calls.push({ command, args });
        return query.has("unavailable")
          ? { files: [], unavailable: "File history for this older message is unavailable." }
          : {
              planToken: "fixture-plan",
              files: [
                { path: "src/answer.ts", action: "restore" },
                { path: "src/new-file.ts", action: "delete" },
                ...(query.has("conflicts")
                  ? [
                      {
                        path: "src/shared.ts",
                        action: "restore",
                        conflict: "Changed by another session",
                      },
                    ]
                  : []),
              ],
            };
      }
      if (command === "session_files_revert") {
        calls.push({ command, args });
        if (query.has("slowRevert"))
          await new Promise<void>((resolve) => {
            releaseRevert = resolve;
          });
        if (failRevert) {
          failRevert = false;
          throw new Error("File restoration failed. Retry this operation.");
        }
        return {
          reverted: ["src/answer.ts", "src/new-file.ts"],
          skipped: query.has("conflicts")
            ? [{ path: "src/shared.ts", reason: "Changed by another session" }]
            : [],
        };
      }
      if (command === "git_branches")
        return {
          current: "fixture",
          detached: false,
          branches: [{ name: "fixture", current: true, remote: null }],
        };
      if (command === "git_worktrees") return { worktrees: [] };
      if (command === "git_diff_index")
        return { head: "fixture", branch: "fixture", files: [], conflicts: [] };
      if (command === "session_checkpoint_status") return { files: [] };
      if (command === "session_get_queue") return null;
      if (command === "session_upsert") return args.session;
      if (
        command === "session_list_drafts" ||
        command === "list_project_files" ||
        command === "list_claude_commands"
      )
        return [];
      return null;
    },
  },
});
const unavailable = async () => {
  throw new Error("No live provider in Edit from here fixture");
};
registerHarness({
  id: "claude",
  live: true,
  canSteer: true,
  sendTurn: unavailable,
  steerTurn: unavailable,
  cancelTurn: unavailable,
  stopSession: unavailable,
  forgetSession: unavailable,
  respondApproval: () => {},
  bindSession: () => {},
});
const model = "claude:edit-fixture";
setHarnessModels("claude", [
  { id: model, nativeId: "edit-fixture", harness: "claude", name: "Claude fixture" },
]);
const initial: Session = {
  ...newSession("claude", "C:/fixture/edit-from-here", model),
  id: "edit-session",
  title: "Review a change",
  ...(query.has("worktree") ? { workspaceId: "workspace-fixture" } : {}),
  blocks: [
    { id: "first", role: "user", text: "Keep the earlier implementation." },
    {
      id: "answer",
      role: "assistant",
      text: "The earlier implementation stays in this conversation.",
    },
    {
      id: "edit-message",
      role: "user",
      text: "Inspect the attached report and improve the result.",
      attachments: [
        {
          id: "report",
          kind: "file",
          name: "report.csv",
          mimeType: "text/csv",
          size: 15,
          data: btoa("Name,Value\nA,1\n"),
        },
      ],
    },
    {
      id: "later-answer",
      role: "assistant",
      text: "I updated the result and created a helper file.",
    },
    { id: "later-user", role: "user", text: "A later prompt that will also be rewound." },
  ],
};
const noop = () => {};
function Fixture() {
  const [session, setSession] = useState(initial);
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    hideProjectPicker: true,
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: () => {
      events.sends++;
      return false;
    },
    onSaveDraft: () => false,
    onRemoveDraft: () => false,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: () => false,
    onResumeQueue: () => false,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
    onRewindMessage: async (_id, blockId) => {
      conversationAttempts.push(blockId);
      if (failConversation) {
        failConversation = false;
        return false;
      }
      events.rewinds++;
      setSession((current) => rewindConversationBeforeMessage(current, blockId));
      return true;
    },
  };
  return (
    <main
      className="relative h-dvh min-h-0 min-w-0 bg-(--ui-surface) text-content"
      data-edit-fixture
    >
      <ModelSourceContext.Provider
        value={{
          modelsFor,
          resolve: resolveModel,
          find: findModel,
          available: () => true,
          probed: () => true,
          refresh: noop,
        }}
      >
        <SessionPane {...props} />
      </ModelSourceContext.Provider>
    </main>
  );
}
applyThemePreference(query.has("light") ? "light" : "dark");
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
