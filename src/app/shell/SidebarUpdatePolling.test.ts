// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import { installAppUpdate, setAppUpdateSnapshot } from "../model/useAppUpdater";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), install: vi.fn() }));
vi.mock("../model/updater", () => ({
  probeForUpdate: mocks.probe,
  readAppVersion: async () => "0.8.33",
  installPendingUpdate: mocks.install,
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shares one check and one download across both entry points and retains install errors", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setAppUpdateSnapshot({ phase: "idle", currentVersion: "0.8.33" });
  mocks.probe.mockResolvedValue({ version: "0.8.34", body: "Release details" });
  const container = document.createElement("div");
  const root = createRoot(container);
  let finish!: () => void;
  mocks.install.mockImplementation(async (report) => {
    report({
      phase: "downloading",
      currentVersion: "0.8.33",
      availableVersion: "0.8.34",
      progress: 42,
    });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      phase: "error",
      currentVersion: "0.8.33",
      availableVersion: "0.8.34",
      error: "Download failed",
    };
  });
  try {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(SidebarUpdateFooter),
          createElement(SidebarUpdateFooter),
        ),
      ),
    );
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector("details")?.textContent).toContain("Release details");
    const later = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Later (24 hours)",
    )!;
    await act(async () => later.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Ctrl+B hides and restores the sidebar: remounting must not reopen the prompt.
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(SidebarUpdateFooter)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const manualTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Update to 0.8.34"]',
    )!;
    await act(async () => manualTrigger.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const dismiss = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Later (24 hours)",
    )!;
    await act(async () => dismiss.click());
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(SidebarUpdateFooter),
          createElement(SidebarUpdateFooter),
        ),
      ),
    );
    expect(container.querySelectorAll('[aria-label="Update to 0.8.34"]')).toHaveLength(2);
    let download!: Promise<void>;
    await act(async () => {
      download = installAppUpdate(() => {});
      await installAppUpdate(() => {});
    });
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[aria-label="Downloading 42%"]')).toHaveLength(2);
    await act(async () => {
      finish();
      await download;
    });
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Update to 0.8.34"]')!;
    expect(trigger).not.toBeNull();
    await act(async () => trigger.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Download failed");
  } finally {
    await act(async () => root.unmount());
  }
});

it("checks periodically, preserves available updates, and clears its timer on unmount", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.probe.mockResolvedValueOnce(null).mockResolvedValue({ version: "0.8.34" });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SidebarUpdateFooter)));
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Update to 0.8.34"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    mocks.probe.mockResolvedValue({ version: "0.8.40" });
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(mocks.probe).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[aria-label="Update to 0.8.40"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
  // The update prompt can schedule exit animations; only update polling must stop.
  await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
  expect(mocks.probe).toHaveBeenCalledTimes(3);
});
