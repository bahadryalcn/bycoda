import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPane, type SessionPaneProps } from "../../src/features/sessions/ui/SessionPane";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import { newSession, type Session, type Block } from "../../src/features/sessions/model/session";
import {
  setComposerAttachments,
  setComposerDraft,
} from "../../src/features/sessions/model/draftCache";
import {
  beginDeliveryProgress,
  updateDeliveryProgress,
} from "../../src/features/sessions/model/deliveryProgress";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { languageReady } from "../../src/shared/i18n";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

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
};
const sessionId = "integrated-session-usability";
const baseBlocks: Block[] = [
  {
    id: "user",
    role: "user",
    text: "Inspect the attached report and explain the next safe step.",
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
type Mode = "idle" | "working" | "approval" | "unknown";
type FixtureControl = { mode: (mode: Mode) => void; remount: () => void; events: typeof events };
declare global {
  interface Window {
    sessionUsability: FixtureControl;
  }
}

function Fixture() {
  const [session, setSession] = useState(initial);
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
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
