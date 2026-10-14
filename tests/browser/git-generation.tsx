import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  GitGenerationSettings,
  useGitGenerationChoice,
} from "../../src/features/source-control/ui/GitGenerationSettings";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { modelsForClaudeVersion } from "../../src/integrations/harness/providers/claude/claudeCatalog";
import { languageReady } from "../../src/shared/i18n";
import { WandSparkles } from "../../src/shared/ui/icons";
import "./git-generation.css";

setHarnessModels("claude", modelsForClaudeVersion("2.1.300"));
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
            <button
              type="button"
              aria-label="Generate commit message"
              className="grid size-5 place-items-center rounded-md text-content hover:bg-content/20"
            >
              <WandSparkles className="size-3" />
            </button>
            <GitGenerationSettings
              cwd="/fixture"
              preferred="claude"
              choice={choice}
              onChange={update}
              disabled={false}
            />
          </div>
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
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
