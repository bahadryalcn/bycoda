// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalTerminalSuggestions } from "./LocalTerminalSuggestions";

const native = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../platform/tauri/pty", () => ({ getPtySuggestions: native.get }));
vi.mock("./TerminalGhostText", () => ({
  TerminalGhostText: ({ suffix }: { suffix: string }) =>
    createElement("span", { "data-ghost": true }, suffix),
}));
vi.mock("./TerminalCursorPopover", () => ({
  TerminalCursorPopover: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));

let root: Root;
let host: HTMLElement;
let element: HTMLElement;
let line: string;
let data: (value: string) => void;
let parsed: () => void;
let resized: () => void;
let scrolled: () => void;
let paste: ReturnType<typeof vi.fn>;
let terminal: Terminal;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  native.get.mockReset().mockResolvedValue([]);
  host = document.createElement("div");
  element = document.createElement("textarea");
  document.body.append(host, element);
  root = createRoot(host);
  line = "$ ";
  const disposable = { dispose() {} };
  paste = vi.fn();
  terminal = {
    element,
    paste,
    focus: () => element.focus(),
    onData: (fn: typeof data) => {
      data = fn;
      return disposable;
    },
    onWriteParsed: (fn: typeof parsed) => {
      parsed = fn;
      return disposable;
    },
    onScroll: (fn: () => void) => { scrolled = fn; return disposable; },
    onResize: (fn: () => void) => { resized = fn; return disposable; },
    buffer: {
      onBufferChange: () => disposable,
      active: {
        type: "normal",
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        get cursorX() {
          return line.length;
        },
        getLine: () => ({
          isWrapped: false,
          translateToString: (trim: boolean, start = 0, end = line.length) => {
            const value = line.slice(start, end);
            return trim ? value.trimEnd() : value;
          },
        }),
      },
    },
  } as unknown as Terminal;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(explicit = false) {
  await act(async () =>
    root.render(
      createElement(LocalTerminalSuggestions, {
        terminal,
        terminalId: "local",
        explicit,
        onClose: () => {},
      }),
    ),
  );
  element.focus();
}
async function type(value: string) {
  await act(async () => {
    data(value);
    line = `$ ${value}`;
    parsed();
  });
}
async function key(value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

it("shows a suffix and completes with Tab without executing; ordinary Enter keeps the typed command", async () => {
  await mount();
  await type("git s");
  expect(host.querySelector("[data-ghost]")?.textContent).toBe("tatus");
  expect(await key("Tab")).toBe(true);
  expect(paste).toHaveBeenCalledExactlyOnceWith("tatus");
  await type("git s");
  expect(await key("Enter")).toBe(false);
  expect(paste).toHaveBeenCalledTimes(1);
});

it("preserves the keyboard choice when native suggestions arrive late", async () => {
  let resolve!: (values: string[]) => void;
  native.get.mockImplementation(() => new Promise<string[]>((done) => { resolve = done; }));
  await mount(true);
  await type("git ");
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  await key("ArrowDown");
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("git diff");
  await act(async () => resolve(["git status", "git diff", "git log"]));
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("git diff");
  await key("Tab");
  expect(paste).toHaveBeenCalledExactlyOnceWith("diff");
});

it("retains suggestions when terminal fitting or scrolling keeps the prompt visible", async () => {
  await mount();
  await type("git s");
  await act(async () => { resized(); scrolled(); });
  expect(host.querySelector("[data-ghost]")?.textContent).toBe("tatus");
  expect(await key("Tab")).toBe(true);
  expect(paste).toHaveBeenCalledExactlyOnceWith("tatus");
});

it("rejects delayed responses after an edit or focus loss", async () => {
  let resolve!: (values: string[]) => void;
  native.get.mockImplementationOnce(
    () =>
      new Promise<string[]>((done) => {
        resolve = done;
      }),
  );
  await mount();
  await type("custom");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await type("other");
  await act(async () => resolve(["custom --old"]));
  expect(host.querySelector("[data-ghost]")).toBeNull();
  await act(async () => {
    element.blur();
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(native.get).toHaveBeenCalledTimes(1);
});

it("learns submitted local commands in memory and excludes sensitive and multiline input", async () => {
  await mount();
  await type("custom-tool --check");
  expect(await key("Enter")).toBe(false);
  await type("custom");
  expect(host.querySelector("[data-ghost]")?.textContent).toBe("-tool --check");
  await type("tool --token abc");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(host.querySelector("[data-ghost]")).toBeNull();
  await type("custom\nother");
  expect(host.querySelector("[data-ghost]")).toBeNull();
  expect(native.get).not.toHaveBeenCalled();
});
