// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ status: null as unknown, updates: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) =>
    command === "local_host_bundle_update" ? host.updates() : host.status,
}));

import { LocalHostVersionPrompt } from "./LocalHostVersionPrompt";

const BUSY = "Could not check whether the host is busy.";
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  host.updates.mockReset();
});

async function render(onUpdateApp?: () => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(LocalHostVersionPrompt, { onUpdateApp })));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
}
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));

it("asks to update a Host whose version differs and installs it on confirmation", async () => {
  host.status = { state: "deferred", message: BUSY, installed: "0.7.7", bundled: "0.7.8" };
  host.updates.mockResolvedValue({ state: "upgraded", installed: "0.7.8", bundled: "0.7.8" });
  await render();
  expect(document.body.textContent).toContain("0.7.7");
  expect(document.body.textContent).toContain("Running sessions and shells");
  expect(host.updates).not.toHaveBeenCalled();
  host.status = { state: "upgraded", installed: "0.7.8", bundled: "0.7.8" };
  await act(async () => button("Stop and update")?.click());
  expect(host.updates).toHaveBeenCalledTimes(1);
  expect(button("Stop and update")).toBeUndefined();
});

it("keeps the prompt open with the reason when the update fails", async () => {
  host.status = { state: "deferred", message: BUSY, installed: "0.7.7", bundled: "0.7.8" };
  host.updates.mockResolvedValue({ state: "failed", message: "Disk full" });
  await render();
  await act(async () => button("Stop and update")?.click());
  expect(document.body.textContent).toContain("Disk full");
  expect(button("Stop and update")).toBeDefined();
});

it("does not update when postponed and stays away afterwards", async () => {
  host.status = { state: "deferred", message: BUSY, installed: "0.7.7", bundled: "0.7.8" };
  await render();
  await act(async () => button("Not now")?.click());
  expect(host.updates).not.toHaveBeenCalled();
  expect(button("Stop and update")).toBeUndefined();
});

it("stays silent for matching versions or while another installer runs", async () => {
  for (const status of [
    { state: "current", installed: "0.7.8", bundled: "0.7.8" },
    { state: "deferred", message: BUSY, installed: "0.7.8", bundled: "0.7.8" },
    {
      state: "deferred",
      message: "Another host update is being installed.",
      installed: "0.7.7",
      bundled: "0.7.8",
    },
  ]) {
    host.status = status;
    await render();
    expect(button("Stop and update")).toBeUndefined();
    cleanup?.();
    cleanup = undefined;
  }
});

it("asks to update the app when this computer's Host is newer than the bundled one", async () => {
  host.status = { state: "current", installed: "0.7.10", bundled: "0.7.9" };
  const updateApp = vi.fn(async () => {});
  await render(updateApp);
  expect(document.body.textContent).toContain("newer than the one this app includes");
  expect(button("Stop and update")).toBeUndefined();
  await act(async () => button("Update app")?.click());
  expect(updateApp).toHaveBeenCalledTimes(1);
  expect(host.updates).not.toHaveBeenCalled();
});

it("does not prompt for a newer Host without an app update flow", async () => {
  host.status = { state: "current", installed: "0.7.10", bundled: "0.7.9" };
  await render();
  expect(button("Update app")).toBeUndefined();
});
