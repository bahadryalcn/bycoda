// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({
  value: null as unknown,
  machines: [] as unknown[],
  descriptor: { capabilities: [] as string[] },
  requests: vi.fn(),
}));
vi.mock("../model/connections", () => ({
  remoteRequest: async () => {
    status.requests();
    return status.descriptor;
  },
}));
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
  expect(text).toContain("A host update is waiting.");
  expect(text).toContain("0.5.53");
  expect(text).toContain("0.5.54");
  expect(text).toContain("running sessions finish");
});

const BUSY = "Could not check whether the host is busy.";

it("renders nothing for equal versions once the serving host is verified", async () => {
  status.value = { state: "deferred", message: BUSY, bundled: "0.7.7", installed: "0.7.7" };
  status.machines = [{ id: "local", localHost: true }];
  status.descriptor = { capabilities: ["workspaces.managed.v1", "workspaces.policy.v1"] };
  expect((await render()).textContent).toBe("");
});

it("says the host could not be verified for equal versions without a local machine", async () => {
  status.value = { state: "deferred", message: BUSY, bundled: "0.7.7", installed: "0.7.7" };
  const text = (await render()).textContent ?? "";
  expect(text).toContain("could not be verified");
  expect(text).toContain("It continues when the host can be restarted safely.");
  expect(text).not.toContain("will update soon");
});

it("reports a failed update", async () => {
  status.value = { state: "failed", message: "Disk full", bundled: "2", installed: "1" };
  const text = (await render()).textContent ?? "";
  expect(text).toContain("could not be updated");
  expect(text).toContain("Disk full");
  expect(text).toContain("1");
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

it("refreshes compatibility on focus without polling the descriptor", async () => {
  vi.useFakeTimers();
  try {
    status.value = { state: "current", installed: "1", bundled: "1" };
    status.machines = [{ id: "local", localHost: true }];
    await render();
    status.requests.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(status.requests).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(status.requests).toHaveBeenCalledTimes(1);
  } finally {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
  }
});
