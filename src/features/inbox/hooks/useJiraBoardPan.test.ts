// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useJiraBoardPan } from "./useJiraBoardPan";

it("pans nested vertical and outer horizontal owners from SVG content, releases capture and preserves primary/touch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function View() {
    return createElement(
      "div",
      { ...useJiraBoardPan(), "data-pan": "" },
      createElement(
        "div",
        { "data-scroll": "" },
        createElement("svg", null, createElement("path")),
      ),
    );
  }
  try {
    await act(async () => root.render(createElement(View)));
    const board = host.querySelector<HTMLElement>("[data-pan]")!;
    const column = host.querySelector<HTMLElement>("[data-scroll]")!;
    const path = host.querySelector("path")!;
    for (const [node, width, height, clientWidth, clientHeight] of [
      [board, 1200, 400, 500, 400],
      [column, 200, 1000, 200, 300],
    ] as const) {
      Object.defineProperties(node, {
        scrollWidth: { value: width },
        scrollHeight: { value: height },
        clientWidth: { value: clientWidth },
        clientHeight: { value: clientHeight },
      });
    }
    board.scrollLeft = 50;
    column.scrollTop = 80;
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(board, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    });
    const send = async (type: string, options: PointerEventInit = {}) =>
      act(async () => {
        path.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: "mouse",
            button: 1,
            clientX: 100,
            clientY: 100,
            ...options,
          }),
        );
      });
    await send("pointerdown", { button: 0 });
    await send("pointerdown", { pointerType: "touch" });
    expect(capture).not.toHaveBeenCalled();
    await send("pointerdown");
    await send("pointermove", { clientX: 70, clientY: 50 });
    expect(board.scrollLeft).toBe(80);
    expect(column.scrollTop).toBe(130);
    expect(capture).toHaveBeenCalledExactlyOnceWith(7);
    await send("pointerup");
    expect(release).toHaveBeenCalledExactlyOnceWith(7);
    await send("pointermove", { clientX: 0, clientY: 0 });
    expect(board.scrollLeft).toBe(80);
    expect(column.scrollTop).toBe(130);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
