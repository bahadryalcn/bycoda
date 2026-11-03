// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceControls, WORKSPACE_REFRESH_EVENT } from "./WorkspaceControls";
import { loadSoundsEnabled, saveSoundsEnabled } from "../../features/settings/model/sounds";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens each destination and refreshes without reloading the app", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onHiddenGroups = vi.fn(),
    onPullRequests = vi.fn(),
    onUsage = vi.fn(),
    reload = vi.fn();
  window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceControls, {
          onHiddenGroups,
          onPullRequests,
          onUsage,
          active: "usage",
        }),
      ),
    );
    expect(
      [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Pull requests",
      "Usage",
      "Manage hidden groups",
      "Sounds",
      "Refresh current view",
      "Full screen",
    ]);
    for (const label of [
      "Manage hidden groups",
      "Pull requests",
      "Usage",
      "Refresh current view",
    ]) {
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
      );
    }
    expect(onHiddenGroups).toHaveBeenCalledOnce();
    expect(onPullRequests).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    const fullscreen = host.querySelector('[aria-label="Full screen"]');
    expect(fullscreen).not.toBeNull();
    expect(fullscreen).toBe(host.querySelector("nav")!.lastElementChild);
    expect(host.querySelector('[aria-label="Usage"]')?.getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      root.render(
        createElement(WorkspaceControls, {
          onHiddenGroups,
          onPullRequests,
          onUsage,
          canRefresh: false,
        }),
      ),
    );
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh current view"]')!.click();
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
  }
});

it("persists the sound toggle, follows Settings changes and retains state on failed saves", async () => {
  localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceControls, {
          onHiddenGroups: () => {},
          onPullRequests: () => {},
          onUsage: () => {},
        }),
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('[data-workspace-control="sounds"]')!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button.click());
    expect(loadSoundsEnabled()).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      saveSoundsEnabled(true);
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await act(async () => button.click());
    expect(loadSoundsEnabled()).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Could not save changes");
    write.mockRestore();
    const retry = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(loadSoundsEnabled()).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  } finally {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    localStorage.clear();
  }
});
