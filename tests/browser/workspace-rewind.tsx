import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/Button";
import { WorkspaceRewindPreviewHost } from "../../src/features/workspaces/ui/WorkspaceRewindPreview";
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
const machine = {
  id: "fixture-machine",
  name: "Fixture PC",
  endpoint: "http://127.0.0.1:3774",
  environmentId: "fixture-env",
  localHost: true,
};
let failApply = query.has("failApply");
Object.assign(window, {
  rewindFixtureCalls: calls,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, any> = {}) => {
      if (command === "local_host_connect") return machine;
      if (command === "remote_machines") return [machine];
      if (command === "plugin:event|listen") return 1;
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
              : ["workspaces.managed.v1", "sessions.git-rewind.v1", "sessions.git-rewind-undo.v1"],
          };
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
  const [sessions, setSessions] = useState([original]);
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
              await onRewindMessage(original.id, "second");
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
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
