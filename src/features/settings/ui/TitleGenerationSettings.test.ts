// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TitleGenerationSettings } from "./TitleGenerationSettings";
import { TITLE_CHOICE_KEY } from "../../sessions/model/titlePreferences";

vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelPicker: () => createElement("span", null, "Model picker"),
}));
vi.mock("../../../integrations/harness", () => ({ canRunHarnessTextPrompt: () => true }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TitleGenerationSettings)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.textContent === label,
  )!;
}

it("starts automatic and allows an explicit model selection, then restores automatic", async () => {
  expect(container.textContent).toContain("Haiku, Terra or Flash");
  expect(container.textContent).not.toContain("Model picker");
  await act(async () => button("Choose model").click());
  expect(JSON.parse(localStorage.getItem(TITLE_CHOICE_KEY)!)).toHaveProperty("model");
  expect(container.textContent).toContain("Model picker");
  await act(async () => button("Automatic").click());
  expect(localStorage.getItem(TITLE_CHOICE_KEY)).toBe("null");
  expect(container.textContent).not.toContain("Model picker");
});

it("keeps failed preference recoverable with Retry", async () => {
  const writer = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await act(async () => button("Choose model").click());
  expect(container.textContent).toContain("Could not save changes");
  expect(container.textContent).not.toContain("Model picker");
  writer.mockRestore();
  await act(async () => button("Retry").click());
  expect(container.textContent).toContain("Model picker");
  expect(container.textContent).not.toContain("Could not save changes");
});
