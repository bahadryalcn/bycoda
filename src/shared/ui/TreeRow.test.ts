// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TreeRow } from "./TreeRow";
it("preserves native focus/ref, keyboard, pointer and drag ownership without synthesizing selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    ref = createRef<HTMLButtonElement>(),
    key = vi.fn(),
    pointer = vi.fn(),
    drag = vi.fn(),
    click = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(
          TreeRow,
          {
            ref,
            depth: 3,
            selected: true,
            cut: true,
            dropTarget: true,
            draggable: true,
            "aria-expanded": false,
            onKeyDown: key,
            onPointerDown: pointer,
            onDragStart: drag,
            onClick: click,
          },
          "file.ts",
        ),
      ),
    );
    const node = ref.current!;
    expect(node.tagName).toBe("BUTTON");
    expect(node.getAttribute("role")).toBe("treeitem");
    expect(node.getAttribute("aria-level")).toBe("4");
    expect(node.getAttribute("aria-expanded")).toBe("false");
    expect(node.getAttribute("aria-selected")).toBe("true");
    expect(node.dataset.treeCut).toBe("true");
    expect(node.dataset.treeDropTarget).toBe("true");
    node.focus();
    expect(document.activeElement).toBe(node);
    await act(async () => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      node.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      node.dispatchEvent(new Event("dragstart", { bubbles: true }));
      node.click();
    });
    expect(key).toHaveBeenCalledOnce();
    expect(pointer).toHaveBeenCalledOnce();
    expect(drag).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(node.getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      root.render(
        createElement(
          TreeRow,
          {
            ref,
            depth: -20,
            selected: false,
            disabled: true,
            onClick: click,
            role: "button",
            "aria-level": 9,
          },
          "disabled",
        ),
      ),
    );
    expect(ref.current).toBe(node);
    expect(node.getAttribute("role")).toBe("button");
    expect(node.getAttribute("aria-level")).toBe("9");
    expect(node.style.getPropertyValue("--tree-row-depth")).toBe("0");
    node.click();
    expect(click).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
