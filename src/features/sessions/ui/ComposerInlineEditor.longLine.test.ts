// @vitest-environment happy-dom
import { redo as redoView, undo as undoView } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerInlineEditor } from "./ComposerInlineEditor";
import { INLINE_LINE_LIMIT } from "./composerInlineLongLine";
import { inlineFixtureContext } from "./composerInlineReferences.fixture";

const start = "see https://example.com/docs now";
const wide = "w".repeat(INLINE_LINE_LIMIT + 10);
const field = createRef<HTMLTextAreaElement>();
const ready = vi.fn();
let host: HTMLDivElement;
let root: Root;

/** The draft owner: it hides the field while the editor is ready and follows the field's input events. */
function Draft({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [active, setActive] = useState(false);
  return createElement(
    "div",
    null,
    createElement(ComposerInlineEditor, {
      field,
      text,
      references: inlineFixtureContext(),
      label: "Message",
      placeholder: "",
      readOnly: false,
      disabled: false,
      spellCheck: false,
      hasSubagents: false,
      onInlineAttachments(ids: ReadonlySet<string> | null) {
        ready(ids);
        setActive(ids !== null);
      },
      onRemoveAttachment: vi.fn(),
    }),
    createElement("textarea", {
      ref: field,
      hidden: active,
      defaultValue: initial,
      onInput: (event: { currentTarget: HTMLTextAreaElement }) =>
        setText(event.currentTarget.value),
    }),
    createElement("button", { onClick: () => setText("") }, "Clear draft"),
  );
}

async function mount(initial: string) {
  await act(async () => root.render(createElement(Draft, { initial })));
}
const settled = () => act(async () => {});
const editor = () => host.querySelector<HTMLElement>(".cm-editor");
const view = () => EditorView.findFromDOM(editor()!)!;

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  field.current!.dispatchEvent(event);
  return event;
}
const undo = () => act(async () => void press("z"));
const redo = () => act(async () => void press("z", { shiftKey: true }));

