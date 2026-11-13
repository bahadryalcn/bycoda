// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { bindDictationShortcut, type DictationShortcutMode } from "./dictationShortcut";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
function setup(mode: DictationShortcutMode = "auto") {
  const callbacks = {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    focused: vi.fn(() => true),
    active: vi.fn(() => false),
  };
  dispose = bindDictationShortcut(window, {
    ...callbacks,
    mode: () => mode,
    matches: (event) => event.key === "d" && event.ctrlKey,
  });
  return callbacks;
}
const press = (extra = {}) =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      ctrlKey: true,
      cancelable: true,
      ...extra,
    }),
  );
const release = () =>
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", code: "KeyD", cancelable: true }));

it("auto keeps a tap listening and finishes a hold even after modifiers release", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const callbacks = setup();
  press();
  clock.mockReturnValue(100);
  release();
  expect(callbacks.start).toHaveBeenCalledOnce();
  expect(callbacks.stop).not.toHaveBeenCalled();
  press();
  clock.mockReturnValue(500);
  release();
  expect(callbacks.stop).toHaveBeenCalledOnce();
});
it("hold stops on release while toggle waits for the next press", () => {
  let callbacks = setup("hold");
  press();
  release();
  expect(callbacks.stop).toHaveBeenCalledOnce();
  dispose?.();
  callbacks = setup("toggle");
  press();
  release();
  expect(callbacks.stop).not.toHaveBeenCalled();
  callbacks.active.mockReturnValue(true);
  press();
  expect(callbacks.stop).toHaveBeenCalledOnce();
});
it("ignores IME, repeats, handled events and other composers", () => {
  const callbacks = setup();
  press({ isComposing: true });
  press({ repeat: true });
  const handled = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, cancelable: true });
  handled.preventDefault();
  window.dispatchEvent(handled);
  callbacks.focused.mockReturnValue(false);
  press();
  expect(callbacks.start).not.toHaveBeenCalled();
});
it("cancels held capture on window blur without committing text", () => {
  const callbacks = setup("hold");
  press();
  window.dispatchEvent(new Event("blur"));
  release();
  expect(callbacks.cancel).toHaveBeenCalledOnce();
  expect(callbacks.stop).not.toHaveBeenCalled();
});
