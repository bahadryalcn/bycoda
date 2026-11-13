// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HelperModelsSettings } from "./HelperModelsSettings";
const links = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../public/modelsSettingsLink", () => ({ openModelsSettings: links.open }));

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
  await act(async () => root.render(createElement(HelperModelsSettings)));
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

it("links all helper models to Work assignments once without a feature picker", async () => {
  expect(container.textContent).toContain("Model set in Work > Assignments.");
  expect(container.textContent).not.toContain("Model picker");
  await act(async () => button("Manage models").click());
  expect(links.open).toHaveBeenCalledWith("roles");
});
