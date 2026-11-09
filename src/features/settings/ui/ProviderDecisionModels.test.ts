// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderDecisionModels } from "./ProviderDecisionModels";

const state = vi.hoisted(() => ({ machines: [] as { id: string; local?: boolean }[] }));

vi.mock("../../connections/public/connections", () => ({
  useRemoteMachines: () => ({
    machines: state.machines,
    loaded: true,
    loading: false,
    refresh: () => {},
  }),
}));
vi.mock("../../connections/public/localSync", () => ({
  isLocalSyncMachine: (machine: { local?: boolean }) => machine.local === true,
}));
vi.mock("../../decision-models", () => ({
  decisionModelsClient: vi.fn((machineId: string) => ({ machineId })),
  DecisionModelsSettings: (props: { client: { machineId: string } }) =>
    createElement("div", { "data-decision-settings": props.client.machineId }),
}));

let element: HTMLDivElement, root: Root;

function rendered(): string | null {
  return (
    element.querySelector("[data-decision-settings]")?.getAttribute("data-decision-settings") ??
    null
  );
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  state.machines = [];
});

it("renders nothing when no Host is listed", () => {
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(rendered()).toBeNull();
});

it("runs the section on this computer's Host", () => {
  state.machines = [
    { id: "remote-1", local: false },
    { id: "local-1", local: true },
  ];
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(rendered()).toBe("local-1");
});

it("falls back to the first Host listed", () => {
  state.machines = [{ id: "remote-1" }];
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(rendered()).toBe("remote-1");
});
