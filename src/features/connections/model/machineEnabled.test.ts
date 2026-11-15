// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  isMachineEnabled,
  loadDisabledMachines,
  setMachineEnabled,
  subscribeDisabledMachines,
} from "./machineEnabled";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

beforeEach(() => localStorage.clear());

it("does not call native code just because the module was imported", () => {
  // Regression: an import-time call leaked into every module that imports connections.
  expect(invoke).not.toHaveBeenCalled();
});

it("turns a machine off and on by its environment, leaving other machines alone", () => {
  expect(isMachineEnabled("env-a")).toBe(true);
  setMachineEnabled("env-a", false);
  setMachineEnabled("env-b", false);
  expect(isMachineEnabled("env-a")).toBe(false);
  expect(loadDisabledMachines()).toEqual(["env-a", "env-b"]);
  setMachineEnabled("env-a", false);
  expect(loadDisabledMachines()).toEqual(["env-b", "env-a"]);
  setMachineEnabled("env-a", true);
  expect(isMachineEnabled("env-a")).toBe(true);
  expect(isMachineEnabled("env-b")).toBe(false);
});

it("tells subscribers, and changes only the off list", () => {
  const listener = vi.fn();
  const stop = subscribeDisabledMachines(listener);
  setMachineEnabled("env-a", false);
  expect(listener).toHaveBeenCalledOnce();
  stop();
  setMachineEnabled("env-a", true);
  expect(listener).toHaveBeenCalledOnce();
  expect(localStorage.getItem("bycoda.disabledMachines")).toBe("[]");
});

it("reads a damaged list as everything on", () => {
  localStorage.setItem("bycoda.disabledMachines", "{not json");
  expect(loadDisabledMachines()).toEqual([]);
  localStorage.setItem("bycoda.disabledMachines", '{"a":1}');
  expect(loadDisabledMachines()).toEqual([]);
});

it("synchronizes disabled environments to native transport admission", async () => {
  setMachineEnabled("env-native", false);
  await Promise.resolve();
  expect(invoke).toHaveBeenLastCalledWith("remote_set_disabled_machines", {
    environmentIds: ["env-native"],
  });
  setMachineEnabled("env-native", true);
  await Promise.resolve();
  expect(invoke).toHaveBeenLastCalledWith("remote_set_disabled_machines", { environmentIds: [] });
});
