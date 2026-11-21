import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  GitCommitGenerationActions,
  GitGenerationModelControl,
  useGitGenerationChoice,
} from "../../../src/features/source-control/ui/GitGenerationSettings";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { modelsForClaudeVersion } from "../../../src/integrations/harness/providers/claude/claudeCatalog";
import { registerHarness } from "../../../src/integrations/harness/core/registry";
import { languageReady } from "../../../src/shared/i18n";
import { Button } from "../../../src/shared/ui/Button";
import { TextareaField } from "../../../src/shared/ui/TextareaField";
import { WandSparkles } from "../../../src/shared/ui/icons";
import { GitCommitGenerationNotice } from "../../../src/features/source-control/ui/GitFeedback";
// Shared tokens (control heights, field roles) so shared Buttons size as in the app.
import "../../../src/styles/index.css";
import "./git-generation.css";

setHarnessModels("claude", modelsForClaudeVersion("2.1.300"));
// Git generation offers only text-capable providers; their models feed the advisor and subagent rows.
const unavailable = async () => {
  throw new Error("No live provider in git generation fixture");
};
registerHarness({
  id: "claude",
  live: true,
  canSteer: false,
  sendTurn: unavailable,
  steerTurn: unavailable,
  cancelTurn: unavailable,
  stopSession: unavailable,
  forgetSession: unavailable,
  respondApproval: () => {},
  bindSession: () => {},
  runTextPrompt: async () => "Fixture commit message",
});
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};
function Fixture() {
  const [choice, update] = useGitGenerationChoice("/fixture");
  const [draft, setDraft] = useState("Keep this commit draft");
  return (
    <ModelSourceContext.Provider value={source}>
      <aside className="m-3 w-[calc(100%-24px)] max-w-[340px] rounded border border-stroke bg-sidebar p-2 text-content">
        <div className="mb-2 text-[12px] font-medium">Changes</div>
        <div className="relative">
          <textarea
            aria-label="Commit message"
            className="w-full rounded bg-content/10 p-2 pr-12 text-[13px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="absolute right-1 top-1 flex items-center rounded-md bg-content/10">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              label="Generate commit message"
              aria-label="Generate commit message"
            >
              <WandSparkles className="size-3.5" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
        <div className="mt-1">
          <GitGenerationModelControl
            cwd="/fixture"
            preferred="claude"
            choice={choice}
            onChange={update}
            disabled={false}
          />
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <button className="h-7 flex-1 rounded bg-content text-[12px] text-background-base">
            Commit
          </button>
        </div>
        <div className="mt-3 text-[11px] text-content/50">STAGED CHANGES · 3</div>
        <div className="py-2 text-[12px]">
          claudeAdvisor.ts
          <br />
          GitGenerationSettings.tsx
          <br />
          textHarness.ts
        </div>
        <output data-testid="choice" className="hidden">
          {JSON.stringify(choice)}
        </output>
      </aside>
    </ModelSourceContext.Provider>
  );
}

function CommitControlFixture() {
  const [choice, update] = useGitGenerationChoice("/fixture", "commit");
  const [draft, setDraft] = useState("Keep this commit draft");
  return (
    <ModelSourceContext.Provider value={source}>
      <aside className="m-3 w-[calc(100%-24px)] max-w-[340px] p-2 text-content">
        <TextareaField
          label="Commit message"
          hideLabel
          fieldSize="sm"
          minRows={1}
          autosize
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          endAdornment={
            <GitCommitGenerationActions
              cwd="/fixture"
              preferred="claude"
              choice={choice}
              onChange={update}
              canGenerate
              generating={false}
              generate={() => setDraft("Fixture commit message")}
              cancel={() => {}}
            />
          }
        />
      </aside>
    </ModelSourceContext.Provider>
  );
}

function CommitNoticeFixture() {
  const [notice, setNotice] = useState(true);
  const [draft, setDraft] = useState("Describe the staged changes");
  const hasSuggestion = new URLSearchParams(location.search).has("suggestion");
  return (
    <aside className="m-3 flex w-[calc(100%-24px)] max-w-[440px] flex-col gap-1.5 p-2">
      <TextareaField
        label="Commit message"
        hideLabel
        fieldSize="sm"
        minRows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button variant="primary">Commit</Button>
      {notice && (
        <GitCommitGenerationNotice
          result={{
            changesUpdated: !hasSuggestion,
            suggestion: hasSuggestion ? "Generated commit message" : undefined,
          }}
          onUse={() => {
            setDraft("Generated commit message");
            setNotice(false);
          }}
          onDismiss={() => setNotice(false)}
        />
      )}
    </aside>
  );
}

const mode = new URLSearchParams(location.search);
void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    mode.has("notice") ? (
      <CommitNoticeFixture />
    ) : mode.has("commit") ? (
      <CommitControlFixture />
    ) : (
      <Fixture />
    ),
  ),
);
