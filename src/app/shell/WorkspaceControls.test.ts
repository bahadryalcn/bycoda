// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceControls, WORKSPACE_REFRESH_EVENT } from "./WorkspaceControls";

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
  const onSettings = vi.fn(),
    onPullRequests = vi.fn(),
    onUsage = vi.fn(),
    reload = vi.fn();
  window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceControls, {
          onSettings,
          onPullRequests,
          onUsage,
          active: "usage",
        }),
      ),
    );
    for (const label of ["Settings", "Pull requests", "Usage", "Refresh current view"]) {
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
      );
    }
    expect(onSettings).toHaveBeenCalledOnce();
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
          onSettings,
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
