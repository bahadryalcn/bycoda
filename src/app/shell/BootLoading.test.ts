// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getLanguagePreference, languageReady, setLanguagePreference } from "../../shared/i18n";
import { BOOT_SLOW_AFTER_MS, BootLoading } from "./BootLoading";

let container: HTMLElement;
let root: Root;

beforeEach(async () => {
  await languageReady;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  delete (window as { __bootLogo?: string }).__bootLogo;
  delete (window as { __bootWordmark?: string }).__bootWordmark;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderLoading(onRetry = vi.fn()) {
  act(() => root.render(createElement(BootLoading, { onRetry })));
  return onRetry;
}

it("shows only the logo on a normal boot, with no Retry and no live region", () => {
  vi.useFakeTimers();
  renderLoading();
  expect(container.querySelector("img")).not.toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("[role=status]")).toBeNull();
  expect(container.textContent).toBe("");
  act(() => vi.advanceTimersByTime(BOOT_SLOW_AFTER_MS - 1));
  expect(container.querySelector("button")).toBeNull();
});

it("uses the logo the splash picked for the saved scheme, and the white one by default", () => {
  (window as { __bootLogo?: string }).__bootLogo = "/brand/bycoda/mark-tea-red-loading-light.svg";
  renderLoading();
  expect(container.querySelector("img")!.getAttribute("src")).toBe(
    "/brand/bycoda/mark-tea-red-loading-light.svg",
  );
  act(() => root.unmount());
  root = createRoot(container);
  delete (window as { __bootLogo?: string }).__bootLogo;
  renderLoading();
  expect(container.querySelector("img")!.getAttribute("src")).toBe(
    "/brand/bycoda/mark-tea-red-loading.svg",
  );
});

it("shows the wordmark under the logo, matching the splash's scheme pick", () => {
  (window as { __bootWordmark?: string }).__bootWordmark = "/brand/bycoda/wordmark-full-dark.svg";
  renderLoading();
  const wordmark = container.querySelector(".bycoda-boot-loading-wordmark")!;
  expect(wordmark.getAttribute("src")).toBe("/brand/bycoda/wordmark-full-dark.svg");
  act(() => root.unmount());
  root = createRoot(container);
  delete (window as { __bootWordmark?: string }).__bootWordmark;
  renderLoading();
  expect(
    container.querySelector(".bycoda-boot-loading-wordmark")!.getAttribute("src"),
  ).toBe("/brand/bycoda/wordmark-white.svg");
});

it("offers Retry below an unmoved logo once the boot is slow, outside the live region", () => {
  vi.useFakeTimers();
  const retry = renderLoading();
  const logo = container.querySelector("img")!;
  act(() => vi.advanceTimersByTime(BOOT_SLOW_AFTER_MS));
  expect(container.querySelector("img")).toBe(logo);
  const status = container.querySelector("[role=status]")!;
  expect(status.textContent).toContain("Restoring your workspace and saved drafts…");
  expect(status.querySelector("button")).toBeNull();
  expect(container.querySelector("[aria-live]")).toBeNull();
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Reload");
  act(() => button.click());
  expect(retry).toHaveBeenCalledOnce();
});

it("updates the mounted restore shell when the language catalog changes", async () => {
  const original = getLanguagePreference();
  vi.useFakeTimers();
  try {
    await setLanguagePreference("en");
    renderLoading();
    act(() => vi.advanceTimersByTime(BOOT_SLOW_AFTER_MS));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Reload");
    expect(container.textContent).toContain("Restoring your workspace and saved drafts…");
    vi.useRealTimers();
    await act(async () => setLanguagePreference("tr"));
    expect(container.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("Yeniden yükle");
    expect(container.textContent).toContain(
      "Çalışma alanınız ve kayıtlı taslaklarınız geri yükleniyor…",
    );
  } finally {
    await setLanguagePreference(original);
  }
});

it("lets the themed ground show through instead of a dark startup surface", () => {
  // Read from disk: the Vite `?raw` CSS import is transformed to an empty module under Vitest.
  const indexCss = readFileSync("src/styles/index.css", "utf8");
  const bycodaCss = readFileSync("src/styles/bycoda.css", "utf8");
  expect(indexCss).not.toContain("--ui-startup-");
  const rule = /\.bycoda-boot-loading\s*\{[^}]*\}/.exec(bycodaCss)?.[0] ?? "";
  expect(rule).not.toBe("");
  expect(rule).not.toMatch(/background/);
});
