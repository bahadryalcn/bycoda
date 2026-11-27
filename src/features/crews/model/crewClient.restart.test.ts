// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
import { CrewsLoadState } from "../ui/page/CrewsLoadState";
import { useProjectCrews } from "./crewClient";
import { HOST_CREWS } from "./crew";

const transport = vi.hoisted(() => ({
  invoke: vi.fn(),
  capabilities: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("../../automations/public/hostMachines", () => ({
  backgroundMachineFor: (machines: unknown[]) => machines[0],
  hostProjectFor: async () => ({ id: "project" }),
  machineCapabilities: transport.capabilities,
}));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: transport.request }));
vi.mock("../../connections/model/useRemoteModelCatalog", () => ({
  useRemoteModelCatalog: () => ({ error: "", stale: false, refresh: vi.fn() }),
}));

const cwd = "C:/project";
const crewName = "Crew list loaded";
const advance = (time: number) => act(async () => void (await vi.advanceTimersByTimeAsync(time)));
const Harness = withQueryClient(function CrewPage() {
  return createElement(CrewsLoadState, {
    state: useProjectCrews(cwd),
    noProject: false,
    children: () => createElement("span", null, crewName),
  });
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  transport.invoke.mockResolvedValue([
    { id: "local", environmentId: "local-env", localHost: true },
  ]);
  transport.capabilities.mockReset();
  transport.request.mockResolvedValue({ definitions: [], runs: [], agents: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows only pending during a five-second declared Host restart and reloads without a click", async () => {
  transport.capabilities.mockRejectedValue(
    Object.assign(new Error("Host is stopping."), { code: "HOST_STOPPING" }),
  );
  await act(async () => root.render(createElement(Harness)));
  await advance(2_000);
  await advance(3_000);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Retry");
  expect(container.textContent).not.toContain(crewName);
  expect(container.querySelector('[role="alert"]')).toBeNull();

  transport.capabilities.mockResolvedValue([HOST_CREWS]);
  await advance(1_000);
  expect(container.textContent).toContain(crewName);
  expect(container.textContent).not.toContain("Retry");
});

it("shows a sustained connection failure after grace and removes it on recovery", async () => {
  transport.capabilities.mockRejectedValue(
    Object.assign(new Error("Host unavailable"), { code: "RPC_WS_UNAVAILABLE" }),
  );
  await act(async () => root.render(createElement(Harness)));
  await advance(2_000);
  await advance(999);
  expect(container.textContent).not.toContain("Retry");
  await advance(1);
  expect(container.textContent).toContain("Waiting for the connection");
  await advance(3_000);
  await advance(4_001);
  expect(container.textContent).toContain("Retry");

  transport.capabilities.mockResolvedValue([HOST_CREWS]);
  await advance(3_999);
  expect(container.textContent).toContain(crewName);
  expect(container.textContent).not.toContain("Retry");
});

it("shows a denied capability read immediately", async () => {
  transport.capabilities.mockRejectedValue(new Error("Permission denied"));
  await act(async () => root.render(createElement(Harness)));
  expect(container.textContent).toContain("Permission denied");
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
});
