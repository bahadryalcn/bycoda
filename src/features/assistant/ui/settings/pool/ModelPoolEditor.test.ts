// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantModelPoolResponse } from "../../../../../shared/model/assistantModelPool";

vi.mock("../../../../sessions/ui/modelSource", () => ({
  useModelSource: () => ({
    resolve: (harness: string, id: string) => ({ harness, id: id || "default-model" }),
  }),
}));
vi.mock("../../../../sessions/model/models", () => ({
  resolveModel: (harness: string, id: string) => ({ harness, id }),
  defaultModelSettings: () => ({ effort: "medium" }),
}));
vi.mock("../../../../sessions/ui/ModelPicker", () => ({
  ModelPicker: (props: any) =>
    createElement(
      "button",
      { type: "button", onClick: () => props.onSettingsChange({ effort: "high" }) },
      `${props.model} ${props.values.effort}`,
    ),
}));
vi.mock("../../../../../shared/ui/Select", () => ({
  Select: (props: any) =>
    createElement(
      "select",
      {
        "aria-label": props.label,
        value: props.value,
        onChange: (event: any) => props.onValueChange(event.currentTarget.value),
      },
      props.options.map((option: any) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));
vi.mock("../../../../providers/model/providerAccounts", () => ({
  DEFAULT_PROVIDER_ACCOUNT_ID: "default",
  supportsProviderAccounts: () => true,
  defaultProviderAccountId: () => "default",
  providerAccounts: () => [{ id: "default", label: "Default account", provider: "codex" }],
  subscribeProviderAccounts: () => () => undefined,
}));
vi.mock("../../../../providers/model/rateLimitsCache", () => ({
  loadRateLimits: async () => undefined,
  useCachedRateLimits: () => ({
    status: "ok",
    session: { usedPercent: 20, windowMinutes: 300, resetsAt: null },
    weekly: { usedPercent: 70, windowMinutes: 10080, resetsAt: null },
    monthly: null,
  }),
  getAllRateLimits: () => ({}),
  subscribeRateLimits: () => () => undefined,
}));
import { ModelPoolEditor } from "./ModelPoolEditor";

const row = (id: string, roles: string[], model = id) => ({
  id,
  harness: "codex" as const,
  model,
  modelSettings: { effort: "low" },
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
  roles: roles as any,
  unknownLimit: "use" as const,
});
const initial = (derived = true): AssistantModelPoolResponse => ({
  rows: [row("a", ["worker", "reply"]), row("b", ["planning"]), row("c", ["chief"])],
  version: 4,
  updatedAt: 1,
  derived,
});

let root: Root | undefined, container: HTMLDivElement;
async function setup(request: (input: any) => Promise<any>, pool = initial()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: any[] = [];
  const wrapped = vi.fn(async (input: any) => {
    calls.push(input);
    if (input.op === "models.pool.get") return { modelPool: pool };
    return request(input);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ModelPoolEditor, { request: wrapped as any })));
  return calls;
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent === label,
  )!;
async function click(label: string) {
  const target = button(label);
  expect(target, label).toBeTruthy();
  await act(async () => target.click());
}
const order = () =>
  [...container.querySelectorAll("fieldset")].map(
    (fieldset) => fieldset.querySelector("button:not([aria-label])")?.textContent?.split(" ")[0],
  );

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it("renders a derived pool as the starting list with quota and the order rule", async () => {
  await setup(async () => ({}));
  expect(order()).toEqual(["a", "b", "c"]);
  expect(container.textContent).toContain("Running work never switches model");
  expect(container.textContent).toContain("Showing your current models");
  expect(container.textContent).toContain("30% left");
  expect(button("Save models").disabled).toBe(true);
});

it("reorders with the buttons and saves rows in order with the expected version", async () => {
  const calls = await setup(async (input) => ({
    modelPool: { rows: input.rows, version: 5, updatedAt: 2, derived: false },
  }));
  expect(button("Move model 1 up").disabled).toBe(true);
  await click("Move model 2 up");
  expect(order()).toEqual(["b", "a", "c"]);
  await click("Save models");
  const save = calls.find((call) => call.op === "models.pool.set");
  expect(save.expectedVersion).toBe(4);
  expect(save.rows.map((saved: any) => saved.id)).toEqual(["b", "a", "c"]);
  expect(container.textContent).toContain("Models saved");
  expect(button("Save models").disabled).toBe(true);
});

it("shows the version conflict and keeps the draft", async () => {
  await setup(async () => {
    throw new Error("Model pool changed; reload before saving.");
  });
  await click("Move model 3 up");
  await click("Save models");
  expect(container.textContent).toContain("Settings changed elsewhere. Reload to continue.");
  expect(order()).toEqual(["a", "c", "b"]);
  expect(button("Reload")).toBeTruthy();
});

it("blocks a pool without a Worker row and names the fallback for uncovered roles", async () => {
  const calls = await setup(async () => ({}), {
    ...initial(false),
    rows: [row("a", ["worker"])],
  });
  expect(container.textContent).toContain("No model is set for Planning, Chief, Reply");
  await click("Add model");
  expect(order()).toHaveLength(2);
  await click("Remove model 1");
  expect(container.textContent).toContain("Keep at least one Worker model.");
  await click("Save models");
  expect(calls.some((call) => call.op === "models.pool.set")).toBe(false);
});

it("edits the row's effort and threshold", async () => {
  const calls = await setup(async (input) => ({
    modelPool: { rows: input.rows, version: 5, updatedAt: 2, derived: false },
  }));
  await click("a low");
  const field = container.querySelector<HTMLInputElement>("input[type=number]")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, "15");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save models");
  const saved = calls.find((call) => call.op === "models.pool.set").rows[0];
  expect(saved.modelSettings.effort).toBe("high");
  expect(saved.minRemainingPercent).toBe(15);
});
