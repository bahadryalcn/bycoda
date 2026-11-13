// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { AssistantNote } from "../../../shared/model/host-contracts/assistant";
import { NoteEditor } from "./AssistantNoteEditor";

vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => createElement("p", null, text),
}));

let host: HTMLDivElement, root: Root;
const note: AssistantNote = {
  id: "editor-note",
  title: "Review notes",
  body: "# Heading\n\nOwner **Markdown**.\n\n[ref]: https://example.com",
  tags: ["assistant"],
  createdAt: 1,
  updatedAt: 2,
};
const onSaved = vi.fn(async () => {}),
  onClose = vi.fn();
const request = vi.fn();
const props = () => ({ note, environmentId: "host-original", request, onSaved, onClose });
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
const source = () =>
  EditorView.findFromDOM(host.querySelector("[data-note-editor] .cm-editor") as HTMLElement)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRetainedState();
  request.mockReset();
  onSaved.mockClear();
  onClose.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("edits exact Markdown inline, retains Source undo across modes and restores the draft after navigation", async () => {
  await act(async () => root.render(createElement(NoteEditor, props())));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Document");
  expect(host.querySelector('[aria-label="Insert image"]')).toBeNull();
  await act(async () => button("Source").click());
  const editor = source();
  await act(async () =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n\n- [ ] Keep this draft" },
      userEvent: "input",
    }),
  );
  await act(async () => button("Document").click());
  await act(async () => button("Source").click());
  expect(source()).toBe(editor);
  await act(async () => {
    undo(editor);
  });
  expect(editor.state.doc.toString()).toBe(note.body);
  await act(async () =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n\nRetained." },
      userEvent: "input",
    }),
  );
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(NoteEditor, props())));
  expect(source().state.doc.toString()).toBe(`${note.body}\n\nRetained.`);
  expect(request).not.toHaveBeenCalled();
});

it("freezes both source and document editing after an uncertain save without discarding the submitted draft", async () => {
  let reject!: (error: Error) => void;
  request.mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  await act(async () => root.render(createElement(NoteEditor, props())));
  await act(async () => button("Source").click());
  const editor = source();
  await act(async () => button("Save").click());
  expect(editor.state.readOnly).toBe(true);
  await act(async () => editor.dispatch({ changes: { from: 0, insert: "Lost edit" } }));
  expect(editor.state.doc.toString()).toBe(note.body);
  await act(async () => {
    reject(new Error("Connection lost"));
  });
  expect(host.textContent).toContain("Note save is pending. Retry to verify the original note.");
  expect(editor.state.readOnly).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => button("Document").click());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Edit note block"]')!.click(),
  );
  expect(host.querySelector("[data-note-preview] .cm-editor")).toBeNull();
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.note-draft:editor-note:record")!).intent.body,
  ).toBe(note.body);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    { op: "notes.save", id: note.id, title: note.title, body: note.body, expectedUpdatedAt: 2 },
    "host-original",
  );
});

it("saves exact Markdown and closes only after refresh succeeds", async () => {
  request.mockResolvedValue({ note: { ...note, updatedAt: 3 } });
  await act(async () => root.render(createElement(NoteEditor, props())));
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Note title"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(localStorage.getItem("bycoda.assistant.note-draft:editor-note:record")).toBeNull();
});

it("keeps an oversized pasted draft recoverable and blocks save", async () => {
  await act(async () => root.render(createElement(NoteEditor, props())));
  await act(async () => button("Source").click());
  const editor = source();
  const body = "x".repeat(100001);
  await act(async () =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: body } }),
  );
  expect(button("Save").disabled).toBe(true);
  expect(host.textContent).toContain("Notes can contain up to 100,000 characters.");
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.note-draft:editor-note:record")!).body,
  ).toBe(body);
  expect(request).not.toHaveBeenCalled();
});
