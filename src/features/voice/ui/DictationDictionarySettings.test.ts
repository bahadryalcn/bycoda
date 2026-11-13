// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { clearRetainedVoiceDrafts } from "../model/voiceSettingsDrafts";
import { DictationDictionarySettings } from "./DictationDictionarySettings";
import { loadVoiceSettings, saveVoiceSettings, useVoiceSettings } from "../model/voiceSettings";
import { projectKey } from "../../../shared/lib/paths";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  clearRetainedVoiceDrafts();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    const settings = useVoiceSettings();
    return createElement(DictationDictionarySettings, {
      settings,
      change: (patch) => saveVoiceSettings({ ...loadVoiceSettings(), ...patch }),
    });
  }
  await act(async () => root!.render(createElement(Harness)));
  await click("Dictation dictionary");
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
}
async function input(label: string, value: string) {
  const field =
    container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ??
    [...container.querySelectorAll("input")].find(
      (field) => document.querySelector(`label[for="${field.id}"]`)?.textContent === label,
    )!;
  expect(field, label).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("saves preferred spelling with shared scope and keeps cancelled drafts out of settings", async () => {
  await render();
  expect(container.textContent).toContain("No saved terms");
  await click("Add term");
  await input("Preferred spelling", "Bycoda");
  await click("Save term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([{ term: "Bycoda", aliases: [] }]);
  await click("Add term");
  await input("Preferred spelling", "Not saved");
  await click("Cancel");
  expect(loadVoiceSettings().dictationDictionary).toHaveLength(1);
});
it("edits existing aliases and project scope without widening scope or removing other entries", async () => {
  const projectId = projectKey("G:/Projects/clinical-speech-research");
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [
      { term: "FHIR", aliases: ["fire"], projectId },
      { term: "Bycoda", aliases: ["by coda"] },
    ],
  });
  await render();
  await click("Edit");
  await input("Preferred spelling", "HL7 FHIR");
  await click("Save term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "HL7 FHIR", aliases: ["fire"], projectId },
    { term: "Bycoda", aliases: ["by coda"] },
  ]);
  await click("Remove");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "Bycoda", aliases: ["by coda"] },
  ]);
});

it("keeps the draft and refuses to overwrite a shifted entry after a concurrent dictionary change", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [
      { term: "FHIR", aliases: ["fire"] },
      { term: "Bycoda", aliases: ["by coda"] },
    ],
  });
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .filter((button) => button.textContent === "Edit")[1]
      .click(),
  );
  await input("Preferred spelling", "Bycoda Workspace");
  await act(async () =>
    saveVoiceSettings({
      ...loadVoiceSettings(),
      dictationDictionary: [{ term: "Bycoda", aliases: ["by coda"] }],
    }),
  );
  await click("Save term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "Bycoda", aliases: ["by coda"] },
  ]);
  expect(container.textContent).toContain("The dictionary changed while you were editing.");
  expect(
    [...container.querySelectorAll("input")].some((input) => input.value === "Bycoda Workspace"),
  ).toBe(true);
  await click("Add as new term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "Bycoda", aliases: ["by coda"] },
    { term: "Bycoda Workspace", aliases: ["by coda"] },
  ]);
});

it("retains a new draft if concurrent changes fill the dictionary limit", async () => {
  await render();
  await click("Add term");
  await input("Preferred spelling", "My pending term");
  await act(async () =>
    saveVoiceSettings({
      ...loadVoiceSettings(),
      dictationDictionary: Array.from({ length: 500 }, (_, index) => ({
        term: `ClinicalTerm_${index + 1}`,
        aliases: [],
      })),
    }),
  );
  const save = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Save term",
  )!;
  expect(save.disabled).toBe(true);
  await act(async () => save.click());
  expect(loadVoiceSettings().dictationDictionary).toHaveLength(500);
  expect(
    [...container.querySelectorAll("input")].some((input) => input.value === "My pending term"),
  ).toBe(true);
});

it("retains existing aliases, scope and conflict baseline across navigation; Cancel clears retained state", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [{ term: "FHIR", aliases: ["fire"], projectId: "old/project" }],
  });
  await render();
  await click("Edit");
  await input("Preferred spelling", "HL7 FHIR");
  await act(async () => root!.render(null));
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [{ term: "External", aliases: [] }],
  });
  function Harness() {
    return createElement(DictationDictionarySettings, {
      settings: loadVoiceSettings(),
      change: (patch) => saveVoiceSettings({ ...loadVoiceSettings(), ...patch }),
    });
  }
  await act(async () => root!.render(createElement(Harness)));
  expect([...container.querySelectorAll("input")].some((input) => input.value === "HL7 FHIR")).toBe(
    true,
  );
  expect(container.textContent).toContain("fire");
  expect(container.textContent).toContain("Dictionary scopeproject");
  await click("Save term");
  expect(container.textContent).toContain("dictionary changed");
  expect(loadVoiceSettings().dictationDictionary[0].term).toBe("External");
  await click("Cancel");
  await act(async () => root!.render(null));
  await act(async () => root!.render(createElement(Harness)));
  expect([...container.querySelectorAll("input")].some((input) => input.value === "HL7 FHIR")).toBe(
    false,
  );
});

it("reports failed removal beside saved terms and preserves entry until retry", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [{ term: "Kept", aliases: [] }],
  });
  await render();
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  await click("Remove");
  expect(loadVoiceSettings().dictationDictionary[0].term).toBe("Kept");
  expect(container.textContent).toContain("could not be removed");
  await click("Remove");
  expect(loadVoiceSettings().dictationDictionary).toEqual([]);
});
