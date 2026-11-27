// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast, Toast, ToastRegion, TOAST_VISIBLE_MS } from "../../../shared/ui/ToastRegion";
import { readNotificationHistory } from "../model/notificationHistory";
import { logToastAnnouncement } from "../model/notificationLog";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("retains expired and dismissed notices in the existing persistent history", async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(ToastRegion, { onRecord: logToastAnnouncement })));
    let failed = "";
    act(() => {
      toast.show({ tone: "info", message: "Saved" });
      failed = toast.show({ title: "Update failed", message: "Access denied", tone: "danger" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    // A transient "Saved" never reaches the center; the failure does.
    expect(readNotificationHistory()).toHaveLength(1);
    act(() => toast.dismiss(failed));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_VISIBLE_MS + 500);
    });
    expect(document.querySelector("[data-toast-tone]")).toBeNull();
    expect(readNotificationHistory()).toEqual([
      expect.objectContaining({
        title: "Update failed",
        label: "Access denied",
        kind: "failed",
        tone: "danger",
      }),
    ]);
  } finally {
    act(() => {
      toast.dismissAll();
      root.unmount();
    });
  }
  expect(readNotificationHistory()).toHaveLength(1);
});

it("records declarative initial content once in StrictMode, without action or child payloads", async () => {
  const root = createRoot(document.createElement("div"));
  const render = (summary: string) =>
    createElement(
      StrictMode,
      null,
      createElement(Toast, {
        title: "Harness updates available",
        tone: "warning",
        historyMessage: summary,
        children: createElement("span", null, "private child payload"),
        action: { label: "Update", onClick: () => undefined },
      }),
      createElement(ToastRegion, { onRecord: logToastAnnouncement }),
    );
  try {
    await act(async () => root.render(render("Claude Code: 1.0 → 2.0")));
    expect(readNotificationHistory()).toHaveLength(1);
    await act(async () => root.render(render("Claude Code: 1.0 → 2.0")));
    expect(readNotificationHistory()).toHaveLength(1);
    await act(async () => root.render(render("Claude Code updated to 2.0")));
    expect(readNotificationHistory()).toHaveLength(2);
    expect(JSON.stringify(readNotificationHistory())).not.toContain("private child payload");
    expect(readNotificationHistory()[0].label).toBe("Claude Code updated to 2.0");
  } finally {
    act(() => root.unmount());
  }
});
