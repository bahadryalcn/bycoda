import { VoiceVisualizer } from "../../../src/features/voice/ui/VoiceVisualizer";
import { VoiceLauncher } from "../../../src/features/voice/ui/companion/VoiceLauncher";
import { VoiceToolActivityPanel } from "../../../src/features/voice/ui/VoiceToolActivityPanel";
import { VoiceChatTranscript } from "../../../src/features/voice/ui/companion/VoiceChatTranscript";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../../src/shared/ui/Button";
import {
  VoiceCompanion,
  type VoiceWorkspaceOutlet,
} from "../../../src/features/voice/ui/VoiceCompanion";
import { VoiceCompanionGate } from "../../../src/features/voice/ui/VoiceCompanionGate";
import { VoiceLauncherSlot } from "../../../src/features/voice/ui/companion/voiceLauncherSlot";
import { VoiceSettings } from "../../../src/features/voice/ui/VoiceSettings";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceVisual,
} from "../../../src/features/voice/model/voiceSettings";
import { fixtureVoice } from "./voice-visual-styles-mocks";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { noteDisplayRefreshRate } from "../../../src/features/settings/model/decorativeMotion";
import { newSession, type Session } from "../../../src/features/sessions/model/session";
import { registerVoiceDraftReader } from "../../../src/features/voice/model/voiceDraftContext";
import { AssistantSetup } from "../../../src/features/assistant/ui/AssistantSetup";
import { saveKeybindingOverride } from "../../../src/features/settings/model/settings";
import {
  createVoiceWorkspaceActions,
  useVoiceWorkspaceActions,
} from "../../../src/app/workspace/bridges/useVoiceWorkspaceActions";
import type { UsageReportRow } from "../../../src/features/usage/public/usageReport";
import { leaf, splitPane } from "../../../src/features/workspace/model/layout";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import "../../../src/styles/index.css";
const params = new URLSearchParams(location.search);
const wakeQuickSettings = params.has("wake-quick-settings");
const PaneTree = params.has("session-outlet")
  ? (await import("../../../src/features/workspace/ui/PaneTree")).PaneTree
  : undefined;
if (PaneTree) await flushHostSessionBindings();
const paneQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
if (params.has("high-refresh")) noteDisplayRefreshRate(240);
if (params.has("push-to-talk"))
  saveKeybindingOverride("Voice: Push to Talk", { shortcut: "Control+Shift+KeyQ" });
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
saveVoiceSettings({
  ...loadVoiceSettings(),
  enabled: true,
  visual: (params.get("visual") || "mark") as VoiceVisual,
  compact: false,
});
// Persona setup appears on first launch; scenarios opt in with ?first-run.
if (params.has("first-run")) localStorage.removeItem("bycoda.voice.persona");
else if (!localStorage.getItem("bycoda.voice.persona"))
  localStorage.setItem("bycoda.voice.persona", JSON.stringify({ status: "skipped" }));
