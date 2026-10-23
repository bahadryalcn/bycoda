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
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
let focus: (event: { payload: boolean }) => void;
let resize: () => void;
let stop: (() => void) | undefined;
const releaseFocus = vi.fn(),
  releaseResize = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
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
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
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

it("tracks window focus from the native event so canvas loops can pause unfocused", async () => {
  stop = subscribeDecorativeMotion(vi.fn());
  await flush();
  expect(windowHasFocus()).toBe(true);
  // WKWebView keeps document.hasFocus() true after the window drops behind another app.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  native.isFocused.mockResolvedValue(false);
  focus({ payload: false });
  expect(windowHasFocus()).toBe(false);
  await flush();
  expect(windowHasFocus()).toBe(false);
  // Decorative CSS motion is unaffected by focus; only the window's visibility gates it.
  expect(decorativeMotionEnabled()).toBe(true);
  native.isFocused.mockResolvedValue(true);
  focus({ payload: true });
  await flush();
  expect(windowHasFocus()).toBe(true);
  // A later native query (after a resize) keeps the gate in step as well.
  native.isFocused.mockResolvedValue(false);
  resize();
  await flush();
  expect(windowHasFocus()).toBe(false);
});
