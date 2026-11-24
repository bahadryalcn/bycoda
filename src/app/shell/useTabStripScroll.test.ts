// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTabStripScroll } from "./useTabStripScroll";

it("switches fitting tabs without measuring the strip and still reveals overflowing tabs", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const strip = document.createElement("div");
  const scrollIntoView = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  const width = vi.fn(() => 400);
  let contentWidth = 320;
  Object.defineProperties(strip, {
    clientWidth: { get: width },
    scrollWidth: { get: () => contentWidth },
  });
  const root = createRoot(host);
  function Fixture({
    id,
    dragging = false,
    tabCount = 3,
  }: {
    id: string;
    dragging?: boolean;
    tabCount?: number;
  }) {
    const tabStripRef = useRef(strip);
    const { activeTabRef, tabOverflow } = useTabStripScroll({
      tabStripRef,
      tabCount,
      activeId: id,
      dragging,
    });
    return createElement("div", { ref: activeTabRef }, String(tabOverflow.right));
  }
  try {
    act(() => root.render(createElement(Fixture, { id: "a" })));
    width.mockClear();
    scrollIntoView.mockClear();
    act(() => root.render(createElement(Fixture, { id: "b" })));
    expect(width).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    contentWidth = 640;
    act(() => root.render(createElement(Fixture, { id: "b", tabCount: 4 })));
    expect(host.textContent).toBe("true");
    scrollIntoView.mockClear();
    act(() => root.render(createElement(Fixture, { id: "c", tabCount: 4, dragging: true })));
    expect(scrollIntoView).not.toHaveBeenCalled();
    act(() => root.render(createElement(Fixture, { id: "c", tabCount: 4 })));
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    strip.scrollLeft = 240;
    act(() => {
      strip.dispatchEvent(new Event("scroll"));
    });
    expect(host.textContent).toBe("false");
  } finally {
    act(() => root.unmount());
    scrollIntoView.mockRestore();
    vi.unstubAllGlobals();
  }
});
