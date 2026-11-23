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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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

it("explains failed route reads and retries without claiming an empty route store", async () => {
  invoke.mockRejectedValue(new Error("Host unavailable"));
  await render();
  expect(container.textContent).toContain("Addresses could not be loaded.");
  invoke.mockImplementation(answer(ROUTES));
  await act(async () =>
    [...container.querySelectorAll("button")].find((item) => item.textContent === "Retry")!.click(),
  );
  expect(row("100.97.82.0")).toContain("Tailscale");
});

it("reports unavailable probes without claiming no response", async () => {
  invoke.mockImplementation((command: string) =>
    command === "remote_machine_route_check"
      ? Promise.reject(new Error("Probe failed"))
      : Promise.resolve(ROUTES),
  );
  await render();
  expect(container.textContent).toContain("Address check unavailable.");
  expect(container.textContent).not.toContain("No response");
});

it("retains last-good routes on failed refresh and disables preference while saving", async () => {
  let finish!: (value: unknown) => void;
  invoke.mockImplementation(answer(ROUTES));
  await render();
  invoke.mockRejectedValue(new Error("Host unavailable"));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((item) => item.textContent === "Check again")!
      .click(),
  );
  expect(row("100.97.82.0")).toContain("Tailscale");
  expect(container.textContent).toContain("Addresses could not be loaded.");
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-route="10.0.0.4"] [role="switch"]')!.click(),
  );
  expect(container.querySelector<HTMLButtonElement>('[aria-label^="Try first"]')!.disabled).toBe(
    true,
  );
  await act(async () => finish(ROUTES));
  expect(container.querySelector<HTMLButtonElement>('[aria-label^="Try first"]')!.disabled).toBe(
    false,
  );
});

it("lists every address with its kind, source, whether it responds and the one in use", async () => {
  invoke.mockImplementation(answer(ROUTES));
  await render();
  expect(invoke).toHaveBeenCalledWith("remote_machine_routes", {
    machineId: "m1",
    target: machine.ssh,
    environmentId: "env",
  });
  expect(invoke).toHaveBeenCalledWith("remote_machine_route_check", { target: machine.ssh });
  expect(row("100.97.82.0")).toContain("Tailscale · SSH address");
  expect(row("100.97.82.0")).toContain("No response");
  expect(row("192.168.2.145")).toContain("Home network · Other address");
  expect(row("192.168.2.145")).toContain("In use");
  // Only problems and the address in use carry a badge; a healthy or switched-off row stays quiet.
  expect(row("192.168.2.145")).not.toContain("Responds");
  expect(row("10.0.0.4")).toContain("Found by the host");
  expect(row("192.168.95.2")).not.toContain("Off");
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

it("shows the shared error message and keeps the confirmed setting when saving fails", async () => {
  invoke.mockImplementation(answer(ROUTES));
  await render();
  invoke.mockRejectedValue(new Error("Could not save the route preference"));
  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-route="10.0.0.4"] [role="switch"]',
  )!;
  await act(async () => toggle.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not save the route preference",
  );
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("shows only the saved other address when the desktop lacks the route command", async () => {
  invoke.mockImplementation((command: string) =>
    command === "remote_machine_routes"
      ? Promise.reject("Command remote_machine_routes not found")
      : Promise.resolve([]),
  );
  await render();
  expect(container.textContent).toBe("Other address: me@192.168.2.145");
  expect(container.textContent).not.toContain("could not be loaded");
  expect(container.querySelector("button")).toBeNull();
});

it("reports a real read failure whose text merely mentions a missing address", async () => {
  invoke.mockRejectedValue(new Error("SSH config entry not found for no desktop box"));
  await render();
  expect(container.textContent).toContain("Addresses could not be loaded.");
  expect(container.textContent).toContain("Retry");
});

it("lists an account Quick Tunnel as a Tunnel route found automatically, and marks it in use", async () => {
  const withTunnel = {
    ...ROUTES,
    routes: [
      ...ROUTES.routes,
      { address: "calm-river.trycloudflare.com", kind: "tunnel", source: "account", enabled: true },
    ],
    active: "calm-river.trycloudflare.com",
  };
  invoke.mockImplementation(answer(withTunnel));
  await render();
  expect(row("calm-river.trycloudflare.com")).toContain("Tunnel · Found automatically");
  expect(row("calm-river.trycloudflare.com")).toContain("In use");
  expect(row("192.168.2.145")).not.toContain("In use");
  // What the account taught cannot be switched off; the host's own addresses keep their switches.
  expect(
    container.querySelector('[data-route="calm-river.trycloudflare.com"] [role="switch"]'),
  ).toBeNull();
});
