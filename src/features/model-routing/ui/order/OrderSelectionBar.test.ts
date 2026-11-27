// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { OrderSelectionBar } from "./OrderSelectionBar";

vi.mock("../../../sessions/public/models", () => ({
  resolveModel: (_harness: string, id: string) => ({ id }),
  modelEffortSetting: (model: { id: string }) =>
    model.id === "plain"
      ? undefined
      : { id: "effort", options: [{ value: "low" }, { value: "high", label: "High" }] },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string, model: string): ModelRoutingEntry => ({
  id,
  harness: "codex",
  model,
  modelSettings: {},
  unknownLimit: "use",
});
const group: ModelRoutingPool = { id: "p1", name: "Main", entryIds: [] };

let root: Root;
let container: HTMLDivElement;
const render = (props: { selected: ModelRoutingEntry[]; pools: ModelRoutingPool[] }) =>
  act(() =>
    root.render(
      createElement(OrderSelectionBar, {
        ...props,
        onRemove: vi.fn(),
        onEffort: vi.fn(),
        onAddToGroup: vi.fn(),
        onClear: vi.fn(),
      }),
    ),
  );
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  )!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
});

it("explains why bulk Set effort and Add to group are disabled", async () => {
  await render({ selected: [entry("a", "plain")], pools: [] });

  expect(button("Set effort").getAttribute("aria-disabled")).toBe("true");
  expect(button("Set effort").getAttribute("aria-description")).toBe(
    "The selected models have no effort setting.",
  );
  expect(button("Add to group").getAttribute("aria-description")).toBe("Create a group first.");
});

it("keeps both bulk actions enabled, without a reason, when they apply", async () => {
  await render({ selected: [entry("a", "m")], pools: [group] });

  expect(button("Set effort").getAttribute("aria-disabled")).toBeNull();
  expect(button("Set effort").getAttribute("aria-description")).toBeNull();
  expect(button("Add to group").getAttribute("aria-disabled")).toBeNull();
  expect(button("Add to group").getAttribute("aria-description")).toBeNull();
});
