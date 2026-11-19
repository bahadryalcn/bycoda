// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countMinutes, decodeMinutes } from "@bycoda/account-contracts/activity";
import { TICK_MS } from "../model/activityTracker";
import { useActivityTracker } from "./useActivityTracker";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../model/activityClient", () => ({
  activityClient: (machineId: string) => ({
    record: (report: unknown) => mocks.record(machineId, report),
  }),
}));

const sent = (machineId: string) =>
  mocks.record.mock.calls
    .filter(([id]) => id === machineId)
    .reduce(
      (sum, [, report]) => sum + countMinutes(decodeMinutes((report as { minutes: string }).minutes)),
      0,
    );

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.record.mockReset();
});

async function mount(machineId: string | undefined) {
  const root = createRoot(document.createElement("div"));
  function Owner(props: { id: string | undefined }) {
    useActivityTracker(props.id);
    return null;
  }
  const render = (id: string | undefined) =>
    act(async () => root.render(createElement(Owner, { id })));
  await render(machineId);
  return { root, render };
}

/** One active minute: input, then a tick that sees it. */
async function activeMinute() {
  window.dispatchEvent(new Event("pointerdown"));
  await act(async () => vi.advanceTimersByTime(TICK_MS));
}

it("keeps minutes when the final flush on unmount fails and sends them on the next mount", async () => {
  mocks.record.mockRejectedValue(new Error("host down"));
  const first = await mount("pc");
  await activeMinute();
  await act(async () => first.root.unmount());
  expect(sent("pc")).toBe(0);
  expect(localStorage.getItem("bycoda.activity.outbox.v1")).toContain("pc");

  mocks.record.mockResolvedValue({ changed: true });
  const second = await mount("pc");
  expect(sent("pc")).toBeGreaterThan(0);
  expect(localStorage.getItem("bycoda.activity.outbox.v1")).toBeNull();
  await act(async () => second.root.unmount());
});

it("keeps a failed Host's minutes for that Host and never sends them to another", async () => {
  mocks.record.mockRejectedValue(new Error("host down"));
  const { root, render } = await mount("pc");
  await activeMinute();

  mocks.record.mockResolvedValue({ changed: true });
  await render("other");
  expect(sent("other")).toBe(0);
  expect(localStorage.getItem("bycoda.activity.outbox.v1")).toContain("pc");

  await render(undefined);
  await render("pc");
  expect(sent("pc")).toBeGreaterThan(0);
  await act(async () => root.unmount());
});

it("keeps minutes when a send still in flight fails after the effect was cleaned up", async () => {
  let fail!: (error: Error) => void;
  mocks.record.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  const { root } = await mount("pc");
  await activeMinute();
  await act(async () => vi.advanceTimersByTime(60_000));
  await act(async () => root.unmount());
  expect(localStorage.getItem("bycoda.activity.outbox.v1")).toBeNull();

  await act(async () => fail(new Error("host down")));
  expect(localStorage.getItem("bycoda.activity.outbox.v1")).toContain("pc");
});
