import { AccountUsageMeters } from "../../../src/features/providers/ui/ProviderAccountUsage";
import { ProjectBackgroundDialog } from "../../../src/features/projects/ui/ProjectBackgroundDialog";
import { RailBackgroundControls } from "../../../src/features/projects/ui/RailBackgroundControls";
import { saveProjectChatBackgroundSettings } from "../../../src/features/projects/model/projectChatBackground";
import { UsageProviderChip } from "../../../src/app/shell/UsageProviderChip";
import { ResumeTurnRow } from "../../../src/features/sessions/ui/ResumeTurnRow";
import { ProviderSignInPanel } from "../../../src/features/sessions/ui/ProviderSignInPanel";
import { SessionImportDialog } from "../../../src/features/sessions/ui/SessionImportDialog";
import { AdditionalDirsDialog } from "../../../src/features/projects/ui/AdditionalDirsDialog";
import { saveAdditionalDirs } from "../../../src/features/projects/model/additionalDirs";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import { newSession, type Session, type Block } from "../../../src/features/sessions/model/session";
import {
  setComposerAttachments,
  setComposerDraft,
} from "../../../src/features/sessions/model/draftCache";
import {
  beginDeliveryProgress,
  updateDeliveryProgress,
} from "../../../src/features/sessions/model/deliveryProgress";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { registerHarness } from "../../../src/integrations/harness/core/registry";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import {
  setSessions,
  useSessionsSelector,
} from "../../../src/features/sessions/model/sessionsStore";
import { languageReady } from "../../../src/shared/i18n";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import "../../../src/styles/index.css";

if (new URLSearchParams(location.search).has("projectVisual")) {
  mockIPC(() => null, { shouldMockEvents: true });
  (window as any).__TAURI_INTERNALS__.convertFileSrc = () => "/crew/star-wars/yoda.svg";
  saveProjectChatBackgroundSettings("/fixture/project", {
    path: "/fixture/image.png",
    emptyOpacity: 0.2,
    sessionOpacity: 0.3,
    scope: "empty",
    effect: "none",
  });
}
if (new URLSearchParams(location.search).has("controlDialogs")) {
  saveAdditionalDirs("/fixture/project", ["/fixture/extra"]);
  mockIPC(
    (command) => {
      if (command === "import_discover") {
        const base = {
          provider: "claude",
          path: "/fixture/a.jsonl",
          providerSessionId: "fixture-a",
          cwd: "/fixture/project",
          cwdExists: true,
          resumable: true,
          firstPrompt: "Fixture conversation",
          startedAt: 1700000000000,
          lastAt: 1700000100000,
          sizeBytes: 2048,
          kind: "interactive",
          model: null,
          archived: false,
        };
        const mode = new URLSearchParams(location.search).get("folderComposition");
        const candidates = new URLSearchParams(location.search).has("manyImports")
          ? Array.from({ length: 151 }, (_, index) => ({
              ...base,
              path: `/fixture/${index}.jsonl`,
              providerSessionId: `fixture-${index}`,
            }))
          : mode
            ? [
                base,
                {
                  ...base,
                  path: "/fixture/b.jsonl",
                  providerSessionId: "fixture-b",
                  cwd: "/fixture/other",
                },
                ...(mode === "mixed"
                  ? ["missing-one", "missing-two"].map((id) => ({
                      ...base,
                      path: `/fixture/${id}.jsonl`,
                      providerSessionId: id,
                      cwd: `/lost/${id}`,
                      cwdExists: false,
                    }))
                  : []),
              ]
            : [base];
        return { candidates, filesScanned: candidates.length, filesSkipped: 0, elapsedMs: 5 };
      }
      if (command === "session_import_keys") return [];
      if (command === "import_read_claude") throw new Error("Fixture transcript unavailable");
      if (command.startsWith("plugin:event|")) return null;
      return undefined;
    },
    { shouldMockEvents: true },
  );
}

if (new URLSearchParams(location.search).has("reviewFixture")) {
  mockIPC(
    (command) => {
      if (command === "session_checkpoint_status")
        return {
          files: [
            {
              path: "/fixture/src/example.ts",
              relative: "src/example.ts",
              status: "modified",
              additions: 7,
              deletions: 2,
              exact: true,
              undoable: true,
            },
          ],
        };
      if (command.startsWith("plugin:event|")) return null;
      throw new Error(`Unavailable in review fixture: ${command}`);
    },
    { shouldMockEvents: true },
  );
}

