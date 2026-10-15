// @vitest-environment happy-dom
import { focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { installQueryLifecycle } from "./queryLifecycle";

const native = vi.hoisted(() => ({
  isVisible: vi.fn(async () => true),
  isMinimized: vi.fn(async () => false),
  isFocused: vi.fn(async () => true),
  onFocusChanged: vi.fn(),
  onResized: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

it("uses native focus when DOM visibility is stale and handles offline/online events", async () => {
  const releaseFocus = vi.fn(),
    releaseResize = vi.fn();
  let focus!: (event: { payload: boolean }) => void;
  let resize!: () => void;
  native.onFocusChanged.mockImplementation(async (listener) => {
    focus = listener;
    return releaseFocus;
  });
  native.onResized.mockImplementation(async (listener) => {
    resize = listener;
    return releaseResize;
  });
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  stop = installQueryLifecycle();
  await Promise.resolve();
  await Promise.resolve();
  expect(focusManager.isFocused()).toBe(true);
  // Native hide/minimize can leave WebView visibilityState at visible.
  focus({ payload: false });
  expect(focusManager.isFocused()).toBe(false);
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(focusManager.isFocused()).toBe(false);
  // A focused native window wins over a stale hidden DOM snapshot as well.
  focus({ payload: true });
  expect(focusManager.isFocused()).toBe(true);
  visibility.mockReturnValue("visible");
  native.isMinimized.mockResolvedValueOnce(true);
  resize();
  await Promise.resolve();
  await Promise.resolve();
  expect(focusManager.isFocused()).toBe(false);
  window.dispatchEvent(new Event("offline"));
  expect(onlineManager.isOnline()).toBe(false);
  window.dispatchEvent(new Event("online"));
  expect(onlineManager.isOnline()).toBe(true);
  stop();
  stop = undefined;
  expect(releaseFocus).toHaveBeenCalledOnce();
  expect(releaseResize).toHaveBeenCalledOnce();
});

it("releases subscriptions that finish registering after the provider is removed", async () => {
  let complete!: (release: () => void) => void;
  const release = vi.fn();
  native.onFocusChanged.mockReturnValue(
    new Promise<() => void>((resolve) => {
      complete = resolve;
    }),
  );
  native.onResized.mockResolvedValue(() => undefined);
  stop = installQueryLifecycle();
  stop();
  stop = undefined;
  complete(release);
  await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
});
