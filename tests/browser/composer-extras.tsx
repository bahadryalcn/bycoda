import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { ModelControlPills } from "../../src/features/sessions/ui/ModelPicker";
import { createRoot } from "react-dom/client";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { SessionAgentIdentity } from "../../src/features/sessions/ui/SessionAgentIdentity";
import { ActivityDock } from "../../src/features/sessions/ui/ActivityDock";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { EmptySession } from "../../src/features/sessions/ui/EmptySession";
import { Shimmer } from "../../src/shared/ui/Shimmer";
import { UsageFooter } from "../../src/app/shell/UsageFooter";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
  defaultModelSettings,
} from "../../src/features/sessions/model/models";
import type { HarnessId, RuntimeMode } from "../../src/features/sessions/model/session";
import { modelsForClaudeVersion } from "../../src/integrations/harness/providers/claude/claudeCatalog";
import { parseCodexModelList } from "../../src/integrations/harness/providers/codex/codexCatalog";
import { languageReady } from "../../src/shared/i18n";
import {
  renameProviderAccount,
  saveProviderAccount,
} from "../../src/features/providers/model/providerAccounts";
import "../../src/styles/index.css";

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
const welcome = new URLSearchParams(location.search).has("welcome");
const withCrew = new URLSearchParams(location.search).has("crew");
const withFooter = new URLSearchParams(location.search).has("footer");
const chatLayout = new URLSearchParams(location.search).has("chat-layout");
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
}

function Fixture() {
  const [harness, setHarness] = useState<HarnessId>(
    antigravitySelection ? "antigravity" : "claude",
  );
  const [model, setModel] = useState(
    antigravitySelection ? "antigravity:gemini-3.8-flash-high" : "claude:sonnet-5",
  );
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("supervised");
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [accountId, setAccountId] = useState("default");
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [compacted, setCompacted] = useState(0);
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
        sessionId="composer-layout-fixture"
        harness={harness}
        model={model}
        modelSettings={settings}
        runtimeMode={runtimeMode}
        executionCwd={fixtureCwd}
        cwd={fixtureCwd}
        focused={new URLSearchParams(location.search).has("hint-motion")}
        hideProjectPicker={!showProjectPicker}
        hideBranchPicker
        hideTopBar={!chatLayout}
        remoteSession={remoteLayout}
        remoteFeatures={remoteLayout ? { attachments: true, plan: true, draft: true } : undefined}
        context={chatLayout ? { used: 64000, window: 128000 } : undefined}
        compactSupported={chatLayout}
        onCompactContext={() => {
          setCompacted((count) => count + 1);
          return true;
        }}
        initialDraft="Keep this chat draft"
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
        className={
          welcome
            ? "flex h-screen min-w-0 flex-col bg-background-base text-content"
            : "mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-background-base p-3 text-content"
        }
      >
        {!welcome ? (
          <div className="flex flex-wrap gap-2 text-xs">
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
            <Shimmer>Chat composer · provider options</Shimmer>
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
