// One page that shows every transcript state in the real SessionPane, for visual audits.
// Query: bg=image|none, opacity=0.05..0.65 (chat background session opacity), blur=0..40,
// theme=dark|light, density=compact|comfortable|touch, userOpacity, assistantOpacity (0..100),
// queue=0 hides the host-wait notice, question=0 hides the question form, jump=0 hides Jump to latest.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
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
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import {
  setSessions,
  useSessionsSelector,
} from "../../../src/features/sessions/model/sessionsStore";
import { languageReady } from "../../../src/shared/i18n";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import {
  applyAppearancePreferences,
  normalizeAppearancePreferences,
} from "../../../src/features/settings/model/appearancePreferences";
import "../../../src/styles/index.css";

const q = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const value = Number(q.get(key));
  return q.has(key) && Number.isFinite(value) ? value : fallback;
};

mockIPC(
  (command) => {
    if (command === "session_checkpoint_status")
      return {
        files: [
          ["src/features/sessions/ui/AgentTranscript.tsx", 42, 11],
          ["src/styles/bycoda.css", 8, 3],
          ["scripts/setup-production.sh", 19, 0],
        ].map(([relative, additions, deletions]) => ({
          path: `/fixture/${relative}`,
          relative,
          status: "modified",
          additions,
          deletions,
          exact: true,
          undoable: true,
        })),
      };
    if (command.startsWith("plugin:event|")) return null;
    return [];
  },
  { shouldMockEvents: true },
);

// Appearance applied the way the app does at boot, from the query.
applyThemePreference(q.get("theme") === "light" ? "light" : "dark");
applyAppearancePreferences(
  normalizeAppearancePreferences({
    controlDensity: (q.get("density") as "compact" | "comfortable" | "touch") ?? "compact",
    ...(q.has("userOpacity") ? { userMessageOpacity: num("userOpacity", 42) } : {}),
    ...(q.has("assistantOpacity") ? { assistantMessageOpacity: num("assistantOpacity", 26) } : {}),
  }),
);
const root = document.documentElement;
if (q.get("bg") === "image") {
  // A dark, patterned wallpaper like the owner's: deep indigo ground, soft glows, a fine lattice.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
<defs>
<radialGradient id="a" cx="22%" cy="18%" r="70%"><stop offset="0" stop-color="#6a3fd1"/><stop offset="1" stop-color="#0b0a1f"/></radialGradient>
<radialGradient id="b" cx="85%" cy="80%" r="55%"><stop offset="0" stop-color="#1fb5a6" stop-opacity=".85"/><stop offset="1" stop-color="#1fb5a6" stop-opacity="0"/></radialGradient>
<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M0 24h48M24 0v48" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.2"/><circle cx="24" cy="24" r="3" fill="#ffd36e" fill-opacity=".6"/></pattern>
</defs>
<rect width="1600" height="1200" fill="url(#a)"/><rect width="1600" height="1200" fill="url(#b)"/><rect width="1600" height="1200" fill="url(#p)"/>
<g fill="none" stroke="#ff7ab6" stroke-opacity=".5" stroke-width="3"><circle cx="400" cy="300" r="180"/><circle cx="1200" cy="800" r="260"/><path d="M0 900C400 700 800 1100 1600 600"/></g></svg>`;
  root.style.setProperty(
    "--chat-background-image",
    `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
  );
  root.classList.add("has-chat-background", "chat-background-effect-ready");
  root.style.setProperty("--chat-background-session-opacity", String(num("opacity", 0.24)));
  root.style.setProperty("--chat-background-empty-opacity", String(num("opacity", 0.24)));
  const blur = num("blur", 0);
  root.style.setProperty("--chat-background-blur", `${blur}px`);
  root.classList.toggle("chat-background-blurred", blur > 0);
}

const unavailable = async () => {
  throw new Error("No live provider in the scenario fixture");
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
const modelId = "claude:opus-5-5";
setHarnessModels("claude", [
  { id: modelId, nativeId: "opus-5-5", harness: "claude", name: "Opus 5.5" },
]);
const modelSource = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};

const sessionId = "scenario-session";
const now = Date.now();
const minutes = (n: number) => n * 60_000;
const turnModel = { harness: "claude" as const, id: modelId, name: "Opus 5.5" };

