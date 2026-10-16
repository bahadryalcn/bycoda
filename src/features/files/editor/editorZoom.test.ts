// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorThemeFor } from "./editorChrome";
import { createSplitDiff } from "./editorSplitDiff";
import { codeZoomOffset, codeZoomScale, editorZoom } from "./editorZoom";

const views: EditorView[] = [];
let destroySplit: (() => void) | undefined;

beforeEach(() => vi.stubGlobal("localStorage", new Storage()));
afterEach(() => {
  destroySplit?.();
  destroySplit = undefined;
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

function create() {
  const view = new EditorView({
    parent: document.body,
    doc: "const value = 1;",
    extensions: [editorThemeFor("dark"), editorZoom()],
  });
  views.push(view);
  return view;
}

function wheel(target: HTMLElement, deltaY: number, ctrlKey = true, deltaMode = 0) {
  const event = new WheelEvent("wheel", { deltaY, deltaMode, bubbles: true, cancelable: true });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
  target.dispatchEvent(event);
  return event;
}

// The global `.cm-content` rule adds this to the Appearance code size.
const offset = () => document.documentElement.style.getPropertyValue("--code-zoom-offset");

it("zooms code without changing document, selection or plain scrolling", () => {
  const view = create();
  view.dispatch({ selection: { anchor: 6, head: 11 } });
  expect(offset()).toBe("");
  expect(wheel(view.contentDOM, -100).defaultPrevented).toBe(true);
  expect(offset()).toBe("1px");
  expect(wheel(view.dom, 3, true, 1).defaultPrevented).toBe(true);
  expect(offset()).toBe("");
  expect(wheel(view.contentDOM, 100, false).defaultPrevented).toBe(false);
  expect(wheel(view.contentDOM, 0).defaultPrevented).toBe(false);
  expect(offset()).toBe("");
  expect(view.state.doc.toString()).toBe("const value = 1;");
  expect(view.state.selection.main.anchor).toBe(6);
  expect(view.state.selection.main.head).toBe(11);
});

it("remeasures open editors and restores zoom for new editors", () => {
  const first = create();
  const second = create();
  const measure = vi.spyOn(second, "requestMeasure");
  wheel(first.contentDOM, -120);
  expect(measure).toHaveBeenCalled();
  expect(localStorage.getItem("bycoda.codeZoom")).toBe("1");
  document.documentElement.removeAttribute("style");
  create();
  expect(offset()).toBe("1px");
});

it("zooms relative to the Appearance code size and clamps the result", () => {
  document.documentElement.style.setProperty("--appearance-code-size", "16px");
  const view = create();
  for (let i = 0; i < 40; i++) expect(wheel(view.dom, -1).defaultPrevented).toBe(true);
  expect(offset()).toBe("16px");
  for (let i = 0; i < 40; i++) expect(wheel(view.dom, 1).defaultPrevented).toBe(true);
  expect(offset()).toBe("-8px");
  expect(codeZoomScale()).toBe(8 / 13);
});

it.each(["invalid", "100", "1.5"])("ignores invalid stored zoom %s", (stored) => {
  localStorage.setItem("bycoda.codeZoom", stored);
  create();
  expect(codeZoomOffset()).toBe(0);
  expect(offset()).toBe("");
});

it("zooms both split panes from either pane without scrolling the merge container", () => {
  const split = createSplitDiff({
    parent: document.body,
    original: "before",
    doc: "after",
    extensions: [editorThemeFor("dark"), editorZoom()],
    originalExtensions: [editorThemeFor("dark"), editorZoom()],
  });
  destroySplit = () => split.destroy();
  expect(wheel(split.a.contentDOM, -100).defaultPrevented).toBe(true);
  expect(offset()).toBe("1px");
  expect(wheel(split.b.contentDOM, 100).defaultPrevented).toBe(true);
  expect(offset()).toBe("");
  expect(split.dom.scrollTop).toBe(0);
});

it("continues zooming when storage is unavailable and detaches destroyed editors", () => {
  const first = create();
  const second = create();
  const measure = vi.spyOn(first, "requestMeasure");
  first.destroy();
  views.splice(views.indexOf(first), 1);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  wheel(second.contentDOM, -100);
  wheel(second.contentDOM, -100);
  expect(offset()).toBe("2px");
  expect(measure).not.toHaveBeenCalled();
});
