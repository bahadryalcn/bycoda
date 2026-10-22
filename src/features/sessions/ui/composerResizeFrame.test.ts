import { afterEach, describe, expect, it, vi } from "vitest";
import { createComposerResizeFrame } from "./composerResizeFrame";
afterEach(() => vi.unstubAllGlobals());
describe("composer resize scheduling", () => {
  it("coalesces inputs using the current value without touching the caret", () => {
    let callback: FrameRequestCallback = () => {};
    const raf = vi.fn((cb: FrameRequestCallback) => {
      callback = cb;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const field = {
      isConnected: true,
      value: "a",
      style: { height: "" },
      scrollHeight: 44,
      selectionStart: 1,
    } as HTMLTextAreaElement;
    const scheduler = createComposerResizeFrame();
    scheduler.schedule(field);
    field.value = "ab";
    scheduler.schedule(field);
    expect(raf).toHaveBeenCalledTimes(1);
    callback(0);
    expect(field.style.height).toBe("44px");
    expect(field.selectionStart).toBe(1);
  });
  it("cancels pending work on unmount", () => {
    vi.stubGlobal("requestAnimationFrame", () => 7);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const scheduler = createComposerResizeFrame();
    scheduler.schedule({} as HTMLTextAreaElement);
    scheduler.cancel();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