const shell = (
  id: string,
  text: string,
  status: string,
  detail?: string,
  output?: string,
): Block => ({
  id,
  role: "tool",
  text,
  tool: { kind: "shell", status, ...(detail ? { detail } : {}), ...(output ? { output } : {}) },
});

const readStep = (index: number) => ({
  id: `step-${index}`,
  kind: "tool" as const,
  text: `Read src/features/sessions/ui/file-${index}.tsx`,
  toolKind: "read",
  status: index === 6 || index === 11 ? "failed" : "completed",
  ...(index === 6 || index === 11 ? { detail: "File not found" } : {}),
});

const delegate = (index: number): Block => ({
  id: `delegate-${index}`,
  role: "tool",
  text: "bycoda-conversation:conversation_agents_delegate",
  tool: {
    kind: "other",
    title: "bycoda-conversation:conversation_agents_delegate",
    status: "completed",
    detail: JSON.stringify({ runId: `run-${index}`, sessionId: `scenario-child-${index}` }),
  },
});

const longReply = [
  "I traced the flicker to the transcript row cache. The surface is painted **per paragraph**, so every block gets its own backdrop, and the gaps between them show the wallpaper.",
  "## What changed",
  "The fix has three parts:\n\n1. Paint the surface once per reply.\n2. Keep the text tokens on the `--ui-text-*` ladder.\n3. Move the hover target to the whole card.",
  "- Rows keep their rhythm in `AgentTranscript.tsx`\n- Chips such as `setup-production.sh` keep their own fill\n- Actions fade in on hover and focus",
  "### Results\n\n| Surface | Before | After |\n| --- | --- | --- |\n| Reply paragraphs | 7 boxes | 1 surface |\n| Header strip | own fill | none |\n| Date row | sometimes | always |",
  'Run the script from `scripts/setup-production.sh`, or read [the contract](https://example.com/docs/contract) first.\n\n```ts\nexport function surfaceFor(block: Block) {\n  return block.role === "assistant" ? "assistant" : "user";\n}\n```',
].join("\n\n");

const blocks: Block[] = [
  // Turn 1: stopped user message with an attached image, then a short reply.
  {
    id: "u1",
    role: "user",
    text: "[image1] Why does the reply background flicker in this screenshot?",
    startedAt: now - minutes(55),
    durationMs: 12_000,
    turnModel,
    turnOutcome: "stopped",
    attachments: [
      {
        id: "shot",
        name: "screenshot.png",
        kind: "image",
        mimeType: "image/png",
        size: 42,
        previewUrl: "/brand/bycoda/icon-512.png",
      },
    ],
  },
  { id: "a1", role: "assistant", text: "Looking at it now." },
  // Turn 2: closed work header with one command, one failed command, one stopped command.
  {
    id: "u2",
    role: "user",
    text: "Run the production setup and check the outcome.",
    startedAt: now - minutes(40),
    durationMs: 41_000,
    turnModel,
  },
  shell("c1", "bash scripts/setup-production.sh", "completed", "Setup finished.", "ok: 14 steps"),
  shell("c2", "pnpm test --workspace", "failed", "Exit code 1: 2 tests failed", "FAIL a.test.ts"),
  shell("c3", "pnpm dev", "stopped", "Stopped by you."),
  {
    id: "a2",
    role: "assistant",
    text: "The setup script ran; the workspace tests report two failures and the dev server was stopped.",
  },
  // Turn 3: long answer with delegated work and native subagents.
  {
    id: "u3",
    role: "user",
    text: "Audit the three suites in parallel and fix the transcript surfaces. Use `setup-production.sh` as the reference.",
    startedAt: now - minutes(25),
    durationMs: minutes(6) + 21_000,
    turnModel,
  },
  { id: "think", role: "reasoning", text: "Planning the audit across three suites." },
  shell("c4", 'rg -n "chat-message-surface" src/styles', "completed", undefined, "bycoda.css:232"),
  shell("c5", "git status --short", "completed", undefined, " M src/styles/bycoda.css"),
  delegate(1),
  delegate(2),
  {
    id: "native-agent",
    role: "tool",
    text: "Review changes",
    tool: { callId: "spawn-1", kind: "agent", status: "completed" },
    agentRun: {
      name: "Correctness review",
      model: "claude:sonnet-5-5",
      prompt: "Review the requested changes",
      startedAt: now - minutes(20),
      endedAt: now - minutes(14),
      steps: Array.from({ length: 23 }, (_, index) => readStep(index)),
    },
  },
  {
    id: "native-agent-running",
    role: "tool",
    text: "Visual audit",
    tool: { callId: "spawn-2", kind: "agent", status: "in_progress" },
    agentRun: {
      name: "Visual audit",
      model: "claude:sonnet-5-5",
      prompt: "Capture every transcript state",
      startedAt: now - minutes(3),
      steps: Array.from({ length: 5 }, (_, index) => readStep(index + 30)),
    },
  },
  { id: "a3", role: "assistant", text: longReply },
  {
    id: "h1",
    role: "handoff",
    text: "Handoff",
    handoff: { from: "claude", to: "codex", status: "ready" },
  },
  // Turn 4: the host-wait status notice, then a plain reply.
  ...(q.get("queue") === "0"
    ? []
    : [
        {
          id: "wait",
          role: "system" as const,
          text: "Waiting for the bycoda Host to coordinate the queued messages. They send as soon as it answers.",
        },
      ]),
  {
    id: "a4",
    role: "assistant",
    text: "Today the answer is done. This short reply ends the scenario with the action row below it.",
  },
];

