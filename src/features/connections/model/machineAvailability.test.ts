// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adoptRemoteMachineInventory } from "./connections";
import { setMachineEnabled } from "./machineEnabled";
import {
  machineHidesView,
  readMachineAvailability,
  remotePollDue,
  resetMachineAvailability,
} from "./machineAvailability";
import {
  forgetRemoteConnection,
  notifyRemoteRecovered,
  recordRemoteConnection,
  reportRemoteLoad,
  resetRemoteHealth,
  subscribeRemoteRecovered,
} from "./remoteHealth";
import { remotePath } from "./remoteProjects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));

const project = remotePath("env", "G:/Projects/repo");
const machine = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };

beforeEach(() => {
  resetRemoteHealth();
  resetMachineAvailability();
  setMachineEnabled("env", true);
  adoptRemoteMachineInventory([machine]);
});
afterEach(() => {
  setMachineEnabled("env", true);
  adoptRemoteMachineInventory([]);
});

it("lets a local project and a machine whose state is not known yet be read", () => {
  expect(readMachineAvailability("G:/Projects/local")).toEqual({
    available: true,
    connecting: false,
  });
  expect(readMachineAvailability(project)).toEqual({ available: true, connecting: true });
  recordRemoteConnection("env");
  expect(readMachineAvailability(project)).toEqual({ available: true, connecting: false });
});

it("names why a machine cannot be asked", () => {
  recordRemoteConnection("env", "Host rejected request [RPC_AUTHORIZATION] (401)");
  expect(readMachineAvailability(project)).toMatchObject({ reason: "pairing-refused" });

  resetRemoteHealth();
  recordRemoteConnection("env", "Machine is unreachable. Check the host and SSH tunnel.");
  expect(readMachineAvailability(project)).toMatchObject({ reason: "offline" });

  resetRemoteHealth();
  recordRemoteConnection(
    "env",
    Object.assign(new Error("RPC_WS_BLOCKED: refused"), { code: "RPC_WS_BLOCKED" }),
  );
  expect(readMachineAvailability(project)).toMatchObject({ reason: "needs-sign-in" });

  setMachineEnabled("env", false);
  expect(readMachineAvailability(project)).toMatchObject({ reason: "turned-off" });

  adoptRemoteMachineInventory([]);
  expect(readMachineAvailability(project)).toMatchObject({ reason: "not-added" });
});

// The endless "Loading changes…": a reconnect that finds no saved machine forgets every
// failure the views recorded for it. Availability comes from the machine list instead, so
// it stays "not added" however often that happens.
it("stays not added after a failed reconnect forgets what the views recorded", () => {
  adoptRemoteMachineInventory([]);
  reportRemoteLoad(project, "changes", "This project’s machine isn’t connected on this computer.");
  forgetRemoteConnection("env");

  expect(readMachineAvailability(project)).toMatchObject({
    available: false,
    reason: "not-added",
  });
  expect(remotePollDue(project)).toBe(false);
});

it("stops background polls while unavailable and resumes them when available", () => {
  const recovered = vi.fn();
  const stop = subscribeRemoteRecovered(recovered);
  recordRemoteConnection("env", "Host rejected request [RPC_AUTHORIZATION] (401)");
  expect(remotePollDue(project)).toBe(false);

  notifyRemoteRecovered("env");

  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledWith("env");
  stop();
});

it("announces a machine added again so its views reload", () => {
  adoptRemoteMachineInventory([]);
  expect(readMachineAvailability(project).available).toBe(false);
  const recovered = vi.fn();
  const stop = subscribeRemoteRecovered(recovered);

  adoptRemoteMachineInventory([machine]);

  expect(recovered).toHaveBeenCalledWith("env");
  stop();
});

it("hides a view for every unavailable reason except offline with data", () => {
  const reasons = ["not-added", "pairing-refused", "needs-sign-in", "turned-off"] as const;
  for (const reason of reasons) {
    const availability = { available: false, reason } as const;
    expect(machineHidesView(availability, true)).toBe(true);
    expect(machineHidesView(availability, false)).toBe(true);
  }
  const offline = { available: false, reason: "offline" } as const;
  expect(machineHidesView(offline, true)).toBe(false);
  expect(machineHidesView(offline, false)).toBe(true);
  expect(machineHidesView({ available: true, connecting: false }, false)).toBe(false);
});
