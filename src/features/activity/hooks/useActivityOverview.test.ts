// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useActivityOverview } from "./useActivityOverview";

const mocks = vi.hoisted(() => ({
  getActivitySummary: vi.fn(),
  listDevices: vi.fn(),
  reportAccountFailure: vi.fn(),
}));
vi.mock("../../account", () => ({
  accountApi: () => ({
    getActivitySummary: mocks.getActivitySummary,
    listDevices: mocks.listDevices,
  }),
  reportAccountFailure: mocks.reportAccountFailure,
  useAccountState: () => ({ phase: "signed-in" }),
}));
vi.mock("../../connections/public/connections", () => ({
  useRemoteMachines: () => ({ machines: [] }),
}));
vi.mock("../model/machineActivity", () => ({
  loadCombinedActivity: vi.fn(),
  machineRefs: () => [],
}));

const summary = {
  perDevice: [{ deviceId: "d1", today: 1, week: 2, month: 3, year: 4 }],
};

let hidden = false;

beforeEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  mocks.getActivitySummary.mockResolvedValue(summary);
  mocks.listDevices.mockResolvedValue({ items: [{ id: "d1", name: "PC" }] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Removes the own property so `document.hidden` falls back to the prototype getter.
  delete (document as { hidden?: boolean }).hidden;
  hidden = false;
  mocks.getActivitySummary.mockReset();
  mocks.listDevices.mockReset();
  mocks.reportAccountFailure.mockReset();
});

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  function Owner() {
    useActivityOverview();
    return null;
  }
  await act(async () => root.render(createElement(Owner)));
  return root;
}

it("never starts a second load while one is still in flight", async () => {
  let release!: () => void;
  mocks.getActivitySummary.mockReturnValue(
    new Promise((resolve) => {
      release = () => resolve(summary);
    }),
  );
  const root = await mount();
  await act(async () => vi.advanceTimersByTime(3 * 60_000));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(1);

  await act(async () => release());
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("pauses polling while hidden and reloads once when shown again", async () => {
  const root = await mount();
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(1);

  hidden = true;
  await act(async () => vi.advanceTimersByTime(5 * 60_000));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(1);

  hidden = false;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("lists devices only while a summary device is unknown", async () => {
  const root = await mount();
  await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(3);
  expect(mocks.listDevices).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("reports the first failure after a success, not every failed tick", async () => {
  mocks.getActivitySummary.mockResolvedValueOnce(summary).mockRejectedValue(new Error("down"));
  const root = await mount();
  // Async advance lets each tick settle before the next, so the in-flight guard never skips one.
  await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
  expect(mocks.getActivitySummary).toHaveBeenCalledTimes(4);
  expect(mocks.reportAccountFailure).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
