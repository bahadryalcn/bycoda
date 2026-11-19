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
  const reload = vi.fn();
  window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
  try {
    await act(async () => root.render(createElement(WorkspaceControls, {})));
    document.body.append(host);
    expect(
      [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Refresh current view", "Sounds", "Full screen"]);
    const refreshButton = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Refresh current view"]')!;
    await act(async () => refreshButton().click());
    expect(reload).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Manage hidden groups");
    expect(document.body.textContent).not.toContain("Provider usage");
    expect(document.body.textContent).not.toContain("Pull requests");
    await act(async () =>
      root.render(
        createElement(WorkspaceControls, {
          canRefresh: false,
        }),
      ),
    );
    expect(refreshButton().disabled).toBe(true);
    await act(async () => refreshButton().click());
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
    host.remove();
  }
});

it("persists the sound toggle, follows Settings changes and retains state on failed saves", async () => {
  localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(WorkspaceControls, {})));
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
