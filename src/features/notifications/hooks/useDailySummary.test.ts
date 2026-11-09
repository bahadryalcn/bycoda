// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { notify, gather, store, lead, totals } = vi.hoisted(() => ({
  totals: vi.fn(),
  notify: vi.fn(),
  gather: vi.fn(),
  store: vi.fn(),
  lead: vi.fn(),
}));
vi.mock("../model/notifications", () => ({
  loadNotificationsEnabled: () => true,
  notifyDailySummary: notify,
}));
vi.mock("../../tasks/model/dailySummaryClient", () => ({
  gatherDailySummary: gather,
  saveStoredDailySummary: store,
}));
vi.mock("../../tasks/model/dailySummary", () => ({ summaryHeadline: () => "Summary" }));
vi.mock("./useBackgroundNotifications", () => ({ isLeadWindow: lead }));
vi.mock("../../activity", () => ({
  getActivityTotals: totals,
  yesterdayMinutes: (summary: { yesterday: number | null }) => summary.yesterday,
  formatActiveMinutes: (minutes: number) => `${minutes}m`,
}));
import { useDailySummary } from "./useDailySummary";
import { loadDailySummarySentAt } from "../model/dailySummarySettings";
let root: Root;
function Harness({ machineId }: { machineId?: string }) {
  useDailySummary(machineId);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 10));
  localStorage.clear();
  vi.clearAllMocks();
  lead.mockResolvedValue(true);
  gather.mockResolvedValue({});
  notify.mockResolvedValue(true);
  totals.mockResolvedValue(null);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["permission", "transport"])(
  "retries %s failures and records only successful delivery",
  async (failure) => {
    if (failure === "permission") notify.mockResolvedValueOnce(false);
    else notify.mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(createElement(Harness)));
    expect(store).toHaveBeenCalledTimes(1);
    expect(loadDailySummarySentAt()).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(loadDailySummarySentAt()).toBe(Date.now());
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(notify).toHaveBeenCalledTimes(2);
  },
);
it("does not overlap delivery while a notification is pending", async () => {
  let finish!: (sent: boolean) => void;
  notify.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(Harness)));
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(notify).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(notify).toHaveBeenCalledTimes(1);
});
it("retries the sent-time and cached summary writes after a dispatched summary", async () => {
  store.mockReturnValueOnce(false);
  const realSetItem = localStorage.setItem.bind(localStorage);
  const setItem = vi.spyOn(localStorage, "setItem");
  setItem.mockImplementation((key: string, value: string) => {
    if (key.endsWith("dailySummary.lastSent")) throw new Error("quota");
    realSetItem(key, value);
  });
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(loadDailySummarySentAt()).toBeNull();
    expect(store).toHaveBeenCalledTimes(1);

    // Storage recovers: the next poll persists what the delivery left behind
    // without sending a second summary.
    setItem.mockRestore();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledTimes(2);
    expect(loadDailySummarySentAt()).not.toBeNull();
  } finally {
    setItem.mockRestore();
  }
});

it("adds yesterday's active time to the headline when the local Host answers", async () => {
  totals.mockResolvedValue({ yesterday: 125 });
  await act(async () => root.render(createElement(Harness, { machineId: "local" })));
  expect(totals).toHaveBeenCalledWith("local");
  expect(notify).toHaveBeenCalledWith("Summary · 125m active yesterday");
});

it("keeps the plain headline without a Host or without activity data", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(totals).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("Summary");
});