const session = {
  ...newSession("codex", "/fixture"),
  id: "fixture",
  title: params.has("live-work")
    ? "Voice regression tests"
    : "Voice visual styles · a long session title to verify truncation",
  cwd: params.has("remote") ? "remote://paired/repo" : "/fixture",
  blocks: params.has("live-work")
    ? [
        {
          id: "work-turn",
          role: "user",
          text: "Run the voice tests",
          startedAt: 1_700_000_000_000,
        },
        {
          id: "work-lint",
          role: "tool",
          text: "pnpm lint",
          tool: { title: "pnpm lint", status: "completed", detail: "No lint errors." },
        },
        {
          id: "work-types",
          role: "tool",
          text: "pnpm typecheck",
          tool: {
            title: "pnpm typecheck",
            status: "failed",
            detail: "One fixture has an invalid type.",
          },
        },
        {
          id: "work-command",
          role: "tool",
          text: "pnpm test",
          tool: {
            title: "pnpm test",
            status: "running",
            detail:
              " RUN  v5.1.0\n\n ✓ voiceLiveWork.test.ts · 2 tests\n ✓ voiceOverlay.test.ts · 4 tests\n\n Test files  2 passed\n 2 voice tests passed",
          },
        },
      ]
    : [],
  harness: "codex",
  model: "fixture-model",
  busy: params.get("state") === "working" || params.has("working") || params.has("live-work"),
} as unknown as Session;
const navigation = params.has("navigation");
const global = params.has("global") || navigation;
if (params.has("live-jobs")) {
  fixtureVoice.jobs.push({
    id: "prepare-release",
    title: "Prepare release notes",
    updatedAt: 1_700_000_001_000,
    projectId: "fixture-project",
    status: "running",
    progress: { done: 2, total: 3 },
    summary: "Collecting the final test results.",
    taskIds: ["release-check"],
    sessionIds: [session.id],
    dispatchState: "submitted",
  });
}
if (params.has("control"))
  fixtureVoice.jobs.push({
    id: "control-job",
    title: "Recovery",
    projectId: "fixture-project",
    version: 1,
    status: "running",
  });
if (params.has("fresh-scope")) localStorage.removeItem("bycoda.voice.scope");
else
  localStorage.setItem(
    "bycoda.voice.scope",
    params.get("scope") === "project" ? "project" : global ? "global" : "project",
  );
if (global)
  registerVoiceDraftReader(session.id, () => ({
    text: "Please review this unsent request before I send it.",
    attachments: [
      {
        id: "fixture-text",
        name: "review.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 26,
        data: btoa("Unsent attachment contents"),
      },
    ],
  }));
const usageRow = (key: string, label: string, cost: number, tokens: number): UsageReportRow => ({
  key,
  label,
  cost,
  tokens,
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  durationMs: 0,
  unpricedTokens: 0,
  share: cost > 0 ? cost / 10 : null,
});
const usageWorkspace = params.has("usage")
  ? createVoiceWorkspaceActions(() => ({
      getProjects: () => [{ path: session.cwd, name: "Fixture project" }],
      getSessions: () => [session],
      getActiveSessionId: () => session.id,
      getProjectPath: () => session.cwd,
      inspect: {
        usage: {
          read: async (request) => {
            fixtureVoice.actions.push(`usage:${request.period}:${request.metric}`);
            const empty = request.period === "last-30-days";
            return {
              period: request.period,
              metric: request.metric,
              costBasis: "api-equivalent-estimate",
              timeZone: "Europe/Istanbul",
              window: {
                startMs: 1793480400000,
                endMs: 1795477200000,
                start: "2026-11-01",
                end: "2026-11-24",
              },
              filters: {},
              totals: usageRow("total", "Total", empty ? 0 : 10, empty ? 0 : 800),
              providers: empty
                ? []
                : [usageRow("codex", "Codex", 7.5, 600), usageRow("claude", "Claude", 2.5, 200)],
              models: empty
                ? []
                : [
                    usageRow("gpt-fixture", "GPT Fixture", 7.5, 600),
                    usageRow("sonnet-fixture", "Sonnet Fixture", 2.5, 200),
                  ],
              projects: [],
              coverage: {
                partial: false,
                accounts: { read: 2, failed: 0 },
                sessionTurns: "available",
                notes: empty ? ["no-data"] : [],
              },
            };
          },
        },
      },
    }))
  : undefined;
const workspace =
  usageWorkspace ??
  (global
    ? {
        tools: [
          {
            name: "workspace.projects.list",
            description: "List fixture projects.",
            parameters: { type: "object", properties: {} },
          },
          ...(params.has("live-work")
            ? [
                {
                  name: "workspace.views.open",
                  description: "Open fixture views.",
                  parameters: {
                    type: "object",
                    properties: { view: { enum: ["notes", "tasks"] } },
                  },
                },
              ]
            : []),
        ],
        execute: async (action: string) => {
          fixtureVoice.actions.push(action);
          if (params.has("pending-tool"))
            return new Promise((resolve) => {
              fixtureVoice.finishTool = resolve;
            });
          return {
            status: "completed",
            projects: [{ path: session.cwd, name: "Fixture project" }],
          };
        },
      }
    : undefined);
