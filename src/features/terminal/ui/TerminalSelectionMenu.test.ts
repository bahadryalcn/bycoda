// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { TerminalSelectionMenu } from "./TerminalSelectionMenu";
const notes = vi.hoisted(() => ({ enabled: false, createNote: vi.fn(async () => {}) }));
vi.mock("../../notes", () => ({ createNote: notes.createNote, noteTitle: (text: string) => text }));
vi.mock("../../settings/model/settings", () => ({
  loadNotesEnabled: () => notes.enabled,
  subscribeNotesEnabled: () => () => {},
}));

it("subscribes when xterm is ready, waits for drag completion and clears only the selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 400, 300));
  const root = createRoot(container);
  const onAdd = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
  let changed = () => {};
  let scrolled = () => {};
  const dispose = vi.fn();
  const clearSelection = vi.fn();
  const terminal = {
    getSelection: () => "Error: build failed",
    getSelectionPosition: () => ({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
    buffer: { active: { viewportY: 0 } },
    cols: 80,
    rows: 24,
    clearSelection,
    onSelectionChange: (listener: () => void) => {
      changed = listener;
      return { dispose };
    },
    onScroll: (listener: () => void) => {
      scrolled = listener;
      return { dispose };
    },
  } as unknown as Terminal;
  const render = (term: Terminal | null, active = true) =>
    root.render(
      createElement(TerminalSelectionMenu, {
        terminal: term,
        host: { current: host },
        active,
        cwd: "project",
      }),
    );
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
  try {
    await act(async () => render(null));
    await act(async () => render(terminal));
    await act(async () => {
      host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      changed();
      await wait();
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerup", { clientX: 80, clientY: 60 }));
      await wait();
    });
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Add to chat"]')!
        .click(),
    );
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: "Error: build failed",
      mode: "quote",
    });
    expect(clearSelection).toHaveBeenCalledOnce();
    await act(async () => {
      changed();
      await wait();
    });
    await act(async () => scrolled());
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => {
      changed();
      await wait();
    });
    await act(async () => render(terminal, false));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
    container.remove();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("sends the exact selected text, trimming only to decide whether anything is selected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notes.enabled = true;
  const container = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(container, host);
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 400, 300));
  const root = createRoot(container);
  const indented = "    if ready:\n        run()\n";
  let selected = indented;
  let changed = () => {};
  const terminal = {
    getSelection: () => selected,
    getSelectionPosition: () => ({ start: { x: 0, y: 0 }, end: { x: 10, y: 1 } }),
    buffer: { active: { viewportY: 0 } },
    cols: 80,
    rows: 24,
    clearSelection: vi.fn(),
    onSelectionChange: (listener: () => void) => {
      changed = listener;
      return { dispose: () => {} };
    },
    onScroll: () => ({ dispose: () => {} }),
  } as unknown as Terminal;
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
  try {
    await act(async () =>
      root.render(
        createElement(TerminalSelectionMenu, {
          terminal,
          host: { current: host },
          active: true,
          cwd: "project",
        }),
      ),
    );
    await act(async () => {
      changed();
      await wait();
    });
    const toolbarButtons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'));
    expect(toolbarButtons().length).toBeGreaterThan(0);
    const notesButton = toolbarButtons().find((button) =>
      /notes/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""),
    )!;
    await act(async () => notesButton.click());
    expect(notes.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ body: indented, sourceCwd: "project" }),
    );
    // A whitespace-only selection is still treated as empty.
    selected = "   \n  ";
    await act(async () => {
      changed();
      await wait();
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  } finally {
    notes.enabled = false;
    await act(async () => root.unmount());
    container.remove();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
