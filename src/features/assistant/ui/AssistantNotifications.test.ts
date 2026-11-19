// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(async () => undefined),
  lead: vi.fn(async () => true),
}));
vi.mock("../model/assistantClient", () => ({
  assistantRequest: mock.request,
  refreshAssistantQuietly: mock.refresh,
  useAssistantSnapshot: () => null,
  watchAssistantSnapshot: () => () => undefined,
}));
vi.mock("../../notifications/hooks/useBackgroundNotifications", () => ({
  isLeadWindow: mock.lead,
}));
vi.mock("../../notifications/model/notifications", () => ({ notifyAssistant: vi.fn() }));
import { AssistantNotifications } from "./AssistantNotifications";
import {
  saveDailySummaryEnabled,
  saveDailySummaryTime,
} from "../../notifications/model/dailySummarySettings";
let root: Root | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.request.mockResolvedValue({ ok: true });
  mock.lead.mockResolvedValue(true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});
async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(AssistantNotifications)));
}
it("persists the existing disabled morning preference to the Host without preparing or delivering a briefing", async () => {
  saveDailySummaryEnabled(false);
  saveDailySummaryTime("11:00");
  await mount();
  await vi.waitFor(() =>
    expect(mock.request).toHaveBeenCalledWith({
      op: "briefing.schedule",
      enabled: false,
      time: "11:00",
    }),
  );
  expect(mock.request).toHaveBeenCalledOnce();
});
it("serializes a changed morning preference behind its pending acknowledgement and sends the latest value", async () => {
  let release!: () => void;
  mock.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
  );
  await mount();
  await vi.waitFor(() => expect(mock.request).toHaveBeenCalledOnce());
  saveDailySummaryTime("13:00");
  saveDailySummaryEnabled(false);
  expect(mock.request).toHaveBeenCalledOnce();
  await act(async () => release());
  await vi.waitFor(() =>
    expect(mock.request).toHaveBeenLastCalledWith({
      op: "briefing.schedule",
      enabled: false,
      time: "13:00",
    }),
  );
  expect(mock.request).toHaveBeenCalledTimes(2);
});
// Regression: a visible window leaves snapshot reads to the shared 15 s poller (no duplicate read per tick).
it("does not read the snapshot itself while the window is visible", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await mount();
  await vi.waitFor(() =>
    expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ op: "briefing.schedule" })),
  );
  expect(mock.refresh).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
it.each(["visible", "hidden"] as const)(
  "leaves snapshot polling to the store while %s",
  async (visibility) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 19, 10));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
    saveDailySummaryTime("11:00");
    try {
      await mount();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(mock.lead).toHaveBeenCalledOnce();
      expect(mock.refresh).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(59 * 60_000));
      expect(mock.lead).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  },
);
