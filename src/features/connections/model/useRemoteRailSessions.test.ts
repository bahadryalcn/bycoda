// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteRailSessions } from "./connections";
import { rememberRemoteProject, remoteProjectKey } from "./remoteProjects";
import { startRailPoller } from "./remoteRailPoller";
import type { HostProject, RemoteMachine } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./remoteRailPoller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remoteRailPoller")>()),
  startRailPoller: vi.fn(),
}));

const machine: RemoteMachine = {
  id: "rail-host",
  name: "Office",
  endpoint: "ssh://owner@office",
  environmentId: "rail-env",
  ssh: { target: "owner@office", remotePort: 7000 },
};
let inventory: RemoteMachine[] = [];
const stopPoller = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  inventory = [machine];
  stopPoller.mockClear();
  vi.mocked(startRailPoller).mockReset().mockReturnValue(stopPoller);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "remote_machines" ? inventory.map((entry) => ({ ...entry })) : undefined,
    );
});
afterEach(() => vi.unstubAllGlobals());

async function refreshInventory() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

it("keeps rail pollers running for an equivalent machine inventory and restarts them for a real route change", async () => {
  rememberRemoteProject("rail-env", { id: "project-1", cwd: "/repo" } as HostProject);
  const project = remoteProjectKey("rail-env", "/repo");
  const root = createRoot(document.createElement("div"));
  function Probe() {
    useRemoteRailSessions([project]);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(startRailPoller).toHaveBeenCalledTimes(1);

    // Window focus re-reads an identical list: a new array, the same machines.
    await refreshInventory();
    expect(startRailPoller).toHaveBeenCalledTimes(1);
    expect(stopPoller).not.toHaveBeenCalled();

    // A rename and an unrelated machine do not change how this project's machine is reached.
    inventory = [
      { ...machine, name: "Office laptop" },
      { id: "other", name: "Other", endpoint: "ssh://owner@other", environmentId: "other-env" },
    ];
    await refreshInventory();
    expect(startRailPoller).toHaveBeenCalledTimes(1);
    expect(stopPoller).not.toHaveBeenCalled();

    // A changed route is a different machine to reach: the poller restarts once.
    inventory = [{ ...machine, ssh: { target: "owner@replacement", remotePort: 7000 } }];
    await refreshInventory();
    expect(startRailPoller).toHaveBeenCalledTimes(2);
    expect(stopPoller).toHaveBeenCalledTimes(1);

    // So does a changed Host identity: the project's machine is no longer listed, then returns.
    inventory = [];
    await refreshInventory();
    expect(stopPoller).toHaveBeenCalledTimes(2);
    inventory = [{ ...machine, ssh: { target: "owner@replacement", remotePort: 7000 } }];
    await refreshInventory();
    expect(startRailPoller).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
  }
});
