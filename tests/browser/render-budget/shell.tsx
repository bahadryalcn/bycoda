import "./scan-boot";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../../../src/app/shell/Sidebar";
import { TitleBar } from "../../../src/app/shell/TitleBar";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import { newSession, type Block, type Session } from "../../../src/features/sessions/model/session";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { registerHarness } from "../../../src/integrations/harness/core/registry";
import { appendUser, stopStreaming } from "../../../src/integrations/harness/core/apply";
import { applyHarnessEvents } from "../../../src/integrations/harness";
import {
  resetSessionsStore,
  sessionsRef,
  setSessions,
  useShellSessions,
} from "../../../src/features/sessions/model/sessionsStore";
import { HarnessEventQueue } from "../../../src/app/model/harnessFlush";
import type { HarnessEvent } from "../../../src/integrations/harness/core/types";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import { languageReady } from "../../../src/shared/i18n";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import "../../../src/styles/index.css";

// Real Sidebar + TitleBar + SessionPane (Composer + transcript). Only the native
// boundary (Tauri IPC) and the provider are simulated; streaming goes through the real
// HarnessEventQueue (30 ms foreground flush) and applyHarnessEvents, like Workspace does.
const unavailable = async () => {
  throw new Error("No live provider in render-measure fixture");
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
const modelId = "claude:render-measure";
setHarnessModels("claude", [
  { id: modelId, nativeId: "render-measure", harness: "claude", name: "Claude fixture model" },
]);
const modelSource = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};

