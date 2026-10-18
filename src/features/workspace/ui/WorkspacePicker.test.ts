// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorktreeBasePicker } from "./WorkspacePicker";

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
const close = vi.fn();
const input = () =>
  document.querySelector<HTMLInputElement>('[aria-label="Search base branches"]')!;
function press(key: string, flags: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...flags });
  input().dispatchEvent(event);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  change.mockReset();
  close.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(WorktreeBasePicker, {
        branches: [
          { name: "main", remote: null },
          { name: "develop", remote: null },
        ],
        selected: "develop",
        loading: false,
        enabled: true,
        initialOpen: true,
        onChange: change,
        onClose: close,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "leaves IME keys to composition (%j), then accepts a separate explicit choice",
  async (flags) => {
    expect(input()).not.toBeNull();
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      await act(async () => {
        expect(press(key, flags).defaultPrevented).toBe(false);
      });
      expect(input()).not.toBeNull();
      expect(change).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    }
    await act(async () => {
      input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      press("Enter");
    });
    expect(change).toHaveBeenCalledExactlyOnceWith("main");
    expect(close).toHaveBeenCalledTimes(1);
    expect(input()).toBeNull();
  },
);

it("retains ordinary arrow selection", async () => {
  await act(async () => {
    press("ArrowDown");
  });
  await act(async () => {
    press("Enter");
  });
  expect(change).toHaveBeenCalledExactlyOnceWith("develop");
});

it("dismisses with a non-composition Escape without selecting", async () => {
  await act(async () => {
    press("Escape");
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(change).not.toHaveBeenCalled();
  expect(input()).toBeNull();
});
