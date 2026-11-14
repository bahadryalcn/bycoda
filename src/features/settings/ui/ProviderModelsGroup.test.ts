// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderModelsGroup } from "./ProviderModelsGroup";

const state = vi.hoisted(() => ({
  models: Array.from({ length: 6 }, (_, index) => ({
    id: `model-${index}`,
    name: `Model ${index}`,
    harness: "codex",
  })),
  enabled: new Set(["model-0"]),
  save: vi.fn(),
}));

vi.mock("../../sessions/public/models", () => ({
  catalogModelsFor: () => state.models,
  defaultModelId: () => "model-0",
  isModelEnabled: (id: string) => state.enabled.has(id),
  saveModelEnabled: state.save,
}));
vi.mock("../../sessions/public/ModelLabel", () => ({
  ModelLabel: ({ name }: { name: string }) => name,
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: () => true,
}));
vi.mock("../../providers/public/CatalogReceiptStatus", () => ({
  CatalogReceiptStatus: () => null,
  CatalogRefreshButton: () => null,
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.models = Array.from({ length: 6 }, (_, index) => ({
    id: `model-${index}`,
    name: `Model ${index}`,
    harness: "codex",
  }));
  state.enabled = new Set(["model-0"]);
  state.save.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () => root.render(createElement(ProviderModelsGroup, { harness: "codex" })));

it("keeps an active search editable after a refreshed catalog shrinks", async () => {
  await render();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Model 5",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state.models = state.models.slice(0, 2);
  await render();
  expect(container.textContent).toContain("No matching models");
  expect(container.querySelector("input")?.value).toBe("Model 5");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Model 0");
  expect(container.textContent).not.toContain("No matching models");
});

it("disables bulk actions that would leave the same enabled models", async () => {
  await render();
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label)!;
  expect(button("Only default").getAttribute("aria-disabled")).toBe("true");
  state.enabled = new Set(state.models.map((model) => model.id));
  await render();
  expect(button("Enable all").getAttribute("aria-disabled")).toBe("true");
});
