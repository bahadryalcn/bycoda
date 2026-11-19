// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useActivitySummary } from "./useActivitySummary";

const mocks = vi.hoisted(() => ({
  visible: true,
  totals: vi.fn(),
}));
vi.mock("../../../shared/hooks/useQueryVisible", () => ({
  useQueryVisible: () => mocks.visible,
}));
vi.mock("../model/activityTotals", () => ({ getActivityTotals: mocks.totals }));

const summary = { today: { minutes: 1 } } as never;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.visible = true;
  mocks.totals.mockReset();
});

async function mount(machineId: string | undefined) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let latest!: ReturnType<typeof useActivitySummary>;
  function Owner(props: { id: string | undefined }) {
    latest = useActivitySummary(props.id);
    return null;
  }
  const render = (id: string | undefined) =>
    act(async () => root.render(createElement(Owner, { id })));
  await render(machineId);
  return { root, render, state: () => latest };
}

it("polls the Host only while the window is visible", async () => {
  mocks.totals.mockResolvedValue(summary);
  const { root, render } = await mount("pc");
  expect(mocks.totals).toHaveBeenCalledTimes(1);

  mocks.visible = false;
  await render("pc");
  await act(async () => vi.advanceTimersByTime(5 * 60_000));
  expect(mocks.totals).toHaveBeenCalledTimes(1);

  mocks.visible = true;
  await render("pc");
  expect(mocks.totals).toHaveBeenCalledTimes(2);

  await act(async () => vi.advanceTimersByTime(60_000));
  expect(mocks.totals).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
});

it("keeps the last coherent summary when a later refresh fails", async () => {
  mocks.totals.mockResolvedValueOnce(summary).mockResolvedValueOnce(null);
  const { root, state } = await mount("pc");
  expect(state().summary).toBe(summary);

  await act(async () => vi.advanceTimersByTime(60_000));
  expect(state()).toEqual({ summary, failed: true });
  await act(async () => root.unmount());
});

it("drops a tick while the previous request is still pending", async () => {
  let finish!: (value: unknown) => void;
  mocks.totals.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const { root } = await mount("pc");

  await act(async () => vi.advanceTimersByTime(3 * 60_000));
  expect(mocks.totals).toHaveBeenCalledTimes(1);

  await act(async () => finish(summary));
  mocks.totals.mockResolvedValue(summary);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(mocks.totals).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("does not request without a machine", async () => {
  const { root } = await mount(undefined);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(mocks.totals).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
