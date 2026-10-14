// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  let maximized = false;
  let fullscreen = false;
  let resized: (() => void) | undefined;
  return {
    reset() {
      maximized = false;
      fullscreen = false;
      resized = undefined;
    },
    resize(max: boolean, full: boolean) {
      maximized = max;
      fullscreen = full;
      resized?.();
    },
    window: {
      isMaximized: vi.fn(async () => maximized),
      isFullscreen: vi.fn(async () => fullscreen),
      onResized: vi.fn(async (listener: () => void) => {
        resized = listener;
        return () => {
          resized = undefined;
        };
      }),
      onFocusChanged: vi.fn(async () => () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {
        maximized = !maximized;
      }),
      setFullscreen: vi.fn(async (value: boolean) => {
        fullscreen = value;
      }),
      close: vi.fn(async () => {}),
    },
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native.window }));
vi.mock("../../shared/i18n", () => ({ t: (text: string) => text, useLocale: () => {} }));
import { WindowControls } from "./WindowControls";
import { FullscreenButton } from "./FullscreenButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks();
  native.reset();
});

async function mounted(test: (host: HTMLDivElement) => Promise<void>, component = WindowControls) {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(component)));
    await test(host);
  } finally {
    await act(async () => root.unmount());
  }
}

it("restores a maximized window and reflects native resize state", async () => {
  await mounted(async (host) => {
    await act(async () => native.resize(true, false));
    const restore = host.querySelector<HTMLButtonElement>('[aria-label="Restore window"]')!;
    expect(restore).not.toBeNull();
    await act(async () => restore.click());
    expect(native.window.toggleMaximize).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="Maximize window"]')).not.toBeNull();
  });
});

it("exits fullscreen through Restore without maximizing the normal window", async () => {
  await mounted(async (host) => {
    expect(host.querySelector('[aria-label="Full screen"]')).toBeNull();
    await act(async () => native.resize(false, true));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Restore window"]')!.click(),
    );
    expect(native.window.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(native.window.toggleMaximize).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Maximize window"]')).not.toBeNull();
  });
});

it("toggles fullscreen from the footer and switches to the inward restore icon", async () => {
  await mounted(async (host) => {
    const button = host.querySelector<HTMLButtonElement>("button")!;
    const expandPath = button.querySelector("path")!.getAttribute("d");
    expect(button.title).toContain("F11");
    await act(async () => button.click());
    expect(native.window.setFullscreen).toHaveBeenLastCalledWith(true);
    expect(button.getAttribute("aria-label")).toBe("Restore window");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector("path")!.getAttribute("d")).not.toBe(expandPath);
    await act(async () => button.click());
    expect(native.window.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(button.getAttribute("aria-label")).toBe("Full screen");
    expect(button.querySelector("path")!.getAttribute("d")).toBe(expandPath);
  }, FullscreenButton);
});

it("tracks native fullscreen changes and keeps its state when a native action fails", async () => {
  await mounted(async (host) => {
    const button = host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => native.resize(false, true));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    native.window.setFullscreen.mockRejectedValueOnce(new Error("Fullscreen unavailable"));
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "Fullscreen unavailable",
    );
    await act(async () => native.resize(false, false));
    expect(button.getAttribute("aria-pressed")).toBe("false");
  }, FullscreenButton);
});

it("routes minimize and close through native controls so lifecycle guards run", async () => {
  await mounted(async (host) => {
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click(),
    );
    expect(native.window.minimize).toHaveBeenCalledOnce();
    expect(native.window.close).toHaveBeenCalledOnce();
  });
});
