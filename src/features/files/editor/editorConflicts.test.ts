// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeLineBreaks, restoreLineEnding } from "./editorDoc";
import {
  conflictBlocks,
  editorConflicts,
  resolveConflict,
  stepConflict,
  touchesConflictMarker,
} from "./editorConflicts";

const TWO = [
  "top",
  "<<<<<<< HEAD",
  "mine",
  "=======",
  "theirs",
  ">>>>>>> feature/x",
  "middle",
  "<<<<<<< HEAD",
  "m2",
  "||||||| base",
  "old",
  "=======",
  "t2",
  ">>>>>>> feature/x",
  "end",
].join("\n");

const views: EditorView[] = [];

function open(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), editorConflicts] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("editorConflicts", () => {
  it("tracks blocks as the document changes", () => {
    const view = open(TWO);
    expect(conflictBlocks(view.state)).toHaveLength(2);
    // Deleting a block's opening marker by hand ends that block.
    view.dispatch({ changes: { from: TWO.indexOf("<<<<<<< HEAD"), to: TWO.indexOf("mine") } });
    expect(conflictBlocks(view.state)).toHaveLength(1);
    expect(conflictBlocks(view.state)[0].oursLabel).toBe("HEAD");
  });

  it("resolves one block as one undoable edit", () => {
    const view = open(TWO);
    const [first] = conflictBlocks(view.state);
    expect(resolveConflict(view, first.from, "theirs")).toBe(true);
    expect(view.state.doc.toString()).toBe(
      TWO.replace("<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature/x\n", "theirs\n"),
    );
    expect(conflictBlocks(view.state)).toHaveLength(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(TWO);
    expect(conflictBlocks(view.state)).toHaveLength(2);
  });

  it("accepts both sides and drops the diff3 base", () => {
    const view = open(TWO);
    resolveConflict(view, conflictBlocks(view.state)[1].from, "both");
    expect(view.state.doc.toString().endsWith("middle\nm2\nt2\nend")).toBe(true);
  });

  it("ignores a stale block position", () => {
    const view = open(TWO);
    expect(resolveConflict(view, 3, "ours")).toBe(false);
    expect(view.state.doc.toString()).toBe(TWO);
  });

  it("restores CRLF on save after a block resolution", () => {
    const disk = TWO.replace(/\n/g, "\r\n");
    const view = open(normalizeLineBreaks(disk));
    resolveConflict(view, conflictBlocks(view.state)[0].from, "ours");
    const saved = restoreLineEnding(view.state.doc.toString(), "\r\n");
    expect(saved).toBe(
      disk.replace(
        "<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> feature/x\r\n",
        "mine\r\n",
      ),
    );
  });

  it("steps between blocks and wraps", () => {
    const view = open(TWO);
    const [first, second] = conflictBlocks(view.state);
    stepConflict(view, 1);
    expect(view.state.selection.main.head).toBe(first.from);
    stepConflict(view, 1);
    expect(view.state.selection.main.head).toBe(second.from);
    stepConflict(view, 1);
    expect(view.state.selection.main.head).toBe(first.from);
    stepConflict(view, -1);
    expect(view.state.selection.main.head).toBe(second.from);
    stepConflict(view, -1);
    expect(view.state.selection.main.head).toBe(first.from);
  });

  it("draws tinted sections, dimmed markers and an action bar per block", () => {
    const view = open(TWO);
    expect(view.dom.querySelectorAll(".cm-conflictOurs")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-conflictTheirs")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-conflictBase")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-conflictMarker")).toHaveLength(7);
    const bars = view.dom.querySelectorAll(".cm-conflictActions");
    expect(bars).toHaveLength(2);
    const labels = [...bars[0].querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Accept Current (HEAD)", "Accept Incoming (feature/x)", "Accept Both"]);
  });

  it("applies a block from its action bar", () => {
    const view = open(TWO);
    const bar = view.dom.querySelectorAll(".cm-conflictActions")[0];
    (bar.querySelector(".cm-conflictAction-theirs") as HTMLButtonElement).click();
    expect(conflictBlocks(view.state)).toHaveLength(1);
    expect(view.state.doc.toString()).toContain("top\ntheirs\nmiddle");
  });
});

describe("conflictField incremental rebuild", () => {
  const stateOf = (doc: string) => EditorState.create({ doc, extensions: [editorConflicts] });
  const BLOCK = ["<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> x"];

  it("does not look for markers when ordinary text is typed", () => {
    const state = stateOf("hello\nworld");
    const tr = state.update({ changes: { from: 5, insert: " there" } });
    expect(touchesConflictMarker(tr)).toBe(false);
    expect(conflictBlocks(tr.state)).toEqual([]);
  });

  it("finds a block completed by typing the 7th marker character", () => {
    const state = stateOf(["<<<<<<", "a", "=======", "b", ">>>>>>> x"].join("\n"));
    expect(conflictBlocks(state)).toHaveLength(0);
    const tr = state.update({ changes: { from: 6, insert: "<" } });
    expect(touchesConflictMarker(tr)).toBe(true);
    expect(conflictBlocks(tr.state)).toHaveLength(1);
    expect(conflictBlocks(tr.state)[0].from).toBe(0);
  });

  it("finds a block completed by deleting text that joined two fragments", () => {
    const state = stateOf(["<<<<<<<x", "a", "=======", "b", ">>>>>>> x"].join("\n"));
    expect(conflictBlocks(state)).toHaveLength(0);
    // Remove the `x` that kept the opener from being a marker.
    const tr = state.update({ changes: { from: 7, to: 8 } });
    expect(touchesConflictMarker(tr)).toBe(true);
    expect(conflictBlocks(tr.state)).toHaveLength(1);

    // Deleting a line break joins `<<<<` and `<<<` into an opener.
    const joined = stateOf(["<<<<", "<<<", "=======", ">>>>>>>"].join("\n"));
    expect(conflictBlocks(joined)).toHaveLength(0);
    const tr2 = joined.update({ changes: { from: 4, to: 5 } });
    expect(touchesConflictMarker(tr2)).toBe(true);
    expect(conflictBlocks(tr2.state)).toHaveLength(1);
  });

  it("finds a block completed by a closing marker typed after the rest", () => {
    const state = stateOf(["<<<<<<< HEAD", "a", "=======", "b", ""].join("\n"));
    expect(conflictBlocks(state)).toHaveLength(0);
    const tr = state.update({ changes: { from: state.doc.length, insert: ">>>>>>> x" } });
    expect(conflictBlocks(tr.state)).toHaveLength(1);
  });

  it("keeps blocks right while text around and inside them is edited", () => {
    let state = stateOf(["top", ...BLOCK, "end"].join("\n"));
    expect(conflictBlocks(state)).toHaveLength(1);
    state = state.update({ changes: { from: 0, insert: "more\n" } }).state;
    expect(conflictBlocks(state)[0].startLine).toBe(3);
    // Breaking the closing marker removes the block.
    const close = state.doc.toString().indexOf(">>>>>>>");
    state = state.update({ changes: { from: close, to: close + 1 } }).state;
    expect(conflictBlocks(state)).toHaveLength(0);
    // Fixing it brings the block back.
    state = state.update({ changes: { from: close, insert: ">" } }).state;
    expect(conflictBlocks(state)).toHaveLength(1);
  });
});
