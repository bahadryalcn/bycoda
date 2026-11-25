import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../../../src/features/sessions/ui/Composer";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import { notifyRemoteRecovered } from "../../../src/features/connections/model/remoteHealth";
import {
  cancelAdoptedTurn,
  observeAdoptedStop,
} from "../../../src/features/connections/model/adoptedSessionCommands";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { modelsForClaudeVersion } from "../../../src/integrations/harness/providers/claude/claudeCatalog";
import type { WorkspaceMode } from "../../../src/features/sessions/model/session";
import { languageReady } from "../../../src/shared/i18n";
import { Button } from "../../../src/shared/ui/Button";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    c1Host: { upgraded: boolean; calls: { command: string; method?: string }[] };
  }
}

setHarnessModels("claude", modelsForClaudeVersion("2.1.295"));
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const initialMode = params.get("mode");
  const adoptedStop = params.has("adopted-stop");
  const [busy, setBusy] = useState(adoptedStop);
  const [mode, setMode] = useState<WorkspaceMode | undefined>(
    initialMode === "current" || initialMode === "worktree" ? initialMode : undefined,
  );
  const [base, setBase] = useState<string>();
  const [submitted, setSubmitted] = useState("");
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center justify-between gap-3 text-sm text-(--ui-text-secondary)">
        <span>Browser fixture · no live Host or provider</span>
        <Button
          onClick={() => {
            if (adoptedStop) {
              observeAdoptedStop("c1-compatibility-draft", { revision: 2, status: "idle" });
              setBusy(false);
              return;
            }
            window.c1Host.upgraded = true;
            notifyRemoteRecovered("c1-environment");
          }}
        >
          {adoptedStop ? "Settle Host turn" : "Simulate Host upgrade and reconnect"}
        </Button>
      </div>
      <ModelSourceContext.Provider value={source}>
        <Composer
          sessionId="c1-compatibility-draft"
          focused
          busy={busy}
          harness="claude"
          model="claude:sonnet-5"
          runtimeMode="supervised"
          cwd="/fixture/c1-project"
          executionCwd="/fixture/c1-project"
          branch="main"
          initialDraft={adoptedStop ? "" : "Keep this draft while the Host updates"}
          onStop={
            adoptedStop
              ? () => {
                  void cancelAdoptedTurn("c1-compatibility-draft", "fixture-run").catch(
                    console.error,
                  );
                }
              : undefined
          }
          inputAriaLabel="Message"
          draftWorkspace
          workspaceMode={mode}
          worktreeBase={base}
          hideProjectPicker
          hideTopBar={new URLSearchParams(location.search).has("compact")}
          onWorkspaceModeChange={setMode}
          onWorktreeBaseChange={setBase}
          onFocus={() => {}}
          onCwdChange={() => {}}
          onModelChange={() => {}}
          onRuntimeModeChange={() => {}}
          onSubmit={(text) => {
            setSubmitted(text);
            return true;
          }}
        />
      </ModelSourceContext.Provider>
      <output data-testid="submitted">{submitted}</output>
    </main>
  );
}

void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);
