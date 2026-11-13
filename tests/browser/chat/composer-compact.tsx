import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";
import { setNotesPanelOpen } from "../../../src/features/notes/notesPanel";
import { ContextMeter } from "../../../src/features/sessions/ui/ContextMeter";
import { hydrateComposerDrafts } from "../../../src/features/sessions/data/composerDraftStore";
import { hydrateHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import { newSession, type Block, type Session } from "../../../src/features/sessions/model/session";
import {
  setComposerAttachments,
  setComposerDraft,
} from "../../../src/features/sessions/model/draftCache";
import {
  findModel,
  modelsFor,
  resolveModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { registerHarness } from "../../../src/integrations/harness/core/registry";
import { languageReady } from "../../../src/shared/i18n";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import {
  APPEARANCE_DEFAULTS,
  applyAppearancePreferences,
  normalizeAppearancePreferences,
} from "../../../src/features/settings/model/appearancePreferences";
import "../../../src/styles/index.css";

// The real SessionPane (transcript follow owner + Composer). Only native and
// provider boundaries and the outer controller callbacks are simulated.
const unavailable = async () => {
  throw new Error("No live provider in composer reading fixture");
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
const modelId = "claude:reading-fixture";
setHarnessModels("claude", [
  { id: modelId, nativeId: "reading-fixture", harness: "claude", name: "Claude Sonnet 4.5" },
]);
const modelSource = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};

const params = new URLSearchParams(location.search);
const sessionId = "composer-reading-fixture";
const DRAFTS: Record<string, string> = {
  none: "",
  short: "Summarise the failing tests",
  multi:
    "Please check the three files below,\nthen explain the failure\nand propose the smallest safe fix.",
  long: Array.from(
    { length: 24 },
    (_, index) => `Line ${index + 1} of a very long draft that must scroll inside the field.`,
  ).join("\n"),
  wrap: "A single long paragraph that wraps over several lines in a narrow pane because it keeps going without any line break at all, which is what a pasted sentence looks like. ".repeat(
    2,
  ),
};
const turns = Number(params.get("turns") ?? 40);
const baseBlocks: Block[] = Array.from({ length: turns }, (_, index): Block[] => [
  {
    id: `user-${index}`,
    role: "user",
    text: `Question ${index + 1}: what should happen with item ${index + 1}?`,
  },
  {
    id: `reply-${index}`,
    role: "assistant",
    text:
      `Answer ${index + 1}. ` +
      "The reply keeps the explanation readable and long enough to wrap across several lines in a narrow pane. ".repeat(
        3,
      ),
  },
]).flat();
const initial: Session = {
  ...newSession("claude", "/fixture", modelId),
  id: sessionId,
  title: "Composer reading mode",
  ...(params.has("docked-question")
    ? {
        pendingQuestion: {
          requestId: 88,
          questions: [
            {
              id: "choice",
              prompt: "Select a target",
              multiSelect: false,
              allowCustom: false,
              options: [
                { id: "one", label: "First target" },
                { id: "two", label: "Second target" },
              ],
            },
          ],
        },
      }
    : {}),
  ...(params.has("backgroundOnly")
    ? { busy: true, backgroundTasks: ["Wait for test runs to finish"], backgroundAgents: 0 }
    : {}),
  blocks: params.has("savedDraft")
    ? [
        ...baseBlocks,
        { id: "saved-draft", role: "user", text: "Saved draft for editing", draft: true },
      ]
    : baseBlocks,
  context: { used: 64000, window: 128000 },
};
function seedComposer() {
  setComposerDraft(sessionId, DRAFTS[params.get("draft") ?? "none"] ?? "");
  if (params.has("attach")) {
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
  }
}

const events = { sends: 0, stops: 0, paneDrags: 0 };
declare global {
  interface Window {
    compactFixture: {
      events: typeof events;
      /** Appends a streaming assistant block, then grows it by `chunks` pieces. */
      stream: (chunks: number) => void;
      finish: () => void;
    };
  }
}

function Fixture() {
  const [session, setSession] = useState(initial);
  useEffect(() => {
    window.compactFixture = {
      events,
      stream: (chunks) =>
        setSession((previous) => {
          const existing = previous.blocks.find((block) => block.id === "streaming");
          const text = `${existing?.text ?? ""}${"Streaming words keep arriving here. ".repeat(chunks)}`;
          const block: Block = { id: "streaming", role: "assistant", text, streaming: true };
          return {
            ...previous,
            busy: true,
            blocks: existing
              ? previous.blocks.map((item) => (item.id === "streaming" ? block : item))
              : [...previous.blocks, block],
          };
        }),
      finish: () =>
        setSession((previous) => ({
          ...previous,
          busy: false,
          blocks: previous.blocks.map((block) => ({ ...block, streaming: false })),
        })),
    };
  }, []);
  const noop = () => {};
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: params.has("split"),
    onPaneDragStart: params.has("pane-grab")
      ? () => {
          events.paneDrags++;
        }
      : undefined,
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
  };
  return (
    <main
      className="relative h-dvh min-h-0 min-w-0 bg-[var(--ui-surface)] text-content"
      data-integrated-session
    >
      <ModelSourceContext.Provider value={modelSource}>
        <SessionPane {...props} />
      </ModelSourceContext.Provider>
    </main>
  );
}
applyThemePreference(params.has("light") ? "light" : "dark");
// ?density=compact|comfortable|touch applies the real control-density preference.
applyAppearancePreferences(
  normalizeAppearancePreferences({
    ...APPEARANCE_DEFAULTS,
    controlDensity: params.get("density") as "compact" | "comfortable" | "touch",
  }),
);
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    invoke: async (command: string) => {
      if (command === "canonical_store_session_guard_ready") return false;
      if (command === "canonical_store_list") return { entries: [], revision: 0 };
      if (command === "session_list_drafts") return [];
      if (command === "session_checkpoint_status") return { files: [] };
      if (command === "notes_list" || command === "notes_list_summaries") return [];
      if (command === "plugin:event|listen") return 1;
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
    convertFileSrc: (path: string) => path,
  },
});
void Promise.all([
  languageReady,
  hydrateHostSessionBindings().then(() => hydrateComposerDrafts()),
]).then(() => {
  seedComposer();
  if (params.has("notes")) setNotesPanelOpen(true);
  return createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {params.has("context-sections") ? (
        <main className="p-8">
          <ContextMeter
            usage={{ used: 64000, window: 128000 }}
            sessionUsage={{
              costUsd: 1.8,
              apiMs: 290000,
              lastProcessCostUsd: 1.8,
              lastProcessApiMs: 290000,
            }}
            contextBlocks={[
              {
                id: "context-agent",
                role: "tool",
                text: "Agent",
                tool: {
                  callId: "context-agent",
                  kind: "agent",
                  status: "completed",
                  agentContext: { used: 12000 },
                },
                agentRun: { name: "Review", steps: [] },
              },
            ]}
            onCompact={() => {}}
          />
        </main>
      ) : (
        <Fixture />
      )}
    </QueryClientProvider>,
  );
});
