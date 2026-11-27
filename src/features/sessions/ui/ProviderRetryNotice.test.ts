// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderRetryNotice } from "./ProviderRetryNotice";
import { setLanguagePreference } from "../../../shared/i18n";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguagePreference("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("names the provider and offers Stop without inventing a reconnect or resending", () => {
  const onStop = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderRetryNotice, {
        provider: "Codex",
        message: "Reconnecting... 2/5",
        onStop,
      }),
    ),
  );
  const notice = host.querySelector('[role="status"]');
  expect(notice?.querySelector("strong")?.textContent).toBe("Reconnecting to Codex");
  expect(notice?.textContent).toContain("2/5");
  const buttons = host.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toContain("Stop");
  act(() => buttons[0].click());
  expect(onStop).toHaveBeenCalledOnce();
});

it("coalesces refresh clicks, reports failure locally and allows another attempt", async () => {
  let reject!: (reason: Error) => void;
  const onRefresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    )
    .mockResolvedValue(undefined);
  const onStop = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderRetryNotice, {
        provider: "Codex",
        message: "Retrying (2/3)…",
        onStop,
        onRefresh,
      }),
    ),
  );
  const refresh = host.querySelector("button")!;
  act(() => {
    refresh.click();
    refresh.click();
  });
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  expect(host.querySelectorAll("button")[1].disabled).toBe(true);
  await act(async () => reject(new Error("private transport detail")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Check the host connection");
  expect(host.textContent).not.toContain("private transport detail");
  await act(async () => refresh.click());
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(onStop).not.toHaveBeenCalled();
});

it("counts down to the provider's retry time and keeps the static text without one", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1_000_000);
    act(() =>
      root.render(
        createElement(ProviderRetryNotice, {
          provider: "Claude",
          message: "Retrying (2/5)…",
          retryAt: 1_000_000 + 12_000,
          onStop: vi.fn(),
        }),
      ),
    );
    expect(host.textContent).toContain("Retrying in 12s");
    expect(host.textContent).toContain("2/5");
    act(() => vi.advanceTimersByTime(5000));
    expect(host.textContent).toContain("Retrying in 7s");
    act(() => vi.advanceTimersByTime(8000));
    expect(host.textContent).not.toContain("Retrying in");
    expect(host.textContent).toContain("2/5");
    act(() =>
      root.render(
        createElement(ProviderRetryNotice, {
          provider: "Claude",
          message: "Retrying (3/5)…",
          onStop: vi.fn(),
        }),
      ),
    );
    expect(host.textContent).not.toContain("Retrying in");
  } finally {
    vi.useRealTimers();
  }
});
