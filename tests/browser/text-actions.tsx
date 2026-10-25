import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TranslationResultDialog } from "../../src/features/sessions/ui/TranslationResultDialog";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import {
  findModel,
  modelsFor,
  resolveModel,
  saveLastModelChoice,
  saveLastModelSettings,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import {
  saveDefaultRepromptChoice,
  saveDefaultTranslationChoice,
} from "../../src/features/sessions/model/translationPreferences";
import type { TextActionTarget } from "../../src/features/sessions/model/translation";
import {
  registerHarness,
  type TextPromptInput,
} from "../../src/integrations/harness/core/registry";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

type Request = {
  input: TextPromptInput;
  aborted: boolean;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};
type RequestSnapshot = {
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  cwd: string;
  aborted: boolean;
};
export type TextActionsFixture = {
  snapshot: () => RequestSnapshot[];
  delta: (text: string) => void;
  resolve: (text: string) => void;
  reject: (message: string) => void;
  open: (target: TextActionTarget) => void;
  applied: () => string;
};
declare global {
  interface Window {
    __textActionsFixture: TextActionsFixture;
  }
}

const requests: Request[] = [];
let applied = "";
let openDialog: (target: TextActionTarget) => void = () => {};
const latest = () => {
  const request = requests.at(-1);
  if (!request) throw new Error("No fixture request has started");
  return request;
};
window.__textActionsFixture = {
  snapshot: () =>
    requests.map(({ input, aborted }) => ({
      model: input.model,
      modelSettings: input.modelSettings,
      providerAccountId: input.providerAccountId,
      cwd: input.cwd,
      aborted,
    })),
  delta: (text) => latest().input.onEvent?.({ type: "message.delta", text }),
  resolve: (text) => latest().resolve(text),
  reject: (message) => latest().reject(new Error(message)),
  open: (target) => openDialog(target),
  applied: () => applied,
};

registerHarness({
  id: "codex",
  live: true,
  sendTurn: async () => {
    throw new Error("Live turns are unavailable in the fixture");
  },
  steerTurn: async () => {},
  cancelTurn: async () => {},
  respondApproval: () => {},
  stopSession: async () => {},
  forgetSession: async () => {},
  bindSession: () => {},
  runTextPrompt: (input) =>
    new Promise<string>((resolve, reject) => {
      const request = { input, resolve, reject, aborted: false };
      requests.push(request);
      const abort = () => {
        request.aborted = true;
        reject(new DOMException("Fixture request aborted", "AbortError"));
      };
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
    }),
});
setHarnessModels(
  "codex",
  ["default", "override"].map((variant) => ({
    id: `codex:fixture-${variant}`,
    nativeId: `fixture-${variant}`,
    harness: "codex",
    name: variant === "default" ? "Settings default model" : "Action override model",
    settings: [
      {
        id: "effort",
        label: "Effort",
        kind: "select",
        value: "medium",
        options: [
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
    ],
  })),
);
saveLastModelChoice("codex", "codex:fixture-default");
saveLastModelSettings({ effort: "high" });
saveDefaultRepromptChoice(undefined);
saveDefaultTranslationChoice(undefined);
const params = new URLSearchParams(location.search);
const initialTarget = params.get("target") === "en" ? "en" : "reprompt";
if (params.has("override")) {
  const save =
    initialTarget === "reprompt" ? saveDefaultRepromptChoice : saveDefaultTranslationChoice;
  save({ harness: "codex", model: "codex:fixture-override", modelSettings: { effort: "medium" } });
}
document.documentElement.classList.toggle("theme-light", params.has("light"));
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: (harness: string) => harness === "codex",
  probed: () => true,
  refresh: () => {},
};

function Fixture() {
  const [request, setRequest] = useState<{ target: TextActionTarget; id: number } | null>({
    target: initialTarget,
    id: 0,
  });
  openDialog = (target) => setRequest((current) => ({ target, id: (current?.id ?? 0) + 1 }));
  return (
    <ModelSourceContext.Provider value={source}>
      {request ? (
        <TranslationResultDialog
          key={request.id}
          text="Make the selected-text action start immediately and keep the waiting state clear."
          surroundingText="This is a desktop conversation tool. Keep existing drafts and model preferences."
          target={request.target}
          context={{
            cwd: "/fixture-project",
            harness: "claude",
            model: "claude:conversation-model",
            providerAccountId: "conversation-account",
            modelSettings: { effort: "low" },
          }}
          onApply={(text) => {
            applied = text;
          }}
          onClose={() => setRequest(null)}
        />
      ) : null}
    </ModelSourceContext.Provider>
  );
}
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
