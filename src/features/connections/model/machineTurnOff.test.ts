// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const invalidateConnection = vi.hoisted(() => vi.fn());
const knownRemoteMachine = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./remoteLifecycle", () => ({ invalidateConnection }));
vi.mock("./connections", () => ({ knownRemoteMachine }));

import { isMachineEnabled, setMachineEnabled, subscribeMachineTurnedOff } from "./machineEnabled";
import { closeTurnedOffMachine } from "./machineTurnOff";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("closes the tunnel and socket of the machine that was turned off, keeping it saved", () => {
  knownRemoteMachine.mockReturnValue({ id: "m1", environmentId: "env-a" });
  const close = vi.fn(async () => undefined);
  const stop = subscribeMachineTurnedOff((id) => closeTurnedOffMachine(id, close));
  setMachineEnabled("env-a", false);
  expect(close).toHaveBeenCalledExactlyOnceWith("m1");
  expect(invalidateConnection).toHaveBeenCalledWith("env-a");
  stop();
});

it("does nothing for a repeated off, a turn on, or a machine this app does not know", () => {
  knownRemoteMachine.mockReturnValue(undefined);
  const close = vi.fn(async () => undefined);
  const listener = vi.fn((id: string) => closeTurnedOffMachine(id, close));
  const stop = subscribeMachineTurnedOff(listener);
  setMachineEnabled("env-a", false);
  expect(listener).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  setMachineEnabled("env-a", false);
  setMachineEnabled("env-a", true);
  expect(listener).toHaveBeenCalledOnce();
  expect(isMachineEnabled("env-a")).toBe(true);
  stop();
});

it("ignores a failed close", async () => {
  knownRemoteMachine.mockReturnValue({ id: "m1", environmentId: "env-a" });
  expect(() =>
    closeTurnedOffMachine("env-a", () => Promise.reject(new Error("gone"))),
  ).not.toThrow();
  await Promise.resolve();
});