const TURNS = Number(new URLSearchParams(location.search).get("turns") ?? 40);
const blocks: Block[] = Array.from({ length: TURNS }, (_, index): Block[] => [
  {
    id: `user-${index}`,
    role: "user",
    text: `Prompt ${index}: explain this behavior and keep going.`,
  },
  {
    id: `tool-${index}`,
    role: "tool",
    text: `Run pnpm check ${index}`,
    tool: { kind: "shell", status: "completed", detail: `Command result ${index}: ok` },
  },
  {
    id: `reply-${index}`,
    role: "assistant",
    text: `## Answer ${index}\n\n${Array.from(
      { length: 4 },
      (_, p) =>
        `Paragraph ${p}. A settled answer with **bold**, \`code\` and a [link](https://example.com).`,
    ).join("\n\n")}`,
  },
]).flat();
const sessionId = "render-measure-session";
const initial: Session = {
  ...newSession("claude", "/fixture/bycoda", modelId),
  id: sessionId,
  title: "Render measurement conversation",
  blocks,
  context: { used: 64000, window: 128000 },
};
const projects = ["/fixture/bycoda", "/fixture/mobile", "/fixture/service"];
const history = Array.from({ length: 12 }, (_, index) => ({
  id: index === 0 ? sessionId : `discussion-${index}`,
  cwd: projects[0],
  harness: "claude" as const,
  model: modelId,
  runtimeMode: "supervised" as const,
  title: index === 0 ? "Render measurement conversation" : `Product discussion ${index + 1}`,
  createdAt: Date.now() - index * 60_000,
  updatedAt: Date.now() - index * 60_000,
}));

declare global {
  interface Window {
    __shell: {
      stream: (options: {
        deltas: number;
        intervalMs: number;
        toolAt: number[];
      }) => Promise<number>;
      blocks: () => number;
      liveText: () => number;
    };
  }
}

// The session lives in the REAL sessions store (like the app). The pane is fed from the lagging
// shell array (`useShellSessions`, unchanged across text-only frames), every handler and `recents`
// is a module-level constant so props are referentially stable, as in the app.
resetSessionsStore([initial]);
const noop = () => {};
const no = () => false;
const paneRecents: never[] = [];
const paneHandlers = {
  onFocus: noop,
  onClose: noop,
  onCwdChange: noop,
  onBranchChange: noop,
  onWorkspaceModeChange: noop,
  onWorktreeBaseChange: noop,
  onModelChange: noop,
  onModelSettingsChange: noop,
  onRuntimeModeChange: noop,
  onSubmit: no,
  onSaveDraft: no,
  onRemoveDraft: no,
  onStop: noop,
  onCompactContext: no,
  onPlaceSessionInFolder: noop,
  onDeleteQueuedMessage: noop,
  onEditQueuedMessage: noop,
  onQueuedMessageEditingChange: noop,
  onSteerQueuedMessage: no,
  onResumeQueue: no,
  onUsageLimitResumeAtReset: noop,
  onUsageLimitDismiss: noop,
  onApproval: noop,
  onQuestionReply: noop,
  onOpenFile: noop,
  onOpenDiff: noop,
  onOpenPlan: noop,
  onBuildPlan: noop,
  onNewTerminal: noop,
} satisfies Partial<SessionPaneProps>;
const paneFlags = {
  visible: true,
  focused: true,
  inSplit: false,
  composerFocused: false,
  hideProjectPicker: true,
};
const updateSession = (update: (previous: Session) => Session) =>
  setSessions((all) => all.map((item) => (item.id === sessionId ? update(item) : item)));
function Pane({ sessions }: { sessions: Session[] }) {
  const session = sessions.find((item) => item.id === sessionId)!;
  return (
    <SessionPane
      {...(paneHandlers as SessionPaneProps)}
      {...paneFlags}
      recents={paneRecents}
      session={session}
    />
  );
}
function Fixture() {
  const sessions = useShellSessions();
  const busy = !!sessions.find((item) => item.id === sessionId)?.busy;
  const [cwd, setCwd] = useState(projects[0]);
  const [tab, setTab] = useState<"sessions" | "files" | "changes">("sessions");
  const queue = useRef<HarnessEventQueue | null>(null);
  useEffect(() => {
    // Mount-only fixture control surface; Playwright drives it through window.__shell.
    queue.current = new HarnessEventQueue(
      () => true,
      // Same body as useHarnessEventQueue's apply (minus question drafts / output projection).
      (batches) => {
        const prev = sessionsRef.current;
        const next = prev.map((item) => {
          const events = batches.get(item.id);
          return events ? applyHarnessEvents(item, events) : item;
        });
        if (next.some((item, index) => item !== prev[index])) {
          sessionsRef.current = next;
          setSessions(next);
        }
      },
    );
    window.__shell = {
      blocks: () => sessionsRef.current[0].blocks.length,
      liveText: () => {
        const last = sessionsRef.current[0].blocks.at(-1);
        return last?.role === "assistant" ? last.text.length : 0;
      },
      stream: async ({ deltas, intervalMs, toolAt }) => {
        updateSession((previous) => appendUser(previous, "Stream a long answer with tools."));
        const emit = (event: HarnessEvent) => queue.current!.enqueue(sessionId, event);
        const pause = () => new Promise((done) => setTimeout(done, intervalMs));
        emit({ type: "turn.started", providerTurnId: "render-measure-turn" });
        for (let index = 0; index < deltas; index++) {
          if (toolAt.includes(index)) {
            const callId = `stream-tool-${index}`;
            emit({
              type: "tool.started",
              callId,
              title: "Run pnpm test",
              kind: "execute",
              status: "in_progress",
            });
            await pause();
            emit({ type: "tool.updated", callId, status: "completed", detail: "tests passed" });
          }
          emit({ type: "message.delta", text: `token${index} word${index % 7} ` });
          await pause();
        }
        emit({ type: "message.completed" });
        await new Promise((done) => setTimeout(done, 200));
        queue.current!.flush();
        updateSession((previous) => stopStreaming(previous));
        return deltas;
      },
    };
    return () => queue.current?.cancelScheduled();
  }, []);
  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background-base text-content">
      <TitleBar
        tabs={[
          {
            id: "fixture",
            title: initial.title ?? "Session",
            project: "bycoda",
            more: [],
            sessionCount: 1,
            harnesses: ["claude"],
            busyHarnesses: busy ? ["claude"] : [],
            files: [],
            multiPane: false,
          },
        ]}
        detached
        activeId="fixture"
        cwd={cwd}
        onToggleSidebar={noop}
        onNew={noop}
        onSelect={noop}
        onClose={noop}
        onCloseMany={noop}
        onReorder={noop}
        onReturnToMain={noop}
        layout={{ current: null, canArrange: true, onArrange: noop, onSplit: noop }}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar
          cwd={cwd}
          open
          projectRailOpen={false}
          compactProjectRail
          titleBarAbove
          sessions={history}
          liveAgents={[]}
          busySessionIds={new Set(busy ? [sessionId] : [])}
          approvalSessionIds={new Set()}
          activeSessionId={sessionId}
          status="idle"
          pending={false}
          onSelectSession={noop}
          onOpenFile={async () => {}}
          tab={tab}
          onTabChange={setTab}
          filesSearchOpen={false}
          onFilesSearchOpenChange={noop}
          recents={projects.map((path) => ({ path, openedAt: 1 }))}
          onSelectProject={setCwd}
          onOpenProject={noop}
          onToggleProjectRail={noop}
          onOpenLastSessions={noop}
          onShowWorkspace={noop}
          onOpenCrewSession={noop}
          onSearch={noop}
          onSearchConversations={noop}
          onOpenInbox={noop}
          inboxActive={false}
          onGoBack={noop}
          onOpenNotes={noop}
          onOpenServers={noop}
          onOpenTasks={noop}
          onOpenAutomations={noop}
          notesEnabled
          onOpenSettings={noop}
          onSelectSettingsSection={noop}
          onNew={noop}
        />
        <main className="relative min-h-0 min-w-0 flex-1 bg-(--ui-surface)">
          <ModelSourceContext.Provider value={modelSource}>
            <Pane sessions={sessions} />
          </ModelSourceContext.Provider>
        </main>
      </div>
    </div>
  );
}
applyThemePreference("dark");
void Promise.all([languageReady, flushHostSessionBindings()]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