async function typeInField(text: string) {
  await act(async () => {
    const input = field.current!;
    input.value += text;
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  ready.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("starts in the editor for a referenced draft", async () => {
  await mount(start);
  expect(editor()).not.toBeNull();
  expect(ready).toHaveBeenLastCalledWith(new Set());
});

it("reports offscreen attachments once until an edit changes their Markdown context", async () => {
  const note = "A paragraph with `inline code`.\n\n".repeat(500);
  await mount(note + "[image1] [image1] `[file1]`");
  expect(ready).toHaveBeenLastCalledWith(new Set(["photo"]));
  ready.mockClear();
  const doc = view();
  await act(async () => doc.dispatch({ changes: { from: 0, insert: "新" } }));
  expect(ready).not.toHaveBeenCalled();
  await act(async () => doc.dispatch({ changes: { from: 0, insert: "~~~\n" } }));
  expect(ready).toHaveBeenLastCalledWith(new Set());
  await act(async () => doc.dispatch({ changes: { from: 0, to: 4 } }));
  expect(ready).toHaveBeenLastCalledWith(new Set(["photo"]));
});

it("keeps a deletion undoable when an initially long draft becomes short enough for the editor", async () => {
  const initial = start + wide;
  await mount(initial);
  expect(editor()).toBeNull();
  await act(async () => {
    const input = field.current!;
    input.setRangeText("", start.length, initial.length, "end");
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
    );
  });
  expect(editor()).not.toBeNull();
  await act(async () => void undoView(view()));
  expect(field.current!.value === initial).toBe(true);
});

it("does not restore an externally cleared draft when undoing the next native edit", async () => {
  await mount(start);
  await act(async () => {
    view().dispatch({ changes: { from: start.length, insert: wide }, userEvent: "input.paste" });
  });
  expect(editor()).toBeNull();
  await act(async () => {
    field.current!.value = "";
    host.querySelector("button")!.click();
  });
  await typeInField("a");
  await undo();
  expect(field.current!.value).toBe("");
});

it("keeps a pasted very long line, its selection and its undo and redo when the editor leaves", async () => {
  await mount(start);
  const doc = view();
  const caret = start.length + wide.length;
  await act(async () => {
    doc.dispatch({
      changes: { from: start.length, insert: wide },
      selection: EditorSelection.single(caret),
      userEvent: "input.paste",
    });
  });
  await settled();
  expect(editor()).toBeNull();
  expect(ready).toHaveBeenLastCalledWith(null);
  expect(field.current!.value).toBe(start + wide);
  expect([field.current!.selectionStart, field.current!.selectionEnd]).toEqual([caret, caret]);

  await undo();
  expect(field.current!.value).toBe(start);
  // The short draft is back in an editor that still owns the undone paste.
  expect(editor()).not.toBeNull();
  await act(async () => void redoView(view()));
  await settled();
  expect(field.current!.value).toBe(start + wide);
  expect(editor()).toBeNull();

  await undo();
  expect(field.current!.value).toBe(start);
  await act(async () => void redoView(view()));
  await settled();
  expect(field.current!.value).toBe(start + wide);
});

it("undoes and redoes the native field's own edits after the editor left", async () => {
  await mount(start);
  await act(async () => {
    view().dispatch({
      changes: { from: start.length, insert: wide },
      selection: EditorSelection.single(start.length + wide.length),
      userEvent: "input.paste",
    });
  });
  await settled();
  expect(editor()).toBeNull();

  await typeInField("!");
  const after = start + wide + "!";
  expect(field.current!.value).toBe(after);
  const event = press("z");
  await settled();
  expect(event.defaultPrevented).toBe(true);
  expect(field.current!.value).toBe(start + wide);
  await undo();
  expect(field.current!.value).toBe(start);
  // Back in the editor, redo restores the paste and the editor leaves again with the typed edit still redoable.
  await act(async () => void redoView(view()));
  await settled();
  expect(field.current!.value).toBe(start + wide);
  expect(editor()).toBeNull();
  await redo();
  expect(field.current!.value).toBe(after);
});

it("steps back through typing that crossed the limit, one recorded edit at a time", async () => {
  const initial = "https://example.com/x " + "w".repeat(INLINE_LINE_LIMIT - 24);
  await mount(initial);
  expect(editor()).not.toBeNull();
  const typed = "abc";
  for (const character of typed.slice(0, 2)) {
    await act(async () => {
      const doc = view();
      doc.dispatch({
        changes: { from: doc.state.doc.length, insert: character },
        selection: EditorSelection.single(doc.state.doc.length + 1),
        userEvent: "input.type",
      });
    });
    await settled();
  }
  expect(editor()).toBeNull();
  await typeInField(typed[2]!);
  const full = initial + typed;
  expect(field.current!.value).toBe(full);

  const seen = [full];
  for (let step = 0; step < 4 && field.current!.value !== initial; step++) {
    await undo();
    seen.push(field.current!.value);
  }
  // Every state is one the user typed through; nothing is lost or invented.
  expect(field.current!.value).toBe(initial);
  for (const value of seen) expect(full.startsWith(value) && value.startsWith(initial)).toBe(true);
  for (let step = 0; step < 4 && field.current!.value !== full; step++) await redo();
  expect(field.current!.value).toBe(full);
});

it("keeps the selection direction and the focus", async () => {
  await mount(start);
  const doc = view();
  doc.contentDOM.focus();
  const anchor = wide.length + 10;
  await act(async () => {
    doc.dispatch({
      changes: { from: 0, insert: wide },
      selection: EditorSelection.single(anchor, wide.length + 5),
      userEvent: "input.paste",
    });
  });
  await settled();
  expect(editor()).toBeNull();
  const input = field.current!;
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
    wide.length + 5,
    anchor,
    "backward",
  ]);
  expect(document.activeElement).toBe(input);
});

it("records an IME composition in the native field as one edit and ignores undo while it is open", async () => {
  await mount(start);
  await act(async () => {
    view().dispatch({
      changes: { from: start.length, insert: wide },
      selection: EditorSelection.single(start.length + wide.length),
      userEvent: "input.paste",
    });
  });
  await settled();
  const input = field.current!;
  const before = input.value;

  await act(
    async () =>
      void input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  for (const word of ["n", "ni", "你"]) {
    await act(async () => {
      input.value = before + word;
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    });
  }
  const open = press("z", { isComposing: true });
  await settled();
  expect(open.defaultPrevented).toBe(false);
  expect(input.value).toBe(before + "你");
  await act(
    async () =>
      void input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "你" }),
      ),
  );

  await undo();
  expect(input.value).toBe(before);
  await redo();
  expect(input.value).toBe(before + "你");
});

it("waits for an open editor composition before the editor leaves", async () => {
  await mount(start);
  const doc = view();
  doc.contentDOM.focus();
  doc.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  await act(async () => {
    doc.dispatch({
      changes: { from: start.length, insert: wide },
      selection: EditorSelection.single(start.length + wide.length),
      userEvent: "input.type",
    });
  });
  await settled();
  expect(editor()).not.toBeNull();
  expect(ready).not.toHaveBeenCalledWith(null);

  doc.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
  expect(editor()).toBeNull();
  expect(field.current!.value).toBe(start + wide);
  expect(document.activeElement).toBe(field.current);
  await undo();
  expect(field.current!.value).toBe(start);
});
