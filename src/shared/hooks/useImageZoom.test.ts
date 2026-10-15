// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useImageZoom, zoomImageAt } from "./useImageZoom";

describe("image gestures", () => {
  it("keeps the cursor's image point fixed when zooming, with bounded scale", () => {
    expect(zoomImageAt({ scale: 1, x: 0, y: 0 }, 2, 80, 30)).toEqual({ scale: 2, x: -80, y: -30 });
    expect(zoomImageAt({ scale: 2, x: -80, y: -30 }, 0.5, 80, 30)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoomImageAt({ scale: 1, x: 0, y: 0 }, 1000, 0, 0).scale).toBe(16);
  });
  it("owns modifier wheel and keyboard events only inside its viewport and cleans up", async () => {
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    function Probe() { const ref = useRef<HTMLDivElement>(null); const zoom = useImageZoom(ref, "image");
      return createElement("div", { ref, tabIndex: 0, ...zoom.bindings, "data-scale": zoom.value.scale }); }
    await act(async () => root.render(createElement(Probe)));
    const viewport = container.firstElementChild as HTMLElement;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect);
    // Happy DOM's WheelEvent omits inherited modifier fields. Real browsers
    // expose them; supply those fields while keeping native dispatch/cancellation.
    const wheel = (ctrlKey: boolean) => Object.assign(new WheelEvent("wheel", { deltaY: -100, clientX: 280, clientY: 180, bubbles: true, cancelable: true }), { ctrlKey, metaKey: false });
    const plain = wheel(false); await act(async () => viewport.dispatchEvent(plain)); expect(plain.defaultPrevented).toBe(false);
    const pinch = wheel(true); await act(async () => viewport.dispatchEvent(pinch)); expect(pinch.defaultPrevented).toBe(true);
    expect(Number(viewport.dataset.scale)).toBeGreaterThan(1);
    const reset = new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true });
    await act(async () => viewport.dispatchEvent(reset)); expect(viewport.dataset.scale).toBe("1"); expect(reset.defaultPrevented).toBe(true);
    await act(async () => root.unmount());
    const late = wheel(true); viewport.dispatchEvent(late); expect(late.defaultPrevented).toBe(false); container.remove();
  });
});
