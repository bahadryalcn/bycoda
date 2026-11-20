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

function buttonNamed(text: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
}

it("explains the 500-term ceiling beside the list and disables Add term only at the limit", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: Array.from({ length: 500 }, (_, index) => ({
      term: `ClinicalTerm_${index + 1}`,
      aliases: [],
    })),
  });
  await render();
  expect(container.textContent).toContain("500 of 500 terms saved");
  expect(container.textContent).toContain("The dictionary is full at 500 terms.");
  expect(buttonNamed("Add term").disabled).toBe(true);
});

it("blocks a repeated term in the same scope before saving and keeps the draft", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [{ term: "Bycoda", aliases: [] }],
  });
  await render();
  await click("Add term");
  await input("Preferred spelling", " bycoda ");
  expect(container.textContent).toContain("This term is already saved in this scope.");
  expect(buttonNamed("Save term").disabled).toBe(true);
  await input("Preferred spelling", "Bycoda Workspace");
  expect(container.textContent).not.toContain("This term is already saved in this scope.");
  await click("Save term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "Bycoda", aliases: [] },
    { term: "Bycoda Workspace", aliases: [] },
  ]);
});

it("lets an entry keep its own spelling when edited without a duplicate elsewhere", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [
      { term: "Bycoda", aliases: ["by coda"] },
      { term: "FHIR", aliases: [] },
    ],
  });
  await render();
  await click("Edit");
  expect(container.textContent).not.toContain("This term is already saved in this scope.");
  await click("Save term");
  expect(loadVoiceSettings().dictationDictionary).toEqual([
    { term: "Bycoda", aliases: ["by coda"] },
    { term: "FHIR", aliases: [] },
  ]);
});

it("keeps legacy duplicates in different scopes as separate rows", async () => {
  const projectId = projectKey("G:/Projects/clinical-speech-research");
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: [
      { term: "Bycoda", aliases: [] },
      { term: "Bycoda", aliases: [], projectId },
    ],
  });
  await render();
  expect(container.querySelectorAll("[data-collection-key]")).toHaveLength(2);
  expect(
    [...container.querySelectorAll("button")].filter((button) => button.textContent === "Edit"),
  ).toHaveLength(2);
});

it("mounts a bounded window of a long dictionary instead of every row", async () => {
  // happy-dom has no layout: give the virtualized list a viewport and row heights.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationDictionary: Array.from({ length: 200 }, (_, index) => ({
      term: `Term_${index + 1}`,
      aliases: [],
    })),
  });
  await render();
  const mounted = container.querySelectorAll("[data-collection-key]").length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(200);
});
