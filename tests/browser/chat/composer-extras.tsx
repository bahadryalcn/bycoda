import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { ModelControlPills } from "../../../src/features/sessions/ui/ModelPicker";
import { createRoot } from "react-dom/client";
import { Composer } from "../../../src/features/sessions/ui/Composer";
import { SessionAgentIdentity } from "../../../src/features/sessions/ui/SessionAgentIdentity";
import { ActivityDock } from "../../../src/features/sessions/ui/ActivityDock";
import { registerHarness } from "../../../src/integrations/harness/core/registry";
import { applyHarnessEvent } from "../../../src/integrations/harness/core/apply";
import { EmptySession } from "../../../src/features/sessions/ui/EmptySession";
import { WorkingIndicator } from "../../../src/shared/ui/WorkingIndicator";
import { UsageFooter } from "../../../src/app/shell/UsageFooter";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
  defaultModelSettings,
} from "../../../src/features/sessions/model/models";
import {
  setHarnessAttachmentsSupported,
  newSession,
  type HarnessId,
  type RuntimeMode,
} from "../../../src/features/sessions/model/session";
import { modelsForClaudeVersion } from "../../../src/integrations/harness/providers/claude/claudeCatalog";
import { parseCodexModelList } from "../../../src/integrations/harness/providers/codex/codexCatalog";
import { languageReady } from "../../../src/shared/i18n";
import {
  renameProviderAccount,
  saveProviderAccount,
} from "../../../src/features/providers/model/providerAccounts";
import "../../../src/styles/index.css";

// Real composer and catalogs, without a native host or provider invocation.
setHarnessModels("claude", modelsForClaudeVersion("2.1.295"));
setHarnessModels(
  "codex",
  parseCodexModelList([
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
      serviceTiers: ["fast"],
    },
  ]),
);
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: (harness: HarnessId) =>
    !new URLSearchParams(location.search).has("antigravity-selection") || harness === "antigravity",
  probed: () => true,
  refresh: () => {},
};
const accountPicker = new URLSearchParams(location.search).has("accounts");
// A provider whose transport takes text only: files dragged over the composer are refused with a reason.
if (new URLSearchParams(location.search).has("no-attachments"))
  setHarnessAttachmentsSupported("claude", false);
const welcome = new URLSearchParams(location.search).has("welcome");
const withCrew = new URLSearchParams(location.search).has("crew");
const withFooter = new URLSearchParams(location.search).has("footer");
const chatLayout = new URLSearchParams(location.search).has("chat-layout");
const workspaceFooter = new URLSearchParams(location.search).has("workspace-footer");
const remoteLayout = new URLSearchParams(location.search).has("remote");
const showProjectPicker = new URLSearchParams(location.search).has("project-picker");
const longAccount = new URLSearchParams(location.search).has("long-account");
const translationSelection = new URLSearchParams(location.search).has("translation-selection");
const antigravitySelection = new URLSearchParams(location.search).has("antigravity-selection");
if (antigravitySelection)
  setHarnessModels("antigravity", [
    {
      id: "antigravity:gemini-3.8-flash-high",
      nativeId: "gemini-3.8-flash-high",
      harness: "antigravity",
      name: "Gemini 3.8 Flash (High)",
    },
  ]);
if (chatLayout || translationSelection) {
  const unavailable = async () => {
    throw new Error("No live provider in chat layout fixture");
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
    ...(translationSelection ? { runTextPrompt: async () => "Translated fixture text" } : {}),
  });
  if (antigravitySelection)
    registerHarness({
      id: "antigravity",
      live: true,
      canSteer: false,
      sendTurn: unavailable,
      steerTurn: unavailable,
      cancelTurn: unavailable,
      stopSession: unavailable,
      forgetSession: unavailable,
      respondApproval: () => {},
      bindSession: () => {},
      runTextPrompt: async () => "Translated fixture text",
    });
}
const fixtureCwd = welcome
  ? "/fixture/a-long-project-name-for-checking-narrow-workspace-panels"
  : "/fixture";
