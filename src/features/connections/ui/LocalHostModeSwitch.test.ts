// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  status: null as unknown,
  readFails: false,
  setMode: vi.fn(async (_args: unknown) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: unknown) => {
    if (command === "local_host_mode") {
      if (native.readFails) throw new Error("Host lifecycle modes require the installed desktop.");
      return native.status;
    }
    if (command === "local_host_set_mode") return native.setMode(args);
    return null;
  },
}));

import { LocalHostModeSwitch } from "./LocalHostModeSwitch";

const base = { registered: false, mismatch: false, switchSupported: true };
let cleanup: (() => void) | undefined;
beforeEach(() => {
  native.readFails = false;
  native.setMode.mockReset();
});
afterEach(() => cleanup?.());

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(LocalHostModeSwitch)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
  return container;
}

const toggle = () => document.querySelector<HTMLButtonElement>('button[role="switch"]');
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));

it("is off while the Host follows the app", async () => {
  native.status = { ...base, mode: "app" };
  await render();
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  expect(document.body.textContent).toContain("Keep this computer reachable when bycoda is closed");
  // The explanation hides behind the info button; there is no inline paragraph.
  expect(document.body.textContent).not.toContain("starts and stops with bycoda");
});

it("is on while the login service keeps the Host running, and switching off asks for app mode", async () => {
  native.status = { ...base, mode: "service", registered: true };
  native.setMode.mockResolvedValue({ ...base, mode: "app" });
  await render();
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle()?.click());
  expect(native.setMode).toHaveBeenCalledWith({ mode: "app", force: false });
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
});

it("shows a change waiting for running sessions and applies it now only after confirming", async () => {
  native.status = { ...base, mode: "app", pendingMode: "service" };
  native.setMode.mockResolvedValue({ ...base, mode: "service", registered: true });
  await render();
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).toContain("Turning on when running sessions finish");
  await act(async () => button("Switch now")?.click());
  expect(document.body.textContent).toContain("Running sessions and shells");
  expect(native.setMode).not.toHaveBeenCalled();
  await act(async () => button("Cancel")?.click());
  expect(native.setMode).not.toHaveBeenCalled();
  await act(async () => button("Switch now")?.click());
  await act(async () => button("Stop and switch")?.click());
  expect(native.setMode).toHaveBeenCalledWith({ mode: "service", force: true });
  expect(document.body.textContent).not.toContain("when running sessions finish");
});

it("shows the native failure compactly and keeps the previous mode", async () => {
  native.status = { ...base, mode: "service", registered: true };
  native.setMode.mockRejectedValue("A Host outside this desktop still owns the data directory.");
  await render();
  await act(async () => toggle()?.click());
  expect(document.body.textContent).toContain("still owns the data directory");
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
});

it("reports the last error and a registration mismatch with the repair text", async () => {
  native.status = { ...base, mode: "app", lastError: "Task Scheduler refused the change." };
  await render();
  expect(document.body.textContent).toContain("Task Scheduler refused the change.");
  cleanup?.();
  native.status = { ...base, mode: "service", mismatch: true };
  await render();
  expect(document.body.textContent).toContain("Switch it again to repair");
});

it("disables the switch when the installed Host cannot switch", async () => {
  native.status = { ...base, mode: "service", registered: true, switchSupported: false };
  await render();
  expect(toggle()?.disabled).toBe(true);
});

it("renders nothing when the desktop has no switchable Host", async () => {
  native.readFails = true;
  await render();
  expect(toggle()).toBeNull();
});
