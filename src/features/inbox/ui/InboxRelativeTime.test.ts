// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { hasInboxRelativeTime, InboxRelativeTime } from "./InboxRelativeTime";

afterEach(async () => {
  vi.useRealTimers();
  await setLanguagePreference("en");
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

it("re-reads the age on each minute while visible and stops while hidden", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  vi.setSystemTime(new Date(2026, 9, 17, 12, 0, 0));
  const at = new Date(2026, 9, 17, 11, 55, 0).toISOString();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(InboxRelativeTime, { at })));
    expect(container.textContent).toBe("5 minutes ago");
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.textContent).toBe("6 minutes ago");
    setHidden(true);
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(container.textContent).toBe("6 minutes ago");
    setHidden(false);
    expect(container.textContent).toBe("11 minutes ago");
  } finally {
    act(() => root.unmount());
  }
});

it("shows no label for a missing or unparsable timestamp", () => {
  expect(hasInboxRelativeTime(undefined)).toBe(false);
  expect(hasInboxRelativeTime("not-a-date")).toBe(false);
  expect(hasInboxRelativeTime(new Date(0).toISOString())).toBe(true);
});
