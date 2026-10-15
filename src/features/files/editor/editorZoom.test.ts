// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorThemeFor } from "./editorChrome";
import { createSplitDiff } from "./editorSplitDiff";
import { editorZoom } from "./editorZoom";

const views: EditorView[] = [];
let destroySplit: (() => void) | undefined;

beforeEach(() => vi.stubGlobal("localStorage", new Storage()));
afterEach(() => {
  destroySplit?.();
  destroySplit = undefined;
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
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

const size = (view: EditorView) => getComputedStyle(view.dom).fontSize;

it("zooms code and gutters without changing document, selection or plain scrolling", () => {
  const view = create();
  view.dispatch({ selection: { anchor: 6, head: 11 } });
  expect(size(view)).toBe("13px");
  expect(wheel(view.contentDOM, -100).defaultPrevented).toBe(true);
  expect(size(view)).toBe("14px");
  expect(wheel(view.dom, 3, true, 1).defaultPrevented).toBe(true);
  expect(size(view)).toBe("13px");
  expect(wheel(view.contentDOM, 100, false).defaultPrevented).toBe(false);
  expect(wheel(view.contentDOM, 0).defaultPrevented).toBe(false);
  expect(size(view)).toBe("13px");
  expect(view.state.doc.toString()).toBe("const value = 1;");
  expect(view.state.selection.main.anchor).toBe(6);
  expect(view.state.selection.main.head).toBe(11);
});

it("synchronizes open editors and restores zoom in newly created editors", () => {
  const first = create();
  const second = create();
  wheel(first.contentDOM, -120);
  expect(size(second)).toBe("14px");
  expect(localStorage.getItem("bycoda.editorFontSize")).toBe("14");
  expect(size(create())).toBe("14px");
});

it("clamps zoom and consumes Ctrl+wheel at both limits", () => {
  const view = create();
  for (let i = 0; i < 40; i++) expect(wheel(view.dom, -1).defaultPrevented).toBe(true);
  expect(size(view)).toBe("32px");
  for (let i = 0; i < 40; i++) expect(wheel(view.dom, 1).defaultPrevented).toBe(true);
  expect(size(view)).toBe("8px");
});

it.each(["invalid", "0", "100", "14.5"])("ignores invalid stored size %s", (stored) => {
  localStorage.setItem("bycoda.editorFontSize", stored);
  expect(size(create())).toBe("13px");
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
  expect(size(split.a)).toBe("14px");
  expect(size(split.b)).toBe("14px");
  expect(wheel(split.b.contentDOM, 100).defaultPrevented).toBe(true);
  expect(size(split.a)).toBe("13px");
  expect(size(split.b)).toBe("13px");
  expect(split.dom.scrollTop).toBe(0);
});

it("continues zooming when storage is unavailable and detaches destroyed editors", () => {
  const first = create();
  const second = create();
  const dispatch = vi.spyOn(first, "dispatch");
  first.destroy();
  views.splice(views.indexOf(first), 1);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  wheel(second.contentDOM, -100);
  expect(size(second)).toBe("14px");
  expect(dispatch).not.toHaveBeenCalled();
});
