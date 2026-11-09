// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../model/protocol";
import { MachineRoutesLine } from "./MachineRoutesLine";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const machine = {
  id: "m1",
  name: "Mac",
  endpoint: "ssh://me@100.97.82.0",
  environmentId: "env",
  ssh: { target: "me@100.97.82.0", port: null, remotePort: 3776, alternate: "me@192.168.2.145" },
} as unknown as RemoteMachine;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async () => {
  await act(async () => root.render(createElement(MachineRoutesLine, { machine })));
};

const ROUTES = {
  routes: [
    { address: "100.97.82.0", kind: "tailscale", source: "saved", enabled: true },
    { address: "192.168.2.145", kind: "lan", source: "other", enabled: true },
    { address: "10.0.0.4", kind: "lan", source: "reported", enabled: true },
    { address: "192.168.95.2", kind: "lan", source: "reported", enabled: false },
  ],
  prefer: "saved",
  active: "192.168.2.145",
};
const CHECKS = [
  { address: "100.97.82.0", reachable: false },
  { address: "192.168.2.145", reachable: true },
  { address: "10.0.0.4", reachable: null },
  { address: "192.168.95.2", reachable: false },
];
const answer = (routes: unknown) => (command: string) =>
  Promise.resolve(command === "remote_machine_route_check" ? CHECKS : routes);
const row = (address: string) =>
  container.querySelector(`[data-route="${address}"]`)?.textContent ?? "";

it("lists every address with its kind, source, whether it responds and the one in use", async () => {
  invoke.mockImplementation(answer(ROUTES));
  await render();
  expect(invoke).toHaveBeenCalledWith("remote_machine_routes", {
    machineId: "m1",
    target: machine.ssh,
  });
  expect(invoke).toHaveBeenCalledWith("remote_machine_route_check", { target: machine.ssh });
  expect(row("100.97.82.0")).toContain("Tailscale · SSH address");
  expect(row("100.97.82.0")).toContain("No response");
  expect(row("192.168.2.145")).toContain("Home network · Other address");
  expect(row("192.168.2.145")).toContain("In use");
  expect(row("192.168.2.145")).toContain("Responds");
  expect(row("10.0.0.4")).toContain("Found by the host");
  expect(row("192.168.95.2")).toContain("Off");
  // Only addresses the host found can be turned off; the owner edits the other two.
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  expect(container.querySelector('[data-route="192.168.2.145"] [role="switch"]')).toBeNull();
  expect(
    container
      .querySelector('[data-route="192.168.95.2"] [role="switch"]')
      ?.getAttribute("aria-checked"),
  ).toBe("false");
});

it("saves a turned-off address without moving the rows", async () => {
  invoke.mockImplementation(answer(ROUTES));
  await render();
  const order = () =>
    [...container.querySelectorAll("[data-route]")].map((item) => item.getAttribute("data-route"));
  const before = order();
  const after = {
    ...ROUTES,
    routes: ROUTES.routes.map((route) =>
      route.address === "10.0.0.4" ? { ...route, enabled: false } : route,
    ),
  };
  invoke.mockImplementation(answer(after));
  await act(async () =>
    (container.querySelector('[data-route="10.0.0.4"] [role="switch"]') as HTMLElement).click(),
  );
  expect(invoke).toHaveBeenCalledWith("remote_machine_route_settings", {
    machineId: "m1",
    target: machine.ssh,
    disabled: ["192.168.95.2", "10.0.0.4"],
    prefer: "saved",
  });
  expect(order()).toEqual(before);
});

it("shows only the saved other address when the desktop cannot answer", async () => {
  invoke.mockRejectedValue(new Error("no desktop"));
  await render();
  expect(container.textContent).toBe("Other address · me@192.168.2.145");
});