if (accountPicker) {
  renameProviderAccount(
    "claude",
    "default",
    longAccount ? "personal-account-with-a-very-long-name-for-layout" : "personal",
  );
  saveProviderAccount({
    id: "account-work",
    provider: "claude",
    label: "work",
  });
  // `accounts=N` adds more Claude profiles, so each account-control size can be captured.
  const extra = ["Agency", "Client Acme", "Client Orbit", "Side project", "Team 2", "Research"];
  const count = Number(new URLSearchParams(location.search).get("accounts")) || 2;
  extra
    .slice(0, Math.max(0, count - 2))
    .forEach((label, index) =>
      saveProviderAccount({ id: `account-extra-${index}`, provider: "claude", label }),
    );
}

import {
  beginDeliveryProgress,
  updateDeliveryProgress,
  clearDeliveryProgress,
} from "../../../src/features/sessions/model/deliveryProgress";

function Fixture() {
  const queueVisual = new URLSearchParams(location.search).get("queue-state");
  const visualBackground = new URLSearchParams(location.search).has("queue-background");
  const [fixtureRows, setFixtureRows] = useState(() =>
    queueVisual === "empty" || queueVisual === "last-success"
      ? []
      : queueVisual === "one"
        ? ["queued"]
        : ["queued", "queued-next"],
  );
  useEffect(() => {
    const theme = new URLSearchParams(location.search).get("theme");
    if (theme) document.documentElement.classList.toggle("theme-light", theme === "light");
  }, []);
  const queueFeedback = new URLSearchParams(location.search).has("queue-feedback");
  const deliveryProgress = new URLSearchParams(location.search).has("delivery-progress");
  const [queueStatus, setQueueStatus] = useState<"paused" | "active">(
    ["active", "busy", "one", "empty", "last-success"].includes(queueVisual ?? "")
      ? "active"
      : "paused",
  );
  useEffect(() => {
    if (queueVisual === "last-success") {
      const progress = beginDeliveryProgress("composer-layout-fixture", "queued", "preparing");
      updateDeliveryProgress("composer-layout-fixture", progress, "accepted");
      return () => clearDeliveryProgress("composer-layout-fixture", progress);
    }
    if (queueVisual !== "rejected") return;
    const progress = beginDeliveryProgress("composer-layout-fixture", "queued", "preparing");
    updateDeliveryProgress(
      "composer-layout-fixture",
      progress,
      "rejected",
      "The provider rejected the message. It remains queued and paused.",
    );
    return () => clearDeliveryProgress("composer-layout-fixture", progress);
  }, [queueVisual]);
  const [harness, setHarness] = useState<HarnessId>(
    antigravitySelection ? "antigravity" : "claude",
  );
  const [model, setModel] = useState(
    antigravitySelection ? "antigravity:gemini-3.8-flash-high" : "claude:sonnet-5",
  );
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("supervised");
  const [busy, setBusy] = useState(
    queueVisual === "active" || queueVisual === "busy" || queueVisual === "one",
  );
  const [disabled, setDisabled] = useState(false);
  const [accountId, setAccountId] = useState("default");
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [compacted, setCompacted] = useState(0);
  const compactReading = new URLSearchParams(location.search).get("compact-context");
  const [contextSession, setContextSession] = useState<ReturnType<typeof newSession>>(() => ({
    ...newSession("claude", fixtureCwd),
    context: { used: 64000, window: 128000 },
  }));
  const composer = (
    <>
      <div
        data-session-header
        className="session-header-title flex min-w-0 items-center gap-2 border-b border-stroke p-2"
      >
        <span className="min-w-0 flex-1 truncate text-xs">Chat layout fixture</span>
        <SessionAgentIdentity
          harness={harness}
          model={model}
          accountId={accountId}
          running={busy}
          showAccount={accountPicker}
        />
      </div>
      <Composer
        queuedMessages={
          queueVisual
            ? [
                {
                  id: "queued",
                  text: "Connect GitHub and manage deployments from the repository",
                  modelTarget: {
                    harness: "claude" as const,
                    model: "claude:sonnet-5",
                    providerAccountId: "default",
                    modelSettings: {},
                  },
                  attachments: [],
                  deliveryUnknown: queueVisual === "unknown" ? true : undefined,
                },
                {
                  id: "queued-next",
                  text: "Configure the Cloudflare DNS records",
                  modelTarget: {
                    harness: "claude" as const,
                    model: "claude:sonnet-5",
                    providerAccountId: "account-work",
                    modelSettings: {},
                  },
                  attachments: [],
                },
              ].filter((row) => fixtureRows.includes(row.id))
            : queueFeedback || deliveryProgress
              ? [
                  {
                    id: "queued",
                    text: "Queued task waiting for the current turn",
                    attachments: [],
                  },
                ]
              : undefined
        }
        queueStatus={queueVisual || queueFeedback || deliveryProgress ? queueStatus : undefined}
        onResumeQueue={
          queueVisual || queueFeedback || deliveryProgress
            ? async () => {
                await new Promise((resolve) => setTimeout(resolve, 800));
                setQueueStatus("active");
                return {
                  kind: "waiting",
                  message: "Queue resumed. Messages will send when this turn finishes.",
                };
              }
            : undefined
        }
        onDeleteQueuedMessage={
          queueVisual
            ? (id) => {
                const index = fixtureRows.indexOf(id);
                if (index < 0) return false;
                setFixtureRows((rows) => rows.filter((entry) => entry !== id));
                return {
                  undo: () => {
                    setFixtureRows((rows) =>
                      rows.includes(id)
                        ? rows
                        : [...rows.slice(0, index), id, ...rows.slice(index)],
                    );
                    return true;
                  },
                };
              }
            : undefined
        }
        onSteerQueuedMessage={
          queueVisual || queueFeedback || deliveryProgress
            ? async () => {
                if (deliveryProgress) {
                  const progress = beginDeliveryProgress(
                    "composer-layout-fixture",
                    "queued",
                    "syncing",
                  );
                  await new Promise((resolve) => setTimeout(resolve, 12_000));
                  updateDeliveryProgress("composer-layout-fixture", progress, "confirming");
                  await new Promise((resolve) => setTimeout(resolve, 800));
                  updateDeliveryProgress(
                    "composer-layout-fixture",
                    progress,
                    "rejected",
                    "The send was cancelled or rejected. The message remains queued and the queue is paused.",
                  );
                  return false;
                }
                await new Promise((resolve) => setTimeout(resolve, 800));
                return false;
              }
            : undefined
        }
        sessionId="composer-layout-fixture"
        harness={harness}
        model={model}
        modelSettings={settings}
        runtimeMode={runtimeMode}
        executionCwd={fixtureCwd}
        cwd={fixtureCwd}
        focused={new URLSearchParams(location.search).has("hint-motion")}
        hideProjectPicker={!showProjectPicker}
        hideBranchPicker={!workspaceFooter}
        branch={workspaceFooter ? "main" : undefined}
        onWorktreeChange={workspaceFooter ? async () => {} : undefined}
        hideTopBar={!chatLayout}
        remoteSession={remoteLayout}
        remoteFeatures={remoteLayout ? { attachments: true, plan: true, draft: true } : undefined}
        context={chatLayout ? contextSession.context : undefined}
        contextBlocks={
          new URLSearchParams(location.search).has("response-speed")
            ? [
                {
                  id: "measured-turn",
                  role: "user",
                  text: "Completed response",
                  durationMs: 4000,
                  turnMetrics: { outputTokens: 200 },
                },
              ]
            : undefined
        }
        compactSupported={chatLayout}
        onCompactContext={() => {
          setCompacted((count) => count + 1);
          if (compactReading) {
            setContextSession((session) =>
              applyHarnessEvent(
                session,
                compactReading === "known"
                  ? { type: "context.compacted", used: 16000, window: 128000 }
                  : { type: "context.compacted" },
              ),
            );
          }
          return true;
        }}
        initialDraft="Keep this chat draft"
        editLastTurnSupported={new URLSearchParams(location.search).has("shortcuts")}
        lastTurnRecall={
          new URLSearchParams(location.search).has("shortcuts")
            ? { text: "Earlier message", attachments: [] }
            : null
        }
        inputAriaLabel="Message"
        busy={busy}
        disabled={disabled}
        providerAccountId={accountId}
        onSelectProviderAccount={accountPicker ? (_, id) => setAccountId(id) : undefined}
        onFocus={() => {}}
        onCwdChange={() => {}}
        onSubmit={() => {}}
        onModelChange={(next, id, account) => {
          setHarness(next);
          setModel(id);
          if (account) setAccountId(account);
          setSettings(defaultModelSettings(resolveModel(next, id)));
        }}
        onModelSettingsChange={setSettings}
        onRuntimeModeChange={setRuntimeMode}
        onStop={() => setBusy(false)}
      >
        {chatLayout ? (
          <ActivityDock
            sessionId="composer-layout-fixture"
            blocks={[]}
            busy={busy}
            pendingQuestion={false}
            visible
            atEnd
            onOpenAgent={() => {}}
          />
        ) : null}
      </Composer>
    </>
  );
  return (
    <ModelSourceContext.Provider value={source}>
      <main
        style={
          visualBackground
            ? {
                backgroundImage: "url('/crew/star-wars/r2-d2.svg')",
                backgroundRepeat: "repeat",
                backgroundSize: "240px",
              }
            : undefined
        }
        className={
          welcome
            ? "flex h-screen min-w-0 flex-col bg-background-base text-content"
            : "mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-background-base p-3 text-content"
        }
      >
        {!welcome ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {queueVisual ? (
              <button
                onClick={() => {
                  const progress = beginDeliveryProgress(
                    "composer-layout-fixture",
                    "queued",
                    "preparing",
                  );
                  setTimeout(() => {
                    updateDeliveryProgress("composer-layout-fixture", progress, "accepted");
                    setFixtureRows((rows) => rows.filter((row) => row !== "queued"));
                  }, 100);
                }}
              >
                Confirm queued
              </button>
            ) : null}
            {["claude", "codex", "grok", "gemini"].map((provider) => (
              <button
                key={provider}
                onClick={() => {
                  const next = provider as HarnessId;
                  const picked = modelsFor(next)[0];
                  setHarness(next);
                  setModel(picked.id);
                  setSettings(defaultModelSettings(picked));
                }}
              >
                {provider}
              </button>
            ))}
            <button onClick={() => setBusy((v) => !v)}>Toggle busy</button>
            <button onClick={() => setDisabled((v) => !v)}>Toggle disabled</button>
            {chatLayout ? (
              <>
                <button onClick={() => localStorage.setItem("bycoda.followUpBehavior", "queue")}>
                  Use queue
                </button>
                <button onClick={() => localStorage.setItem("bycoda.followUpBehavior", "steer")}>
                  Use steer
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {!welcome ? (
          <div className="flex-1 text-sm text-content/60">
            <WorkingIndicator label="Chat composer · provider options" />
          </div>
        ) : null}
        {welcome ? (
          <EmptySession cwd={fixtureCwd} composer={composer} hasChatBackground={!withCrew} />
        ) : (
          composer
        )}
        {withFooter ? (
          <>
            <UsageFooter
              providers={["claude", "codex"]}
              tools={{ cwd: fixtureCwd, sessionId: "composer-layout-fixture", title: "Chat" }}
              onNewTerminal={() => setTerminalOpened(true)}
            />
            <output data-testid="terminal-opened" className="sr-only">
              {String(terminalOpened)}
            </output>
          </>
        ) : null}
        <output data-testid="choice" className="hidden">
          {JSON.stringify({ harness, model, settings })}
        </output>
        <output data-testid="compacted" className="hidden">
          {compacted}
        </output>
      </main>
    </ModelSourceContext.Provider>
  );
}
function ScalarFixture() {
  const ref = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState({ reasoningEffort: "medium", serviceTier: "default" });
  return (
    <main className="flex min-w-0 flex-wrap gap-2 p-4">
      <input aria-label="Scalar draft" ref={ref} defaultValue="Preserve this draft" />
      <ModelSourceContext.Provider value={source}>
        <ModelControlPills
          harness="codex"
          model="codex:gpt-5.4"
          values={values}
          onSettingsChange={(next) => setValues(next as typeof values)}
          onClose={() => ref.current?.focus()}
        />
      </ModelSourceContext.Provider>
      <output data-testid="scalar-settings">{JSON.stringify(values)}</output>
    </main>
  );
}
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {new URLSearchParams(location.search).has("scalar") ? <ScalarFixture /> : <Fixture />}
    </QueryClientProvider>,
  ),
);
