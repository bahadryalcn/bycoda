// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decorativeMotionEnabled,
  subscribeDecorativeMotion,
  windowHasFocus,
} from "./decorativeMotion";

const native = vi.hoisted(() => ({
  isVisible: vi.fn(async () => true),
  isMinimized: vi.fn(async () => false),
  isFocused: vi.fn(async () => true),
  onFocusChanged: vi.fn(),
  onResized: vi.fn(),
}));
const platform = vi.hoisted(() => ({ mac: true }));
vi.mock("../../../platform/tauri/platform", async (load) => ({
  ...(await load<typeof import("../../../platform/tauri/platform")>()),
  get IS_MAC() {
    return platform.mac;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
let focus: (event: { payload: boolean }) => void;
let resize: () => void;
let stop: (() => void) | undefined;
const releaseFocus = vi.fn(),
  releaseResize = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  platform.mac = true;
  localStorage.clear();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  native.isVisible.mockResolvedValue(true);
  native.isMinimized.mockResolvedValue(false);
  native.isFocused.mockResolvedValue(true);
  native.onFocusChanged.mockImplementation(async (fn) => {
    focus = fn;
    return releaseFocus;
  });
  native.onResized.mockImplementation(async (fn) => {
    resize = fn;
    return releaseResize;
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});
// Native reads are shared and coalesced, so drain the whole microtask queue.
const flush = async () => {
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
};

it("keeps visible motion running through native and DOM blur", async () => {
  native.isFocused.mockResolvedValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  stop = subscribeDecorativeMotion(vi.fn());
  focus({ payload: false });
  window.dispatchEvent(new Event("blur"));
  await flush();
  expect(document.hidden).toBe(false);
  expect(decorativeMotionEnabled()).toBe(true);
  expect(document.documentElement.dataset.decorativeMotion).toBe("on");
  focus({ payload: true });
  await flush();
  expect(decorativeMotionEnabled()).toBe(true);
});

it("pauses for native hide/minimize and resumes while still unfocused", async () => {
  native.isFocused.mockResolvedValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  stop = subscribeDecorativeMotion(vi.fn());
  await flush();
  native.isMinimized.mockResolvedValue(true);
  resize();
  await flush();
  expect(decorativeMotionEnabled()).toBe(false);
  native.isMinimized.mockResolvedValue(false);
  native.isVisible.mockResolvedValue(false);
  resize();
  await flush();
  expect(decorativeMotionEnabled()).toBe(false);
  native.isVisible.mockResolvedValue(true);
  resize();
  await flush();
  expect(decorativeMotionEnabled()).toBe(true);
  stop();
  stop = undefined;
  expect(releaseFocus).toHaveBeenCalledOnce();
  expect(releaseResize).toHaveBeenCalledOnce();
});

it("releases native listeners registered after the last consumer leaves", async () => {
  let complete!: (release: () => void) => void;
  native.onFocusChanged.mockReturnValueOnce(
    new Promise<() => void>((resolve) => {
      complete = resolve;
    }),
  );
  stop = subscribeDecorativeMotion(vi.fn());
  stop();
  stop = undefined;
  complete(releaseFocus);
  await flush();
  expect(releaseFocus).toHaveBeenCalledOnce();
});

it("pauses focus-gated work from the native focus state, not the DOM focus WKWebView keeps", async () => {
  const listener = vi.fn();
  stop = subscribeDecorativeMotion(listener);
  await flush();
  expect(windowHasFocus()).toBe(true);
  expect(native.onFocusChanged).toHaveBeenCalledOnce();
  const reads = native.isFocused.mock.calls.length;
  // The DOM still reports focus after the window drops behind another app.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  native.isFocused.mockResolvedValue(false);
  listener.mockClear();
  focus({ payload: false });
  expect(windowHasFocus()).toBe(false);
  expect(document.documentElement.dataset.windowFocus).toBe("off");
  expect(listener).toHaveBeenCalledOnce();
  await flush();
  expect(windowHasFocus()).toBe(false);
  // The follow-up read is the only extra query; no second subscription was made.
  expect(native.isFocused.mock.calls.length).toBe(reads + 1);
  expect(native.onFocusChanged).toHaveBeenCalledOnce();
  // Decorative CSS motion keeps its own rules: unfocused is not hidden.
  expect(decorativeMotionEnabled()).toBe(true);
  native.isFocused.mockResolvedValue(true);
  focus({ payload: true });
  await flush();
  expect(windowHasFocus()).toBe(true);
  expect(document.documentElement.dataset.windowFocus).toBe("on");
});

it("trusts the page's focus on Windows, where WebView2 takes focus from the native window", async () => {
  platform.mac = false;
  const listener = vi.fn();
  stop = subscribeDecorativeMotion(listener);
  await flush();
  // tao reports the window unfocused once its WebView2 child has keyboard focus.
  native.isFocused.mockResolvedValue(false);
  focus({ payload: false });
  await flush();
  expect(windowHasFocus()).toBe(true);
  expect(document.documentElement.dataset.windowFocus).toBe("on");
  // Another application in front blurs the page.
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(windowHasFocus()).toBe(false);
  expect(document.documentElement.dataset.windowFocus).toBe("off");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  expect(windowHasFocus()).toBe(true);
});

it("stays focused when focus moves into an iframe on the page", async () => {
  platform.mac = false;
  stop = subscribeDecorativeMotion(vi.fn());
  await flush();
  // The window blurs, but the document (and its iframe) keeps focus.
  window.dispatchEvent(new Event("blur"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(windowHasFocus()).toBe(true);
});

it("does not wake subscribers for resize storms that change nothing", async () => {
  const listener = vi.fn();
  stop = subscribeDecorativeMotion(listener);
  await flush();
  listener.mockClear();
  for (let i = 0; i < 20; i++) resize();
  await flush();
  expect(listener).not.toHaveBeenCalled();
});
