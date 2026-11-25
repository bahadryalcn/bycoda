// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentModel } from "../../../shared/model/agentModel";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { ProviderModelsGroup } from "./ProviderModelsGroup";

const state = vi.hoisted(() => ({
  models: [] as AgentModel[],
  enabled: new Set(["model-0"]),
  save: vi.fn(),
  refresh: vi.fn(async () => undefined),
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
vi.mock("../../providers/public/catalogReceipts", () => ({
  refreshProviderCatalog: state.refresh,
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
  state.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (harness: HarnessId = "codex") =>
  act(async () => root.render(createElement(ProviderModelsGroup, { harness })));
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label)!;

it("loads OpenCode on entry and finds free models without Free in their name", async () => {
  state.models = [
    { id: "model-0", name: "Big Pickle", harness: "opencode", free: true },
    { id: "model-1", name: "Unverified Free", harness: "opencode" },
  ];
  await render("opencode");
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith("opencode");
  expect(container.textContent).toContain("Big PickleFree");
  expect(container.querySelector('[aria-label="Default"]')).not.toBeNull();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "free");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Big Pickle");
  expect(container.textContent).not.toContain("Unverified Free");
  expect(state.save).not.toHaveBeenCalled();
});

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

it("filters with the Free button and enables every free model even when search narrows the list", async () => {
  state.models = [
    { id: "model-0", name: "Paid", harness: "opencode" },
    { id: "model-1", name: "Big Pickle", harness: "opencode", free: true },
    { id: "model-2", name: "Beam", harness: "opencode", free: true },
    { id: "model-3", name: "Other paid", harness: "opencode" },
  ];
  await render("opencode");
  expect(button("Free").getAttribute("aria-pressed")).toBe("false");
  await act(async () => button("Free").click());
  expect(button("Free").getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).not.toContain("Other paid");
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Beam");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).not.toContain("Big Pickle");
  expect(state.save).not.toHaveBeenCalled();
  await act(async () => button("Enable all free").click());
  expect(state.save.mock.calls).toEqual([
    ["model-1", true],
    ["model-2", true],
  ]);
  state.enabled.add("model-1").add("model-2");
  await render("opencode");
  expect(button("Enable all free").getAttribute("aria-disabled")).toBe("true");
  await act(async () => button("Free").click());
  expect(button("Free").getAttribute("aria-pressed")).toBe("false");
  expect(input.value).toBe("Beam");
  expect(button("Enable all")).toBeDefined();
});

it("disables bulk actions that would leave the same enabled models", async () => {
  await render();
  expect(button("Only default").getAttribute("aria-disabled")).toBe("true");
  state.enabled = new Set(state.models.map((model) => model.id));
  await render();
  expect(button("Enable all").getAttribute("aria-disabled")).toBe("true");
});
