import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPane, type SessionPaneProps } from "../../src/features/sessions/ui/SessionPane";
import { rememberRemoteProject } from "../../src/features/connections/model/remoteProjects";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import "../../src/features/connections/model/remoteCommands";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { rememberRemoteSession } from "../../src/features/connections/model/connections";
import { remoteSessionActions } from "../../src/features/connections/model/remoteSessionActions";
import { Button } from "../../src/shared/ui/Button";
import {
  WorkspaceRewindPreviewHost,
  requestWorkspaceRewindPreview,
  offerWorkspaceRewindUndo,
} from "../../src/features/workspaces/ui/WorkspaceRewindPreview";
import {
  planWorkspaceRewind,
  applyWorkspaceRewind,
} from "../../src/features/workspaces/model/rewindClient";
import {
  useCompactAndRewind,
  type CompactAndRewindDeps,
} from "../../src/app/workspace/sessions/useCompactAndRewind";
import type { Session } from "../../src/features/sessions/model/session";
import type { SessionRewindPlan } from "../../src/features/workspaces/model/contracts";
import { languageReady, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

const query = new URLSearchParams(location.search);
const original = {
  id: "rewind-session",
  workspaceId: "workspace",
  cwd: "C:/fixture/rewind",
  title: "Review the working copy",
  harness: "claude",
  model: "claude:fixture",
  modelSettings: {},
  runtimeMode: "auto",
  blocks: [
    { id: "first", role: "user", text: "Keep this implementation." },
    { id: "answer", role: "assistant", text: "The first change is retained." },
    { id: "second", role: "user", text: "Remove this later change." },
    {
      id: "later",
      role: "assistant",
      text: "A later change has two commits and three affected files.",
    },
  ],
} as Session;
let authoritative = original;
let revision = 4;
const calls: Array<{ method: string; params: unknown }> = [];
if (query.has("pane") || query.has("remoteRewind")) {
  const saved = sessionStorage.getItem("fixture-native-rewind");
  if (saved) {
    const record = JSON.parse(saved);
    authoritative = record.session;
    revision = record.revision;
  }
}
const unavailable = async () => {
  throw new Error("No live provider in managed workspace fixture");
};
registerHarness({
  id: "claude",
  live: true,
  canSteer: false,
  sendTurn: unavailable,
  steerTurn: unavailable,
  cancelTurn: unavailable,
  respondApproval: () => {},
  bindSession: () => {},
  stopSession: async () => {
    calls.push({ method: "provider.stop", params: {} });
    if (query.has("retireUnknown")) throw new Error("Provider retirement could not be confirmed.");
  },
  forgetSession: async () => {
    calls.push({ method: "provider.forget", params: {} });
  },
});
const machine = {
  id: "fixture-machine",
  name: "Fixture PC",
  endpoint: "http://127.0.0.1:3774",
  environmentId: "fixture-env",
  localHost: true,
};
const remoteProject = rememberRemoteProject(machine.environmentId, {
  id: "project",
  cwd: "C:/fixture/rewind",
  name: "Managed session fixture",
});
if (query.has("remoteRewind")) rememberRemoteSession("remote-shell", original.id);
if (query.has("remoteCreate"))
  authoritative = { ...original, id: "not-created", blocks: [], workspaceId: undefined };
let failApply = query.has("failApply");
Object.assign(window, {
  rewindFixtureCalls: calls,
  tryRemoteSend: () => remoteSessionActions("remote-shell")?.submit("Must wait for rewind", []),
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, any> = {}) => {
      if (command === "local_host_connect") return machine;
      if (command === "remote_machines") return [machine];
      if (command === "plugin:event|listen") return 1;
      if (command === "session_files_revert_plan") {
        calls.push({ method: command, params: args });
        return { files: [{ path: "src/fixture.ts", action: "restore" }] };
      }
      if (command === "session_files_revert") {
        calls.push({ method: command, params: args });
        return { reverted: ["src/fixture.ts"], skipped: [] };
      }
      if (command === "session_get")
        return { ...authoritative, transcriptRevision: revision, createdAt: 1, updatedAt: 1 };
      if (command === "session_get_queue") return null;
      if (command === "session_upsert")
        return { ...args.session, transcriptRevision: revision, createdAt: 1, updatedAt: 1 };
      if (
        command === "session_list_drafts" ||
        command === "list_project_files" ||
        command === "list_claude_commands"
      )
        return [];
      if (command === "session_checkpoint_status") return { files: [] };
      if (command === "git_branches")
        return {
          current: "main",
          detached: false,
          branches: [{ name: "main", current: true, remote: null }],
        };
      if (command === "git_worktrees")
        return {
          worktrees: [
            { path: original.cwd, branch: "main", head: "abc123", isMain: true, missing: false },
          ],
        };
      if (command === "git_diff_index")
        return { head: "abc123", branch: "main", files: [], conflicts: [] };
      if (
        command === "managed_rewind_plan" ||
        command === "managed_rewind_apply" ||
        command === "managed_rewind_undo"
      ) {
        args = {
          method:
            command === "managed_rewind_plan"
              ? "sessions.rewind.plan"
              : command === "managed_rewind_apply"
                ? "sessions.rewind.apply"
                : "sessions.rewind.undo",
          params: args.request,
        };
        command = "remote_request";
      }
      if (command !== "remote_request") return null;
      calls.push({ method: args.method, params: args.params });
      switch (args.method) {
        case "environment.describe":
          return {
            protocolVersion: 1,
            environmentId: machine.environmentId,
            name: machine.name,
            providers: ["claude"],
            platform: "win32",
            capabilities: query.has("olderHost")
              ? []
              : [
                  "workspaces.managed.v1",
                  "workspaces.policy.v1",
                  "sessions.managedCreation.v1",
                  "sessions.native-rewind.v1",
                  "sessions.git-rewind.v1",
                  "sessions.git-rewind-undo.v1",
                  "sessions.draft",
                  "sessions.rewind",
                  ...(query.has("olderEditHost") ? [] : ["sessions.edit-from-here.v1"]),
                ],
          };
        case "models.list":
          return {
            models: {
              claude: [
                {
                  id: "claude:fixture",
                  harness: "claude",
                  name: "Claude fixture",
                  nativeId: "fixture",
                  settings: [],
                },
              ],
            },
            errors: {},
          };
        case "workspace.run":
          if (args.params.command === "git_branches")
            return { current: "main", branches: [{ name: "main", current: true, remote: null }] };
          if (args.params.command === "git_diff_index")
            return { head: "abc123", branch: "main", files: [], conflicts: [] };
          if (args.params.command === "git_worktrees")
            return {
              worktrees: [
                {
                  path: original.cwd,
                  branch: "main",
                  head: "abc123",
                  isMain: true,
                  missing: false,
                },
              ],
              defaultRoot: "C:/fixture/rewind-worktrees",
            };
          if (args.params.command === "skill_policy_get")
            return { disabledNames: [], disabledPaths: [] };
          if (args.params.command === "session_checkpoint_status") return { files: [] };
          return [];
        case "git.worktrees":
          return {
            worktrees: [
              {
                path: "C:/fixture/rewind",
                branch: "main",
                head: "abc123",
                isMain: true,
                missing: false,
              },
            ],
          };
        case "git.branches":
          return { current: "main", branches: ["main"] };
        case "projects.workspacePolicy.get":
          return {
            resolved: {
              policy: { defaultMode: "worktree", integrationBranchRef: "refs/heads/main" },
            },
          };
        case "workspaces.prepare":
          return {
            workspace: {
              id: "workspace",
              revision: 1,
              owner: args.params.owner,
              projectId: "project",
              environmentId: machine.environmentId,
              path: "C:/fixture/rewind-worktrees/session",
              directoryState: "present",
              branchRef: "refs/heads/bycoda/s/fixture",
            },
          };
        case "commands.dispatch": {
          const input = args.params;
          if (input.type === "create")
            authoritative = {
              ...original,
              id: input.sessionId,
              cwd: input.worktreeCwd,
              blocks: [],
              workspaceId: input.workspaceId,
              workspaceRevision: 1,
            };
          if (input.type === "send" || input.type === "draft") {
            authoritative = {
              ...authoritative,
              blocks: [
                ...authoritative.blocks,
                {
                  id: input.commandId,
                  role: "user",
                  text: input.text,
                  draft: input.type === "draft",
                },
              ],
            };
            revision++;
          }
          if (input.type === "rewind") {
            const index = authoritative.blocks.findIndex((block) => block.id === input.blockId);
            authoritative = { ...authoritative, blocks: authoritative.blocks.slice(0, index) };
            revision++;
          }
          return { commandId: input.commandId, sessionId: authoritative.id, revision };
        }
        case "sessions.sync":
          return {
            kind: "snapshot",
            value: {
              revision,
              session: authoritative,
              projectId: "project",
              status: "idle",
              updatedAt: 1,
            },
          };
        case "sessions.files.revertPlan":
          return { files: [{ path: "src/fixture.ts", action: "restore" }] };
        case "sessions.files.revert":
          return { reverted: ["src/fixture.ts"], skipped: [] };
        case "projects.list":
          return [{ id: "project", cwd: original.cwd, name: "Rewind fixture" }];
        case "workspaces.get":
          return { id: "workspace", revision, owner: { kind: "session", id: original.id } };
        case "sessions.get":
          return {
            revision,
            session: authoritative,
            status: "idle",
            projectId: "project",
            updatedAt: 1,
          };
        case "sessions.rewind.plan":
          return {
            token: `preview-${revision}`,
            expiresAt: Date.now() + 60000,
            direction: args.params.direction,
            workspaceId: "workspace",
            sessionId: original.id,
            userBlockId: "second",
            expectedRevision: revision,
            expectedConversationRevision: revision,
            branchRef: "refs/heads/bycoda/s/readable-session-aabbccddeeff",
            currentHead: "abc123abc123abc123",
            targetHead: "def456def456def456",
            statusFingerprint: "fixture-status",
            removedUserBlockIds: ["second"],
            affectedCommits: ["abc123 First later commit", "abc124 Second later commit"],
            affectedPaths: [
              "src/features/sessions/ui/Composer.tsx",
              "src/features/workspaces/model/rewindClient.ts",
              "tests/browser/workspace-rewind.tsx",
            ],
            blockers: query.has("blocked")
              ? ["The working copy contains an uncaptured source file."]
              : [],
            published: true,
            merged: true,
          } satisfies SessionRewindPlan;
        case "sessions.rewind.apply":
        case "sessions.rewind.undo":
          if (failApply) {
            failApply = false;
            throw new Error("The working copy changed. Close this preview and try again.");
          }
          authoritative =
            args.method === "sessions.rewind.undo"
              ? original
              : { ...original, blocks: original.blocks.slice(0, 2) };
          revision++;
          if (query.has("pane") || query.has("remoteRewind"))
            sessionStorage.setItem(
              "fixture-native-rewind",
              JSON.stringify({ session: authoritative, revision }),
            );
          return {
            operationId: "rewind-operation",
            workspaceId: "workspace",
            sessionId: original.id,
            direction: args.method === "sessions.rewind.undo" ? "undo" : "rewind",
            workspaceRevision: revision,
            conversationRevision: revision,
            head: "def456",
            undoOperationId: "rewind-operation",
          };
        default:
          throw new Error(`Unexpected fixture method ${args.method}`);
      }
    },
  },
});
function Fixture() {
  const [sessions, setSessions] = useState([
    query.has("remoteCreate") || query.has("remoteRewind")
      ? {
          ...original,
          id: "remote-shell",
          cwd: remoteProject.key,
          workspaceId: undefined,
          blocks: [],
        }
      : query.has("pane")
        ? authoritative
        : original,
  ]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const deps = {
    sessionsRef,
    setSessions,
    turnGen: useRef(new Map()),
    enqueueHarnessEvent: () => {},
    flushHarnessEvents: () => {},
    retiringTurns: useRef(new Map()),
    editedResends: {
      isActive: () => active.current,
      start: () => {
        if (active.current) return false;
        active.current = true;
        return true;
      },
      finish: () => {
        active.current = false;
      },
    },
    windowTransferPendingRef: useRef(false),
    movingSessionIds: useRef(new Set()),
    orchestrator: { submissionError: () => null },
    lastBoundProvider: useRef(new Map()),
    lastPersistedUserBlock: useRef(new Map()),
    persistSession: () => {},
  } as unknown as CompactAndRewindDeps;
  const { onRewindMessage } = useCompactAndRewind(deps);
  // Isolated legacy preview coverage calls the experimental APIs explicitly.
  // Per-message actions below continue through the real default controller.
  const experimentalPreview = async () => {
    const plan = await planWorkspaceRewind(sessionsRef.current[0], "workspace", {
      userBlockId: "second",
    });
    await requestWorkspaceRewindPreview(
      plan,
      async () => {
        const result = await applyWorkspaceRewind(
          sessionsRef.current[0],
          plan,
          crypto.randomUUID(),
        );
        setSessions([result.session]);
        offerWorkspaceRewindUndo(original.id, async () => {
          const undo = await planWorkspaceRewind(sessionsRef.current[0], "workspace", {
            operationId: "rewind-operation",
          });
          await requestWorkspaceRewindPreview(
            undo,
            async () => {
              const restored = await applyWorkspaceRewind(
                sessionsRef.current[0],
                undo,
                crypto.randomUUID(),
              );
              setSessions([restored.session]);
            },
            original.id,
          );
        });
      },
      original.id,
    );
  };
  if (query.has("pane") || query.has("remoteCreate") || query.has("remoteRewind")) {
    const noop = () => {};
    const props = {
      session: sessions[0],
      visible: true,
      focused: true,
      inSplit: false,
      composerFocused: true,
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
      onSubmit: () => false,
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
      onRewindMessage,
    } as SessionPaneProps;
    const model = {
      id: "claude:fixture",
      harness: "claude" as const,
      name: "Claude fixture",
      nativeId: "fixture",
      settings: [],
    };
    return (
      <main className="relative h-dvh min-h-0 min-w-0 bg-(--ui-surface) text-(--ui-text)">
        <ModelSourceContext.Provider
          value={{
            modelsFor: () => [model],
            resolve: () => model,
            find: () => model,
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
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-6 text-(--ui-text)">
      <h1 className="text-ui-title font-medium">Review the working copy</h1>
      <p className="text-ui-secondary text-(--ui-text-secondary)">
        Synthetic managed workspace. No repository or provider is modified.
      </p>
      {sessions[0].blocks.map((block) => (
        <p key={block.id} data-block={block.id} className="text-ui-secondary">
          {block.text}
        </p>
      ))}
      <div>
        <Button
          variant="secondary"
          loading={pending}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await experimentalPreview();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          Return before the later change
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-(--ui-tone-danger-fg)">
          {error}
        </p>
      ) : null}
      <WorkspaceRewindPreviewHost sessionId={original.id} />
    </main>
  );
}
setLanguagePreference("en");
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
