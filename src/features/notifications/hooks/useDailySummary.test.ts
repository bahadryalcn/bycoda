// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { notify, gather, store, lead } = vi.hoisted(() => ({
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
import { useDailySummary } from "./useDailySummary";
import { loadDailySummarySentAt } from "../model/dailySummarySettings";
let root: Root;
function Harness() {
  useDailySummary();
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
