// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({
  value: null as unknown,
  machines: [] as unknown[],
  descriptor: { capabilities: [] as string[] },
}));
vi.mock("../model/connections", () => ({ remoteRequest: async () => status.descriptor }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) =>
    command === "local_host_bundle_status"
      ? status.value
      : command === "remote_machines"
        ? status.machines
        : null,
}));

import { LocalHostUpdateNotice } from "./LocalHostUpdateNotice";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  status.machines = [];
});

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(LocalHostUpdateNotice)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
  return container;
}

it("explains a deferred host update with both versions and the reason", async () => {
  status.value = {
    state: "deferred",
    message: "The host update waits until running sessions finish.",
    bundled: "0.5.54",
    installed: "0.5.53",
  };
  const text = (await render()).textContent ?? "";
  expect(text).toContain("will update soon");
  expect(text).toContain("0.5.53");
  expect(text).toContain("0.5.54");
  expect(text).toContain("running sessions finish");
});

it("stays silent when the host is current or was just updated", async () => {
  for (const state of ["current", "installed", "upgraded", "unavailable"]) {
    status.value = { state, bundled: "0.5.54", installed: "0.5.54" };
    expect((await render()).textContent).toBe("");
    cleanup?.();
    cleanup = undefined;
  }
});
it("reuses the existing notice for an incompatible paired Host without starting one", async () => {
  status.value = { state: "current" };
  status.machines = [{ id: "paired-local", localHost: true }];
  status.descriptor = { capabilities: [] };
  expect((await render()).textContent).toContain("does not support managed workspace");
});
