// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ transcriptionModels: vi.fn() }));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
import { DictationModelSettings } from "./DictationModelSettings";
import { DictationCleanupSettings } from "./DictationCleanupSettings";
import { loadVoiceSettings, saveVoiceSettings, useVoiceSettings } from "../model/voiceSettings";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render(component: typeof DictationModelSettings | typeof DictationCleanupSettings) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    const settings = useVoiceSettings();
    return createElement(component, {
      settings,
      change: (patch) => saveVoiceSettings({ ...loadVoiceSettings(), ...patch }),
    });
  }
  await act(async () => root!.render(createElement(Harness)));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it("keeps cleanup off by default and preserves its options through disable and re-enable", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationCleanup: {
      enabled: false,
      model: "gpt-6.1-sol",
      instructions: "Keep clinical terms.",
      correctionCue: "scratch that",
      translateToEnglish: true,
    },
  });
  await render(DictationCleanupSettings);
  expect(container.querySelector('[data-setting-id="dictation-cleanup-instructions"]')).toBeNull();
  const toggle = () =>
    container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Clean up dictated text"]',
    )!;
  await act(async () => toggle().click());
  expect(container.textContent).toContain("Surrounding drafts are not sent.");
  expect(container.querySelector("textarea")?.value).toBe("Keep clinical terms.");
  await act(async () => toggle().click());
  expect(loadVoiceSettings().dictationCleanup).toMatchObject({
    enabled: false,
    model: "gpt-6.1-sol",
    instructions: "Keep clinical terms.",
    translateToEnglish: true,
  });
  await act(async () => toggle().click());
  expect(container.querySelector("textarea")?.value).toBe("Keep clinical terms.");
});
it("shows discovery failure and retries without replacing the saved transcription choice", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationEngine: "openrouter",
    dictationModels: { openrouter: "mistralai/voxtral-mini-2606" },
  });
  backend.transcriptionModels.mockRejectedValueOnce(new Error("Synthetic discovery failed"));
  await render(DictationModelSettings);
  expect(container.textContent).toContain("Could not load transcription models.");
  expect(loadVoiceSettings().dictationModels.openrouter).toBe("mistralai/voxtral-mini-2606");
  backend.transcriptionModels.mockResolvedValue([
    { id: "mistralai/voxtral-mini-2606", label: "Mistral Voxtral Mini" },
  ]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(container.textContent).not.toContain("Could not load transcription models.");
  expect(container.textContent).toContain("Mistral Voxtral Mini");
  expect(backend.transcriptionModels).toHaveBeenCalledTimes(2);
});
it("marks a saved model absent from the live catalog without silently changing it", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationEngine: "openrouter",
    dictationModels: { openrouter: "retired/speech-model" },
  });
  backend.transcriptionModels.mockResolvedValue([
    { id: "mistralai/voxtral-mini-2606", label: "Mistral Voxtral Mini" },
  ]);
  await render(DictationModelSettings);
  expect(container.textContent).toContain(
    "Saved transcription model is unavailable. Choose an available model.",
  );
  expect(loadVoiceSettings().dictationModels.openrouter).toBe("retired/speech-model");
});
