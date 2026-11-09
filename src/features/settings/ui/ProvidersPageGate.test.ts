// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ probed: false, version: 0, listeners: new Set<() => void>() }));
const probe = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => state.version,
  hasProbedHarnessAvailability: () => state.probed,
  probeHarnessAvailability: probe,
  subscribeHarnessAvailability: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));
vi.mock("./ProviderSettings", () => ({
  ProvidersPage: () => createElement("div", { "data-testid": "providers" }),
}));

import { ProvidersPageGate } from "./ProvidersPageGate";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.probed = false;
  probe.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("shows the shared placeholder and probes until the first probe has finished", async () => {
  await act(async () => root.render(createElement(ProvidersPageGate)));
  expect(node.querySelector("[data-settings-page-loading]")).not.toBeNull();
  expect(node.querySelector('[data-testid="providers"]')).toBeNull();
  expect(probe).toHaveBeenCalledTimes(1);
  await act(async () => {
    state.probed = true;
    state.version += 1;
    for (const listener of state.listeners) listener();
  });
  expect(node.querySelector("[data-settings-page-loading]")).toBeNull();
  expect(node.querySelector('[data-testid="providers"]')).not.toBeNull();
});

it("renders the page at once when the app already probed", async () => {
  state.probed = true;
  await act(async () => root.render(createElement(ProvidersPageGate)));
  expect(node.querySelector('[data-testid="providers"]')).not.toBeNull();
  expect(probe).not.toHaveBeenCalled();
});
