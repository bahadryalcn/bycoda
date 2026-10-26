// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageAnnotationCanvas, type ImageAnnotationDocument } from "./ImageAnnotationCanvas";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 3 });
  target.dispatchEvent(event);
}

it("draws in original normalized coordinates and cancels incomplete work if the source frame changes", async () => {
  const onChange = vi.fn();
  const annotations: ImageAnnotationDocument = { marks: [] };
  const render = (src = "first-frame") =>
    root.render(
      createElement(ImageAnnotationCanvas, {
        src,
        alt: "Frozen device screen",
        tool: "box",
        document: annotations,
        onChange,
      }),
    );
  await act(async () => render());
  const layer = container.querySelector("svg")!;
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 20,
    width: 200,
    height: 400,
    x: 40,
    y: 20,
    right: 240,
    bottom: 420,
    toJSON() {},
  });
  await act(async () => pointer(layer, "pointerdown", 60, 60));
  await act(async () => pointer(layer, "pointermove", 200, 320));
  await act(async () => pointer(layer, "pointerup", 200, 320));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].marks[0]).toMatchObject({
    type: "box",
    start: { x: 0.1, y: 0.1 },
    end: { x: 0.8, y: 0.75 },
  });
  await act(async () => pointer(layer, "pointerdown", 60, 60));
  await act(async () => render("second-frame"));
  await act(async () => pointer(layer, "pointerup", 200, 320));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("offers keyboard pin placement and prevents disabled drawing", async () => {
  const onChange = vi.fn();
  const render = (disabled = false) =>
    root.render(
      createElement(ImageAnnotationCanvas, {
        src: "frame",
        alt: "Frozen device screen",
        tool: "pin",
        document: { marks: [] },
        onChange,
        disabled,
      }),
    );
  await act(async () => render());
  const layer = container.querySelector("svg")!;
  expect(layer.getAttribute("aria-label")).toBe("Frozen device screen");
  await act(async () =>
    layer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await act(async () =>
    layer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onChange.mock.calls[0][0].marks[0]).toMatchObject({
    type: "pin",
    point: { x: 0.51, y: 0.5 },
    number: 1,
  });
  await act(async () => render(true));
  await act(async () =>
    layer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(layer.getAttribute("tabindex")).toBe("-1");
});
