// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decorativeMotionEnabled,
  subscribeDecorativeMotion,
  motionWindowVisible,
} from "./decorativeMotion";
import { subscribeWindowState } from "../../../platform/tauri/windowState";

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
// Native reads are shared and coalesced, so drain the whole microtask queue.
const flush = async () => {
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
};

it("keeps visible motion running through native and DOM blur", async () => {
  const listener = vi.fn();
  stop = subscribeDecorativeMotion(listener);
  await flush();
  listener.mockClear();
  native.isFocused.mockResolvedValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  focus({ payload: false });
  window.dispatchEvent(new Event("blur"));
  await flush();
  expect(document.hidden).toBe(false);
  expect(motionWindowVisible()).toBe(true);
  expect(decorativeMotionEnabled()).toBe(true);
  expect(document.documentElement.dataset.windowVisible).toBe("on");
  expect(document.documentElement.dataset.decorativeMotion).toBe("on");
  expect(listener).not.toHaveBeenCalled();
});

it("pauses for native hide/minimize and resumes while still unfocused", async () => {
  native.isFocused.mockResolvedValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  stop = subscribeDecorativeMotion(vi.fn());
  await flush();
  native.isMinimized.mockResolvedValue(true);
  resize();
  await flush();
  expect(motionWindowVisible()).toBe(false);
  expect(document.documentElement.dataset.windowVisible).toBe("off");
  expect(decorativeMotionEnabled()).toBe(false);
  native.isMinimized.mockResolvedValue(false);
  native.isVisible.mockResolvedValue(false);
  resize();
  await flush();
  expect(decorativeMotionEnabled()).toBe(false);
  native.isVisible.mockResolvedValue(true);
  resize();
  await flush();
  expect(document.documentElement.dataset.windowVisible).toBe("on");
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

it("starts paused when another subscriber already knows the window is minimized", async () => {
  native.isMinimized.mockResolvedValue(true);
  const release = subscribeWindowState(vi.fn());
  try {
    await flush();
    stop = subscribeDecorativeMotion(vi.fn());
    expect(document.documentElement.dataset.windowVisible).toBe("off");
  } finally {
    release();
  }
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