// The actual pane owns its Composer + PooledTranscript/AgentTranscript composition.
// Only native/provider boundaries and the outer controller callbacks are simulated.
const unavailable = async () => {
  throw new Error("No live provider in session usability fixture");
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
const modelId = "claude:usability-long";
const modelName = "Claude Sonnet research model with a deliberately long descriptive name";
setHarnessModels("claude", [
  { id: modelId, nativeId: "usability-long", harness: "claude", name: modelName },
]);
const modelSource = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
  ...(new URLSearchParams(location.search).has("accountFixture")
    ? {
        accounts: {
          claude: [
            { id: "work", label: "Work" },
            { id: "personal", label: "Personal" },
          ],
        },
      }
    : {}),
};
const sessionId = "integrated-session-usability";
const baseBlocks: Block[] = [
  {
    id: "user",
    role: "user",
    durationMs: 1200,
    text: new URLSearchParams(location.search).has("attachmentToken")
      ? "Inspect [file1] and explain the next safe step."
      : "Inspect the attached report and explain the next safe step.",
    attachments: [
      {
        id: "report",
        kind: "file",
        name: "workspace-report.csv",
        mimeType: "text/csv",
        size: 15,
        data: btoa("Name,Value\nA,1\n"),
      },
    ],
  },
  {
    id: "reply",
    role: "assistant",
    text: "The report is ready for review. Your draft and selected model remain available below.",
  },
];
const initial: Session = {
  ...newSession("claude", "/fixture", modelId),
  id: sessionId,
  title: "Integrated usability conversation with a long project title",
  blocks: baseBlocks,
  rewindHistory: new URLSearchParams(location.search).has("rewindFixture")
    ? [
        {
          id: "rewind-1",
          createdAt: 1700000000000,
          fromBlockId: "old-user",
          blocks: [{ id: "old-user", role: "user", text: "Earlier fixture message" }],
        },
      ]
    : undefined,
  context: { used: 64000, window: 128000 },
};
setComposerDraft(sessionId, "Keep this integrated draft");
setComposerAttachments(sessionId, [
  {
    id: "draft-file",
    kind: "file",
    name: "draft-context.txt",
    mimeType: "text/plain",
    size: 7,
    data: btoa("context"),
  },
]);
const events = { sends: 0, stops: 0, approvals: 0, queueAttempts: 0 };
// The real pane resolves approval identity from the canonical session store.
setSessions([initial]);
type Mode = "idle" | "working" | "approval" | "unknown" | "tools" | "long";
type FixtureControl = {
  mode: (mode: Mode) => void;
  remount: () => void;
  events: typeof events;
};
declare global {
  interface Window {
    sessionUsability: FixtureControl;
  }
}

