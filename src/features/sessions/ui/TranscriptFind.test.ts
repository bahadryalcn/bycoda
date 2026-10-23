// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MOD } from "../../../platform/tauri/platform";
import { saveKeybindingOverride } from "../../settings/model/settings";
import { TranscriptFind } from "./TranscriptFind";

it("keeps one keyboard binding across streamed renders and reads the latest navigation callback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const previous = vi.fn(() => true);
  const latest = vi.fn(() => true);
  try {
    const draw = (onNavigate: typeof latest) =>
      act(async () =>
        root.render(
          createElement(TranscriptFind, {
            blocks: [],
            visible: true,
            focused: true,
            onNavigate,
          }),
        ),
      );
    await draw(previous);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    add.mockClear();
    remove.mockClear();
    await draw(latest);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    expect(remove.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(latest).toHaveBeenCalledWith(null);
    expect(previous).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    add.mockRestore();
    remove.mockRestore();
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "keeps find bindings and mouse access with a header trigger: %s",
  async (inHeader) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    localStorage.clear();
    const container = document.createElement("div");
    const header = document.createElement("div");
    document.body.append(header, container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(TranscriptFind, {
            blocks: [],
            visible: true,
            focused: true,
            triggerContainer: inHeader ? header : undefined,
            onNavigate: () => true,
          }),
        ),
      );
      const launcher = () =>
        (inHeader ? header : container).querySelector<HTMLButtonElement>("button")!;
      if (inHeader) expect(container.querySelector("button")).toBeNull();
      expect(launcher().title).toBe(`Find in conversation (${MOD}F)`);
      await act(async () => {
        saveKeybindingOverride("Editor: Find", { shortcut: "Control+Shift+KeyM" });
      });
      expect(launcher().title).toContain("M)");
      await act(async () => {
        saveKeybindingOverride("Editor: Find", { disabled: true });
      });
      expect(launcher().title).toBe("Find in conversation");
      await act(async () => launcher().click());
      if (inHeader) expect(launcher().getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector('[role="search"]')).not.toBeNull();
      expect(container.querySelector('[title="Next match (Enter / F3)"]')).not.toBeNull();
      const close = container.querySelector<HTMLButtonElement>('[title="Close find (Esc)"]')!;
      await act(async () => close.click());
      expect(launcher().title).toBe("Find in conversation");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      header.remove();
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  },
);
