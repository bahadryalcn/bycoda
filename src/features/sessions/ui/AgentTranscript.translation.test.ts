// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { registerHarness } from "../../../integrations/harness/core/registry";
import { codexAdapter } from "../../../integrations/harness/providers/codex/codexAdapter";
import { copyMessage } from "../../../platform/tauri/clipboard";
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyMessage: vi.fn().mockResolvedValue(undefined),
}));
import {
  saveDefaultTranslationChoice,
  saveDefaultRepromptChoice,
} from "../model/translationPreferences";

it.each([
  ["Translate to English", "Apply translation"],
  ["Reprompt", "Apply prompt"],
])(
  "previews %s for selected message text and reverses approved display without changing the saved block",
  async (action, applyLabel) => {
    vi.mocked(copyMessage).mockClear();
    const saveChoice =
      action === "Reprompt" ? saveDefaultRepromptChoice : saveDefaultTranslationChoice;
    saveChoice({ harness: "codex", model: "codex:gpt-6.1", providerAccountId: "chosen" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const run = vi.fn(async () => "Hello");
    registerHarness({ ...codexAdapter, runTextPrompt: run });
    const block = { id: "prompt", role: "user" as const, text: "Before Merhaba after" };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(AgentTranscript, {
            blocks: [block],
            cwd: "/project",
            harness: "codex",
            providerAccountId: "chosen",
          }),
        ),
      );
      const node = container.querySelector("pre")!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 7);
      range.setEnd(node, 14);
      vi.spyOn(range, "getClientRects").mockReturnValue({ length: 0 } as DOMRectList);
      vi.spyOn(range, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 120, 20));
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      await act(async () => {
        document.dispatchEvent(new Event("selectionchange"));
        await new Promise((done) => requestAnimationFrame(done));
      });
      expect(run).not.toHaveBeenCalled();
      const translate = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
      ].find((button) => button.textContent?.includes(action))!;
      await act(async () => translate.click());
      expect(container.querySelector("pre")?.textContent).toBe(block.text);
      const apply = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find((button) => button.textContent === applyLabel)!;
      await act(async () => apply.click());
      expect(container.querySelector("pre")?.textContent).toBe("Before Hello after");
      const scroller = container.querySelector<HTMLElement>(".agent-transcript")!;
      for (const [key, expected] of [
        ["ArrowUp", block.text],
        ["ArrowDown", "Before Hello after"],
      ]) {
        await act(async () =>
          scroller.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          ),
        );
        expect(container.querySelector("pre")?.textContent).toBe(expected);
      }
      expect(block.text).toBe("Before Merhaba after");
      const copy = [...scroller.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Copy",
      )!;
      await act(async () => copy.click());
      expect(copyMessage).toHaveBeenCalledWith("Before Hello after");
      const close = [...scroller.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Close translation",
      )!;
      act(() => close.click());
      expect(container.querySelector("pre")?.textContent).toBe("Before Hello after");
      expect(scroller.textContent).not.toContain("After applying:");
      expect(scroller.querySelector('button[aria-label="Close translation"]')).toBeNull();
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ providerAccountId: "chosen" }));
    } finally {
      saveChoice(undefined);
      act(() => root.unmount());
      container.remove();
      window.getSelection()?.removeAllRanges();
      registerHarness(codexAdapter);
      vi.unstubAllGlobals();
    }
  },
);