function Fixture() {
  const session = useSessionsSelector((sessions) =>
    sessions.find((entry) => entry.id === sessionId)!,
  );
  const setSession = (update: Session | ((previous: Session) => Session)) =>
    setSessions((sessions) =>
      sessions.map((entry) =>
        entry.id === sessionId ? (typeof update === "function" ? update(entry) : update) : entry,
      ),
    );
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    window.sessionUsability = {
      events,
      remount: () => setRevision((value) => value + 1),
      mode: (mode) => {
        if (mode === "unknown") {
          const owner = beginDeliveryProgress(sessionId, "queued", "provider");
          updateDeliveryProgress(sessionId, owner, "unknown");
        }
        setSession((previous) => ({
          ...previous,
          busy: mode === "working" || mode === "approval",
          blocks:
            mode === "approval"
              ? [
                  ...baseBlocks,
                  {
                    id: "approval",
                    role: "tool",
                    text: "Run pnpm test",
                    tool: { kind: "shell", status: "pending" },
                    approval: { requestId: 7 },
                  },
                ]
              : mode === "tools"
                ? [
                    ...baseBlocks,
                    {
                      id: "failed-command",
                      role: "tool",
                      text: "pnpm test",
                      tool: {
                        kind: "shell",
                        status: "failed",
                        detail:
                          "Test runner exited before completion. Retry after fixing the configuration.",
                        output: Array.from(
                          { length: 80 },
                          (_, index) =>
                            `Saved output line ${index + 1}: workspace-validation-result-${"path/".repeat(20)}`,
                        ).join("\n"),
                        preview: { kind: "shell", title: "pnpm test --workspace" },
                      },
                    },
                  ]
                : mode === "long"
                  ? [
                      ...baseBlocks,
                      {
                        id: "long-answer",
                        role: "assistant",
                        text:
                          "## Review results\n\n" +
                          "This saved response keeps the explanation readable while retaining the complete report. ".repeat(
                            14,
                          ) +
                          "\n\n| File | Result |\n| --- | --- |\n| " +
                          "very-long-project-directory/".repeat(12) +
                          "report.json | Ready for review |\n\n```text\n" +
                          "saved-output/".repeat(60) +
                          "\n```",
                      },
                    ]
                  : baseBlocks,
          queuedMessages:
            mode === "unknown"
              ? [
                  {
                    id: "queued",
                    text: "Retained follow-up with unknown delivery",
                    attachments: [],
                    deliveryUnknown: true,
                  },
                ]
              : [],
          queueStatus: mode === "unknown" ? "paused" : "active",
        }));
      },
    };
  }, []);
  const noop = () => {};
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
    onModelChange: (_id, harness, model) => setSession((value) => ({ ...value, harness, model })),
    onSelectProviderAccount: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: () => {
      events.sends++;
      return false;
    },
    onSaveDraft: () => false,
    onRemoveDraft: () => false,
    onStop: () => {
      events.stops++;
      setSession((value) => ({ ...value, busy: false }));
    },
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: () => {
      events.queueAttempts++;
      return false;
    },
    onResumeQueue: () => {
      events.queueAttempts++;
      return false;
    },
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: (_id, requestId, decision) => {
      events.approvals++;
      setSession((value) => ({
        ...value,
        busy: false,
        blocks: value.blocks.map((block) =>
          block.approval?.requestId === requestId
            ? { ...block, approval: { requestId, decided: decision } }
            : block,
        ),
      }));
    },
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onSecondOpinion: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  return (
    <main
      className="relative h-dvh min-h-0 min-w-0 bg-[var(--ui-surface)] text-content"
      data-integrated-session
    >
      <ModelSourceContext.Provider value={modelSource}>
        <SessionPane key={revision} {...props} />
      </ModelSourceContext.Provider>
    </main>
  );
}
applyThemePreference(new URLSearchParams(location.search).has("light") ? "light" : "dark");
// The app resolves durable session owners at boot before any pane renders;
// the fixture mounts it directly, so it hydrates the same store first.
void Promise.all([languageReady, flushHostSessionBindings()]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {new URLSearchParams(location.search).has("accountUsageFixture") ? (
        <main>
          <AccountUsageMeters now={1790000000000} limits={undefined} />
          <AccountUsageMeters
            now={1790000000000}
            limits={{
              provider: "codex",
              session: { usedPercent: 42, windowMinutes: 300, resetsAt: 1790010000000 },
              weekly: { usedPercent: 81, windowMinutes: 10080, resetsAt: 1790020000000 },
              monthly: null,
              updatedAt: 1790000000000,
              error: null,
              status: "ok",
            }}
          />
        </main>
      ) : new URLSearchParams(location.search).get("projectVisual") === "background" ? (
        <ProjectBackgroundDialog project="/fixture/project" name="Fixture" onClose={() => {}} />
      ) : new URLSearchParams(location.search).get("projectVisual") === "rail" ? (
        <RailBackgroundControls
          value={{ body: { color: "#123456", opacity: 25 } }}
          color="#654321"
          group
          onChange={() => {}}
        />
      ) : new URLSearchParams(location.search).get("projectVisual") === "mascot" ? (
        <UsageProviderChip
          project="/fixture/project"
          now={1790000000000}
          limits={{
            provider: "codex",
            session: { usedPercent: 42, windowMinutes: 300, resetsAt: 1790010000000 },
            weekly: { usedPercent: 81, windowMinutes: 10080, resetsAt: 1790020000000 },
            monthly: null,
            resetCredits: {
              availableCount: 1,
              credits: [
                {
                  id: "fixture",
                  resetType: "codexRateLimits",
                  status: "available",
                  grantedAt: 1789990000000,
                  expiresAt: 1790090000000,
                  title: "Fixture reset",
                  description: "Fixture",
                },
              ],
            },
            updatedAt: 1790000000000,
            error: null,
            status: "ok",
          }}
        />
      ) : new URLSearchParams(location.search).has("resumeFixture") ? (
        <ResumeTurnRow
          block={{ id: "fixture-resume", role: "user", text: "Continue the retained draft." }}
          kind="resume"
        />
      ) : new URLSearchParams(location.search).has("providerSignIn") ? (
        <ProviderSignInPanel harness="claude" state="idle" onSignIn={() => {}} />
      ) : new URLSearchParams(location.search).has("controlDialogs") ? (
        new URLSearchParams(location.search).get("controlDialogs") === "folders" ? (
          <AdditionalDirsDialog project="/fixture/project" name="Fixture" onClose={() => {}} />
        ) : (
          <SessionImportDialog onClose={() => {}} onImported={() => {}} />
        )
      ) : (
        <Fixture />
      )}
    </QueryClientProvider>,
  ),
);
