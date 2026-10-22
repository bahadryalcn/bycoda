// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { PreviewSelection } from "./PreviewSelection";

it("offers Markdown selection near the text, adds its path to chat and dismisses on scroll", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => new DOMRect(50, 60, 90, 20),
  } as DOMRectList);
  try {
    await act(async () =>
      root.render(
        createElement(
          PreviewSelection,
          { active: true, path: "README.md", contentVersion: "hello" },
          createElement("p", null, "Hello preview"),
        ),
      ),
    );
    const select = async () => {
      const range = document.createRange();
      range.selectNodeContents(container.querySelector("p")!);
      await act(async () => {
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
    };
    await select();
    const button = document.querySelector<HTMLButtonElement>('[role="toolbar"] button')!;
    expect(button.textContent).toContain("Add to chat");
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: "@README.md\n\nHello preview",
      mode: "quote",
    });
    await select();
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