const child = (index: number, title: string, patch: Partial<Session>, tools: Block[]): Session => ({
  ...newSession("claude", "/fixture"),
  id: `scenario-child-${index}`,
  title,
  model: "claude:sonnet-5-5",
  modelSettings: {
    delegationParent: JSON.stringify({
      parentSessionId: sessionId,
      runId: `run-${index}`,
      kind: "subagent",
      model: "claude:sonnet-5-5",
      startedAt: now - minutes(24) + index * 1000,
    }),
  },
  blocks: [
    {
      id: `brief-${index}`,
      role: "user",
      text: `Task:\n${title}`,
      startedAt: now - minutes(24) + index * 1000,
    },
    ...tools,
    { id: `said-${index}`, role: "assistant", text: `${title}: report ready.` },
  ],
  ...patch,
});

const toolBlocks = (prefix: string, count: number, failed: number): Block[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: "tool" as const,
    text: `Read src/file-${index}.ts`,
    tool: {
      kind: "read",
      status: index < failed ? "failed" : "completed",
      ...(index < failed ? { detail: "File not found" } : {}),
    },
  }));

const initial: Session = {
  ...newSession("claude", "/fixture", modelId),
  id: sessionId,
  title: "Transcript scenario",
  blocks,
  busy: false,
  context: { used: 64000, window: 200000 },
  ...(q.get("question") === "0"
    ? {}
    : {
        pendingQuestion: {
          requestId: 17,
          providerTurnId: "turn-fixture",
          callId: "question-fixture",
          behavior: "blocking" as const,
          dismissAction: "cancel" as const,
          questions: [
            {
              id: "scope",
              header: "Release scope",
              prompt: "Which surfaces should the fix cover?",
              options: [
                { id: "a", label: "Transcript only", description: "Chat messages and work rows." },
                { id: "b", label: "Everywhere", description: "Every card in the app." },
              ],
              allowCustom: true,
              multiSelect: false,
            },
          ],
        },
      }),
};
setSessions([
  initial,
  child(1, "W19: Benchmark review", {}, toolBlocks("t1", 23, 2)),
  child(2, "W20: Migration check", { busy: true }, toolBlocks("t2", 7, 0)),
]);

function Fixture() {
  const session = useSessionsSelector((all) => all.find((entry) => entry.id === sessionId)!);
  const [, setTick] = useState(0);
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
    onModelChange: noop,
    onSelectProviderAccount: noop,
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
    onQuestionReply: () => setTick((value) => value + 1),
    onOpenFile: noop,
    onOpenDiff: noop,
    onSecondOpinion: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  return (
    <main className="relative h-dvh min-h-0 min-w-0 bg-(--ui-surface) text-content">
      <ModelSourceContext.Provider value={modelSource}>
        <SessionPane {...props} />
      </ModelSourceContext.Provider>
    </main>
  );
}

void Promise.all([languageReady, flushHostSessionBindings()]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