function FixtureCompanion() {
  const [next, setNext] = useState(false);
  const [outlet, setOutlet] = useState<VoiceWorkspaceOutlet>();
  const [outletLayout] = useState(() =>
    splitPane(leaf(session.id), session.id, "right", "fixture-next"),
  );
  const [work, setWork] = useState(session);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- The browser fixture accepts one synthetic incoming work update.
  useEffect(() => {
    if (!params.has("live-work")) return;
    const advance = () =>
      setWork({
        ...session,
        blocks: [
          ...session.blocks,
          {
            id: "work-browser",
            role: "tool",
            text: "pnpm test:browser",
            tool: { title: "pnpm test:browser", status: "running", detail: "Chromium ready." },
          },
        ],
      });
    window.addEventListener("fixture-voice-work-update", advance);
    return () => window.removeEventListener("fixture-voice-work-update", advance);
  }, []);
  const second = {
    ...session,
    id: "fixture-next",
    title: "Second fixture project",
    cwd: "/fixture-next",
  };
  const current = next ? second : work;
  const sessionWorkspace = useVoiceWorkspaceActions({
    getProjects: () => [
      { path: work.cwd, name: work.title },
      { path: second.cwd, name: second.title },
    ],
    getSessions: () => [work, second],
    getActiveSessionId: () => current.id,
    getProjectPath: () => current.cwd,
    onOpen: (id) => {
      setNext(id === second.id);
    },
  });
  const noop = () => {};
  const Companion = wakeQuickSettings ? VoiceCompanionGate : VoiceCompanion;
  return (
    <main style={{ padding: 24, maxInlineSize: 720 }}>
      <p>Fixture evidence · synthetic audio and session state</p>
      {params.get("wake-quick-settings") !== "error" && <VoiceSettings />}
      {navigation && (
        <Button onClick={() => setNext((value) => !value)}>Switch fixture project</Button>
      )}
      {wakeQuickSettings && (
        <footer
          style={{
            position: "fixed",
            insetBlockEnd: 8,
            insetInlineStart: 8,
            display: "flex",
            justifyContent: "center",
            inlineSize: params.has("compact-rail") ? 56 : undefined,
          }}
        >
          <VoiceLauncherSlot compact={params.has("compact-rail")} />
        </footer>
      )}
      {PaneTree && (
        <div style={{ height: 420 }}>
          <QueryClientProvider client={paneQueryClient}>
            <PaneTree
              layout={outletLayout}
              sessionOutlet={outlet?.kind === "session" ? outlet : undefined}
              visible
              sessions={[work, second]}
              editorPanes={[]}
              dirtyFileIds={new Set()}
              fileErrorCounts={new Map()}
              focusedId={current.id}
              composerFocused={false}
              recents={[]}
              onFocus={noop}
              onClose={noop}
              onSelectFile={noop}
              onCloseFile={noop}
              onCloseOtherFiles={noop}
              onReorderFiles={noop}
              onFileDirtyChange={noop}
              onFileErrorCountChange={noop}
              onRatio={noop}
              onCwdChange={noop}
              onBranchChange={noop}
              onWorkspaceModeChange={noop}
              onWorktreeBaseChange={noop}
              onModelChange={noop}
              onModelSettingsChange={noop}
              onRuntimeModeChange={noop}
              onSubmit={() => false}
              onSaveDraft={noop}
              onRemoveDraft={noop}
              onStop={noop}
              onCompactContext={() => false}
              onPlaceSessionInFolder={noop}
              onDeleteQueuedMessage={noop}
              onEditQueuedMessage={noop}
              onQueuedMessageEditingChange={noop}
              onSteerQueuedMessage={noop}
              onResumeQueue={noop}
              onUsageLimitResume={noop}
              onUsageLimitResumeAtReset={noop}
              onUsageLimitDismiss={noop}
              onApproval={noop}
              onQuestionReply={noop}
              onOpenFile={noop}
              onOpenDiff={noop}
              onOpenPlan={noop}
              onUpdatePlan={noop}
              onBuildPlan={noop}
              onMovePane={noop}
              onDetachPane={noop}
              onNewTerminal={noop}
            />
          </QueryClientProvider>
        </div>
      )}
      <Companion
        activeId={params.has("no-active") ? undefined : current.id}
        sessions={navigation ? [work, second] : [work]}
        onSubmit={() => {
          fixtureVoice.submits++;
          return false;
        }}
        onStop={() => {
          fixtureVoice.stops++;
        }}
        workspace={PaneTree ? sessionWorkspace : workspace}
        onWorkspaceOutlet={PaneTree ? setOutlet : undefined}
        projects={
          global
            ? [
                { path: session.cwd, name: "Fixture project" },
                ...(navigation ? [{ path: second.cwd, name: second.title }] : []),
              ]
            : undefined
        }
        projectPath={global ? current.cwd : undefined}
        assistantSession={
          global
            ? navigation
              ? { ...current, id: `assistant-${current.id}` }
              : current
            : undefined
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("working-probe") ? (
    <VoiceVisualizer visual={loadVoiceSettings().visual} state="listening" working />
  ) : params.has("launcher-dot") ? (
    <VoiceLauncher
      ref={null}
      visual="mark"
      name="Arif"
      avatar={undefined}
      state="connecting"
      onOpen={() => {}}
    />
  ) : params.has("activity-probe") ? (
    <main>
      <VoiceToolActivityPanel
        entries={[
          {
            id: "fixture",
            name: "Search",
            target: "project",
            projectPath: "/fixture",
            startedAt: Date.now(),
            state: "running",
          },
          ...(params.has("activity-states")
            ? (
                [
                  {
                    id: "unknown",
                    name: "desktop.windows.list",
                    state: "uncertain",
                    elapsedMs: 1000,
                  },
                  { id: "done", name: "app_tools_list", state: "returned", elapsedMs: 0 },
                  { id: "choices", name: "present_choices", state: "returned", elapsedMs: 81000 },
                  {
                    id: "waiting",
                    name: "workspace.sessions.update",
                    state: "waiting-owner",
                    elapsedMs: 2000,
                  },
                  { id: "failed", name: "desktop.windows.focus", state: "failed", elapsedMs: 3000 },
                  {
                    id: "long",
                    name: "workspace.sessions.anextremelylongunbrokentoolidentifierthatmustwrapwithoutoverlappingduration",
                    state: "returned",
                    elapsedMs: 3000,
                  },
                ] as const
              ).map((entry) => ({
                ...entry,
                target: "project",
                projectPath: "/fixture",
                startedAt: 0,
                requestId: `request-${entry.id}`,
              }))
            : []),
        ]}
        onStopWaiting={() => {}}
      />
    </main>
  ) : params.has("transcript-fixture") ? (
    <main style={{ padding: 24, maxInlineSize: 560 }}>
      <VoiceChatTranscript
        turns={[
          { id: 1, role: "owner", text: "Please review this draft." },
          { id: 2, role: "assistant", text: "I will review it." },
        ]}
      />
    </main>
  ) : params.has("setup-wizard") ? (
    <VoiceSetupFixture />
  ) : (
    <FixtureCompanion />
  ),
);
Object.assign(window, { fixtureVoice });

function VoiceSetupFixture() {
  const [open, setOpen] = useState(true);
  return open ? <AssistantSetup voice onClose={() => setOpen(false)} /> : null;
}
