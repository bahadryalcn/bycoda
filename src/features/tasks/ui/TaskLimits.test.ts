// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineLimits } from "../model/settingsClient";
import { CustomDailyLimit, type SaveLimits } from "./TaskLimits";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const limits = (dailyAgentMinutes: number, machineId = "local"): MachineLimits => ({
  machineId,
  machineName: "this computer",
  maxRunningTasks: 2,
  dailyAgentMinutes,
  usedMinutes: 0,
  limitReached: false,
});
const show = (entry: MachineLimits, onChange: SaveLimits) =>
  act(async () => root.render(createElement(CustomDailyLimit, { entry, onChange })));
const hoursField = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
const label = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === text);
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("keeps an unsaved hours draft when the machine's limit refreshes, and says so", async () => {
  const save = vi.fn(async () => true);
  await show(limits(120), save);
  expect(hoursField().value).toBe("2");
  await act(async () => type(hoursField(), "3.5"));
  await show(limits(240), save);
  expect(hoursField().value).toBe("3.5");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("4");
  expect(label("Use machine value")).toBeTruthy();
  await act(async () => label("Use machine value")!.click());
  expect(hoursField().value).toBe("4");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("follows the machine while nothing is being edited", async () => {
  const save = vi.fn(async () => true);
  await show(limits(120), save);
  await show(limits(180), save);
  expect(hoursField().value).toBe("3");
  expect(label("Reset")).toBeUndefined();
});

it("rebases on the machine's answer only after the save is acknowledged", async () => {
  let acknowledge!: (saved: boolean) => void;
  const save = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      }),
  );
  await show(limits(120), save);
  await act(async () => type(hoursField(), "6"));
  await act(async () => label("Save")!.click());
  expect(save).toHaveBeenCalledWith("local", { dailyAgentMinutes: 360 });
  expect(hoursField().disabled).toBe(true);
  await act(async () => acknowledge(false));
  // A rejected save keeps the draft for another attempt.
  expect(hoursField().value).toBe("6");
  expect(hoursField().disabled).toBe(false);
  await act(async () => label("Save")!.click());
  await act(async () => acknowledge(true));
  expect(hoursField().value).toBe("6");
  // The acknowledged limits arrive afterwards and become the input's value.
  await show(limits(360), save);
  expect(hoursField().value).toBe("6");
  expect(label("Reset")).toBeUndefined();
  await show(limits(480), save);
  expect(hoursField().value).toBe("8");
});

it("does not carry a draft to another machine", async () => {
  const save = vi.fn(async () => true);
  await show(limits(120, "local"), save);
  await act(async () => type(hoursField(), "9"));
  await act(async () =>
    root.render(
      createElement(CustomDailyLimit, {
        key: "remote",
        entry: limits(60, "remote"),
        onChange: save,
      }),
    ),
  );
  expect(hoursField().value).toBe("1");
});
