// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../model/protocol";
import { SessionMachinePicker } from "./SessionMachinePicker";

const { inventory, connection, disabled } = vi.hoisted(() => ({
  inventory: vi.fn(),
  connection: vi.fn(),
  disabled: vi.fn(),
}));

vi.mock("../model/connections", () => ({ useRemoteMachines: inventory }));
vi.mock("../model/remoteHealth", () => ({
  readRemoteConnection: connection,
  subscribeChanges: () => () => undefined,
}));
vi.mock("../model/machineEnabled", () => ({
  isMachineEnabled: (id: string) => !disabled(id),
  subscribeDisabledMachines: () => () => undefined,
}));

const office: RemoteMachine = {
  id: "office",
  name: "Build box",
  endpoint: "http://office",
  environmentId: "office-env",
};
const home: RemoteMachine = {
  ...office,
  id: "home",
  endpoint: "http://home",
  environmentId: "home-env",
};
const local: RemoteMachine = {
  ...office,
  id: "local",
  name: "Laptop",
  endpoint: "http://127.0.0.1:3774",
  environmentId: "local-env",
  localHost: true,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  inventory.mockReturnValue({ machines: [local, office, home], loaded: true });
  connection.mockReturnValue({ status: "connected" });
  disabled.mockReturnValue(false);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function render(props: Parameters<typeof SessionMachinePicker>[0]) {
  await act(async () => root.render(createElement(SessionMachinePicker, props)));
}

it("deduplicates the local machine and separates identically named remote machines", async () => {
  const onSelect = vi.fn();
  const triggerRef = createRef<HTMLButtonElement>();
  await render({ environmentId: local.environmentId, onSelect, triggerRef });
  expect(triggerRef.current?.textContent).toBe("This computer");
  await act(async () => triggerRef.current?.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(options.map((option) => option.textContent)).toEqual([
    "This computer",
    "Build box (http://office)",
    "Build box (http://home)",
  ]);
  await act(async () => options[2]?.click());
  expect(onSelect).toHaveBeenCalledWith(home.environmentId);
});

it("keeps a disconnected selection visible and exposes usable alternatives", async () => {
  connection.mockImplementation((id: string) => ({
    status: id === office.environmentId ? "unreachable" : "connected",
  }));
  const onSelect = vi.fn();
  const triggerRef = createRef<HTMLButtonElement>();
  await render({ environmentId: office.environmentId, onSelect, triggerRef });
  expect(triggerRef.current?.textContent).toBe("Build box (http://office) · Offline");
  await act(async () => triggerRef.current?.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(options[1]?.getAttribute("aria-checked")).toBe("true");
  expect(options[1]?.disabled).toBe(true);
  await act(async () => options[0]?.click());
  expect(onSelect).toHaveBeenCalledWith(undefined);
});

it("renders an established machine as a read-only label", async () => {
  await render({ environmentId: home.environmentId, disabled: true, onSelect: vi.fn() });
  expect(container.textContent).toContain("Build box (http://home)");
  expect(container.textContent).not.toContain("Connected");
  expect(container.querySelector("button")).toBeNull();
});
