// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../i18n";
import { Timestamp } from "./Timestamp";

afterEach(async () => {
  vi.useRealTimers();
  await setLanguagePreference("en");
  vi.unstubAllGlobals();
});

it("localizes calendar labels, rolls over at midnight and refreshes after resume", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const value = new Date(2026, 9, 17, 23, 44).getTime();
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 59));
  await setLanguagePreference("tr");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(Timestamp, { value })));
    expect(container.textContent).toBe("Bugün 23:44");
    expect(container.querySelector("time")?.title).toBe("17 Eki 2026 23:44");
    act(() => vi.advanceTimersByTime(2_000));
    expect(container.textContent).toBe("Dün 23:44");
    await act(async () => setLanguagePreference("en"));
    expect(container.textContent).toBe("Yesterday 11:44 PM");
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toBe("Oct 17, 2026, 11:44 PM");
    expect(container.querySelector("time")?.dateTime).toBe(new Date(value).toISOString());
  } finally {
    act(() => root.unmount());
  }
});

it("compares calendar days across month and year boundaries and keeps future dates absolute", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.setSystemTime(new Date(2026, 0, 1, 0, 5));
  await setLanguagePreference("tr");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(createElement(Timestamp, { value: new Date(2025, 11, 31, 23, 44).getTime() })),
    );
    expect(container.textContent).toBe("Dün 23:44");
    act(() =>
      root.render(createElement(Timestamp, { value: new Date(2026, 0, 2, 23, 44).getTime() })),
    );
    expect(container.textContent).toBe("2 Oca 2026 23:44");
  } finally {
    act(() => root.unmount());
  }
});
