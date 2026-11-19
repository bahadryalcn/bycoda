// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuBar } from "./MenuBar";

let container: HTMLDivElement;
let root: Root;
let input: HTMLInputElement;

function keyOn(target: EventTarget, type: "keydown" | "keyup", key: string, init = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init }));
  });
}

function tapAlt(init = {}) {
  keyOn(window, "keydown", "Alt", init);
  keyOn(window, "keyup", "Alt", init);
}

function bar() {
  return container.querySelector<HTMLElement>('[role="menubar"]');
}

function button(key: string) {
  return container.querySelector<HTMLButtonElement>(`[data-menubar-key="${key}"]`)!;
}

function menu() {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  input = document.createElement("input");
  document.body.append(input, container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(MenuBar, {
        onNew: vi.fn(),
        onToggleSidebar: vi.fn(),
        onToggleSessionSidebar: vi.fn(),
      }),
    ),
  );
  input.focus();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  input.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("application menu bar keyboard model", () => {
  it("shows as a named menubar and moves focus to the first menu on an Alt tap", () => {
    expect(bar()).toBeNull();
    tapAlt();
    expect(bar()?.getAttribute("aria-label")).toBeTruthy();
    expect(document.activeElement).toBe(button("file"));
    expect(button("file").getAttribute("role")).toBe("menuitem");
  });

  it("keeps a single roving tab stop that follows focus", () => {
    tapAlt();
    expect(button("file").tabIndex).toBe(0);
    expect(button("view").tabIndex).toBe(-1);
    keyOn(button("file"), "keydown", "ArrowRight");
    expect(document.activeElement).toBe(button("view"));
    expect(button("view").tabIndex).toBe(0);
    expect(button("file").tabIndex).toBe(-1);
  });

  it("moves between menus with Left/Right (wrapping) and Home/End", () => {
    tapAlt();
    keyOn(button("file"), "keydown", "ArrowLeft");
    expect(document.activeElement).toBe(button("terminal"));
    keyOn(button("terminal"), "keydown", "ArrowRight");
    expect(document.activeElement).toBe(button("file"));
    keyOn(button("file"), "keydown", "End");
    expect(document.activeElement).toBe(button("terminal"));
    keyOn(button("terminal"), "keydown", "Home");
    expect(document.activeElement).toBe(button("file"));
  });

  it("opens the focused menu with Down and opens the neighbour with Right while open", () => {
    tapAlt();
    keyOn(button("file"), "keydown", "ArrowDown");
    expect(menu()?.getAttribute("aria-label")).toBe(button("file").textContent);
    expect(button("file").getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.contains(document.activeElement)).toBe(true);

    keyOn(menu()!, "keydown", "ArrowRight");
    expect(button("view").getAttribute("aria-expanded")).toBe("true");
    expect(button("file").getAttribute("aria-expanded")).toBe("false");
    expect(menu()?.getAttribute("aria-label")).toBe(button("view").textContent);

    keyOn(menu()!, "keydown", "ArrowLeft");
    expect(button("file").getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the open menu on Escape first, then hides the bar and returns focus", () => {
    tapAlt();
    keyOn(button("file"), "keydown", "ArrowDown");
    keyOn(window, "keydown", "Escape");
    expect(menu()).toBeNull();
    expect(bar()).not.toBeNull();

    keyOn(button("file"), "keydown", "Escape");
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("returns focus to the previous element when Alt hides the bar again", () => {
    tapAlt();
    tapAlt();
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("leaves Alt and F10 to the IME while it is composing", () => {
    tapAlt({ isComposing: true });
    expect(bar()).toBeNull();
    keyOn(window, "keydown", "F10", { keyCode: 229 });
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("ignores menubar keys that arrive during an IME composition", () => {
    tapAlt();
    keyOn(button("file"), "keydown", "ArrowRight", { isComposing: true });
    expect(document.activeElement).toBe(button("file"));
  });

  it("still toggles with F10 and keeps focus in place when an Alt chord is used", () => {
    keyOn(input, "keydown", "F10");
    expect(bar()).not.toBeNull();
    expect(document.activeElement).toBe(button("file"));
    keyOn(button("file"), "keydown", "F10");
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(input);

    keyOn(window, "keydown", "Alt");
    keyOn(window, "keydown", "d", { altKey: true });
    keyOn(window, "keyup", "Alt");
    expect(bar()).toBeNull();
  });

  it("does not treat an Alt+pointer gesture as a standalone Alt tap", () => {
    keyOn(window, "keydown", "Alt", { altKey: true });
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    keyOn(window, "keyup", "Alt");
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(input);

    tapAlt();
    expect(bar()).not.toBeNull();
  });
});
