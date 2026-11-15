// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  isMachineEnabled,
  loadDisabledMachines,
  setMachineEnabled,
  subscribeDisabledMachines,
} from "./machineEnabled";

beforeEach(() => localStorage.clear());

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
