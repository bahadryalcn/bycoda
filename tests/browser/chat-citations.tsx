import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { InterruptedNotice } from "../../src/features/sessions/ui/InterruptedNotice";
import { newSession } from "../../src/features/sessions/model/session";
import { markTurnInterrupted } from "../../src/features/sessions/model/inFlight";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import type { QuoteRequest } from "../../src/features/sessions/model/quoteDraft";
import type { Block } from "../../src/features/sessions/model/session";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { modelsForClaudeVersion } from "../../src/integrations/harness/providers/claude/claudeCatalog";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

const sessionId = "citation-fixture-session";
const showRecovery = new URLSearchParams(location.search).has("recovery");
const recoverySession = markTurnInterrupted({
  ...newSession("claude", "/fixture/chat-citations"),
  busy: true,
  providerSessionId: "fixture-provider",
  blocks: [{ id: "recovery-prompt", role: "user", text: "Keep the existing task" }],
});
const assistantText =
  "Seçilen metni kaynak mesajıyla birlikte alıntı olarak ekleyelim. Yorumun da bu alıntıya bağlı kalsın.";
const initialBlocks: Block[] = [
  {
    id: "citation-user",
    role: "user",
    text: "Chat alanını biraz daha açık yapalım. Seçtiğim yanıta yorum ekleyerek devam edebilmek istiyorum.",
    createdAt: 1,
  },
  { id: "citation-assistant", role: "assistant", text: assistantText, createdAt: 2 },
];
document.documentElement.classList.toggle(
  "theme-light",
  new URLSearchParams(location.search).get("theme") === "light",
);
document.documentElement.dataset.canvasBackground = "pure";
setHarnessModels("claude", modelsForClaudeVersion("2.1.295"));
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};
const unavailable = async () => {
  throw new Error("No live provider in the citation fixture");
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
  runTextPrompt: async () =>
    "Let’s add the selected text as a quote linked to its source message. Your comment should stay attached to the quote.",
});
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      if (window.fixtureClipboardFailure) throw new Error("Fixture clipboard unavailable");
      window.fixtureCopiedText = text;
    },
  },
});
const copy = document.execCommand.bind(document);
document.execCommand = (command, ...args) =>
  command === "copy" && window.fixtureClipboardFailure ? false : copy(command, ...args);

declare global {
  interface Window {
    fixtureClipboardFailure?: boolean;
    fixtureCopiedText?: string;
    __chatCitationFixture: {
      draft: () => string;
      submitted: () => string;
      remount: () => void;
      changeSource: () => void;
    };
  }
}

function Fixture() {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [quoteRequest, setQuoteRequest] = useState<QuoteRequest>();
  const [mount, setMount] = useState(0);
  const [draft, setDraft] = useState("Keep my existing draft.");
  const [submitted, setSubmitted] = useState("");
  const [continued, setContinued] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    window.__chatCitationFixture = {
      draft: () => draft,
      submitted: () => submitted,
      remount: () => setMount((value) => value + 1),
      changeSource: () =>
        setBlocks((current) =>
          current.map((block) =>
            block.id === "citation-assistant"
              ? { ...block, text: "The original source was edited." }
              : block,
          ),
        ),
    };
  }, [draft, submitted]);
  return (
    <main className="chat-pane-background flex h-dvh flex-col text-content">
      <header className="flex shrink-0 items-center justify-between border-b border-(--ui-pane-border) px-5 py-3">
        <span className="text-ui-secondary font-medium">Chat experience · monocode</span>
        <span className="text-ui-caption text-(--ui-text-secondary)">
          Isolated component fixture
        </span>
      </header>
      <div className="min-h-0 flex-1" data-testid="transcript-pane">
        <AgentTranscript
          sessionId={sessionId}
          blocks={blocks}
          cwd="/fixture/chat-citations"
          harness="claude"
          model="claude:sonnet-5"
          onAddToChat={(text) => setQuoteRequest({ id: ++requestId.current, text })}
          onSaveSelectionNote={() => {}}
        />
      </div>
      <div className="mx-auto w-full max-w-4xl shrink-0 px-5 pb-4" data-testid="composer-pane">
        {showRecovery ? (
          <InterruptedNotice
            session={recoverySession}
            interruptedTurn={!continued}
            onContinue={() => setContinued(true)}
          />
        ) : null}
        <ModelSourceContext.Provider value={source}>
          <Composer
            key={mount}
            sessionId={sessionId}
            focused
            harness="claude"
            model="claude:sonnet-5"
            runtimeMode="supervised"
            cwd="/fixture/chat-citations"
            executionCwd="/fixture/chat-citations"
            branch="main"
            initialDraft={draft}
            quoteRequest={quoteRequest}
            onQuoteRequestConsumed={() => setQuoteRequest(undefined)}
            inputAriaLabel="Message"
            hideProjectPicker
            hideTopBar
            onFocus={() => {}}
            onCwdChange={() => {}}
            onModelChange={() => {}}
            onRuntimeModeChange={() => {}}
            onDraftChange={setDraft}
            onSubmit={(text) => {
              setSubmitted(text);
              setBlocks((current) => [
                ...current,
                { id: "citation-sent", role: "user", text, createdAt: 3 },
              ]);
              return true;
            }}
          />
        </ModelSourceContext.Provider>
      </div>
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
