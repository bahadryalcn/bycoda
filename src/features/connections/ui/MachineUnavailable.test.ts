// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
const motion = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => motion.enabled,
}));
const reconnect = vi.hoisted(() => ({
  active: false,
  listeners: new Set<() => void>(),
  run: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../model/remoteReconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/remoteReconnect")>()),
  isReconnecting: () => reconnect.active,
  subscribeReconnecting: (listener: () => void) => {
    reconnect.listeners.add(listener);
    return () => reconnect.listeners.delete(listener);
  },
  reconnectRemoteMachine: reconnect.run,
}));

import { adoptRemoteMachineInventory } from "../model/connections";
import { resetMachineAvailability } from "../model/machineAvailability";
import { recordRemoteConnection, resetRemoteHealth } from "../model/remoteHealth";
import { remotePath } from "../model/remoteProjects";
import { machineScene, MachineUnavailable } from "./MachineUnavailable";

const CWD = remotePath("env", "G:/Projects/repo");
const MACHINE = { id: "m1", name: "evpc", endpoint: "http://desk", environmentId: "env" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion.enabled = true;
  reconnect.active = false;
  reconnect.run.mockClear();
  localStorage.clear();
  resetRemoteHealth();
  resetMachineAvailability();
  adoptRemoteMachineInventory([MACHINE]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = (
  props: {
    reason?: "not-added" | "turned-off" | "needs-sign-in" | "pairing-refused" | "offline";
    size?: "page" | "panel";
  } = {},
) => act(async () => root.render(createElement(MachineUnavailable, { cwd: CWD, ...props })));
/** An offline machine shows its notice only after the short grace for brief blips. */
async function mountOffline(size?: "page" | "panel") {
  vi.useFakeTimers();
  await mount({ size });
  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
}
const art = () => container.querySelector("img");
const buttons = () => Array.from(container.querySelectorAll("button"));
const text = () => container.textContent ?? "";

it("maps every reason to its scene", () => {
  expect(machineScene("offline")).toBe("unreachable");
  expect(machineScene("offline", true)).toBe("offline");
  expect(machineScene("not-added")).toBe("connect-computer");
  expect(machineScene("turned-off")).toBe("connect-computer");
  expect(machineScene("needs-sign-in")).toBe("error");
  expect(machineScene("pairing-refused")).toBe("error");
});

it("shows the scene, a title and one status line in a panel, with the reason behind the info button", async () => {
  await mountOffline("panel");

  expect(art()?.dataset.scene).toBe("unreachable");
  expect(text()).toContain("Your computer evpc isn’t reachable right now");
  expect(text()).toContain("Waiting to reconnect");
  expect(text()).not.toContain("Tailscale");
  const info = container.querySelector('button[aria-haspopup="dialog"]');
  expect(info).not.toBeNull();
  await act(async () => info?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(document.body.textContent).toContain("Tailscale");
});

it("uses the still frame while decorative motion is off", async () => {
  await mount({ reason: "not-added" });
  expect(art()?.dataset.scene).toBe("connect-computer");
  const animated = art()?.getAttribute("src");

  motion.enabled = false;
  await mount({ reason: "not-added" });
  expect(art()?.getAttribute("src")).not.toBe(animated);
  expect(art()?.getAttribute("src")).toContain("still");
});

it("shows only a status line while a reconnect runs, then Try now between attempts", async () => {
  reconnect.active = true;
  await mountOffline("panel");
  expect(text()).toContain("Reconnecting…");
  expect(buttons().map((button) => button.textContent)).not.toContain("Try now");

  reconnect.active = false;
  await act(async () => reconnect.listeners.forEach((listener) => listener()));
  const retry = buttons().find((button) => button.textContent === "Try now");
  expect(retry).toBeDefined();
  await act(async () => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(reconnect.run).toHaveBeenCalledWith("env");
});

it("names the machine as the user's computer without its operating system", async () => {
  await mount({ reason: "turned-off" });
  expect(text()).toContain("Your computer evpc isn’t available");
  expect(text()).not.toMatch(/Windows|Mac|Linux/);
});

it("keeps Manage machines on the page for a reason the user must act on", async () => {
  await mount({ reason: "needs-sign-in", size: "page" });
  expect(art()?.dataset.scene).toBe("error");
  expect(buttons().map((button) => button.textContent)).toContain("Manage connections");
});
