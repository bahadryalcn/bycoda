// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderDecisionModels } from "./ProviderDecisionModels";

const state = vi.hoisted(() => ({
  machines: [] as { id: string; name?: string; local?: boolean }[],
  loaded: true,
}));

vi.mock("../../connections/public/connections", () => ({
  useRemoteMachines: () => ({
    machines: state.machines,
    loaded: state.loaded,
    loading: !state.loaded,
    refresh: () => {},
  }),
}));
vi.mock("../../connections/public/localSync", () => ({
  isLocalSyncMachine: (machine: { local?: boolean }) => machine.local === true,
}));
vi.mock("../../decision-models", () => ({
  decisionModelsClient: vi.fn((machineId: string) => ({ machineId })),
  DecisionModelsSettings: (props: {
    client: { machineId: string };
    hostName: string;
    remote: boolean;
  }) =>
    createElement(
      "div",
      { "data-decision-settings": props.client.machineId },
      `${props.hostName}:${props.remote}`,
    ),
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
  state.loaded = true;
});

it("keeps search anchor and shows Host connection guidance when no Host is listed", () => {
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(rendered()).toBeNull();
  expect(element.querySelector('[data-setting-id="decision-models"]')).not.toBeNull();
  expect(element.textContent).toContain("Connect this computer");
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
  state.machines = [{ id: "remote-1", name: "Remote" }];
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(rendered()).toBe("remote-1");
});

it("distinguishes loading from empty and switches to a later local Host", () => {
  state.loaded = false;
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(element.textContent).toContain("Loading");
  expect(element.textContent).not.toContain("Connect this computer");
  state.loaded = true;
  state.machines = [{ id: "remote-1", name: "Remote" }];
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(element.textContent).toContain("Remote:true");
  state.machines.push({ id: "local-1", name: "Local", local: true });
  act(() => root.render(createElement(ProviderDecisionModels)));
  expect(element.textContent).toContain("Local:false");
});
