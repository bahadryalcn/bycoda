// @vitest-environment happy-dom
import { minimalSetup } from "codemirror";
import { Transaction, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  editorSharedHistory,
  isSharedPeerChange,
  sharedDocumentSaved,
  sharedRedo,
  sharedRedoDepth,
  sharedUndo,
  sharedUndoDepth,
  type SharedDocumentHooks,
} from "./editorSharedHistory";

describe("shared editor document", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    views.splice(0).forEach((view) => view.destroy());
  });

  function open(doc: string, path = "C:\\repo\\index.js", hooks?: SharedDocumentHooks) {
    const view = new EditorView({
      doc,
      parent: document.body,
      extensions: [minimalSetup, editorSharedHistory(path, hooks)],
    });
    views.push(view);
    return view;
  }

  function close(view: EditorView) {
    views.splice(views.indexOf(view), 1);
    view.destroy();
  }

  function type(view: EditorView, at: number, text: string) {
    view.dispatch({ changes: { from: at, insert: text }, userEvent: "input.type" });
  }

  it("shows an edit from the file tab in the review tab and undoes it there", () => {
    const file = open("const a = 1;");
    const review = open("const a = 1;", "C:/repo/index.js");
    type(file, 12, " // edited");

    expect(review.state.doc.toString()).toBe("const a = 1; // edited");
    expect(sharedUndoDepth(review)).toBe(1);
    expect(sharedUndo(review)).toBe(true);
    expect(review.state.doc.toString()).toBe("const a = 1;");
    expect(file.state.doc.toString()).toBe("const a = 1;");

    sharedRedo(file);
    expect(file.state.doc.toString()).toBe("const a = 1; // edited");
    expect(review.state.doc.toString()).toBe("const a = 1; // edited");
    expect(sharedRedoDepth(review)).toBe(0);
  });

  it("marks mirrored edits so only the typing editor autosaves", () => {
    const seen: boolean[] = [];
    const file = open("x");
    const review = open("x");
    const listener = EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) if (tr.docChanged) seen.push(isSharedPeerChange(tr));
    });
    const watched = new EditorView({
      doc: "x",
      parent: document.body,
      extensions: [minimalSetup, editorSharedHistory("C:/repo/index.js"), listener],
    });
    views.push(watched);
    type(file, 1, "y");
    type(watched, 2, "z");

    expect(seen).toEqual([true, false]);
    expect(review.state.doc.toString()).toBe("xyz");
  });

  it("leaves an editor that missed an edit alone until it has the newer text", () => {
    const deferred: (() => void)[] = [];
    const file = open("x");
    const review = open("x", "C:/repo/index.js", { external: (apply) => deferred.push(apply) });
    type(file, 1, "y");
    type(file, 2, "z");

    expect(review.state.doc.toString()).toBe("x");
    expect(sharedUndoDepth(review)).toBe(0);
    expect(sharedUndo(review)).toBe(true);
    expect(review.state.doc.toString()).toBe("x");

    // Applies in order once the gate opens.
    deferred.splice(0).forEach((apply) => apply());
    expect(review.state.doc.toString()).toBe("xyz");
    expect(sharedUndoDepth(review)).toBe(1);
  });

  it("keeps a reload out of the other editors", () => {
    const file = open("x");
    const review = open("x");
    file.dispatch({
      changes: { from: 0, to: 1, insert: "disk" },
      annotations: Transaction.addToHistory.of(false),
    });

    expect(review.state.doc.toString()).toBe("x");
    review.dispatch({
      changes: { from: 0, to: 1, insert: "disk" },
      annotations: Transaction.addToHistory.of(false),
    });
    expect(sharedUndoDepth(review)).toBe(0);
  });

  it("starts a fresh history when an editor with other text is edited", () => {
    const deferred: (() => void)[] = [];
    const file = open("x");
    const review = open("x", "C:/repo/index.js", { external: (apply) => deferred.push(apply) });
    type(file, 1, "y");
    type(review, 1, "z");

    expect(sharedUndoDepth(review)).toBe(1);
    expect(sharedUndoDepth(file)).toBe(0);
    deferred.splice(0).forEach((apply) => apply());
    expect(review.state.doc.toString()).toBe("xz");
  });

  it("tells the editors sharing the text that it was saved", () => {
    const saved: Text[] = [];
    const file = open("a");
    open("a", "C:/repo/index.js", { saved: (doc) => saved.push(doc) });
    open("a", "C:/repo/other.js", { saved: (doc) => saved.push(doc) });
    type(file, 1, "b");
    sharedDocumentSaved(file, file.state.doc);

    expect(saved.map(String)).toEqual(["ab"]);
  });

  it("hands the save to one remaining editor when the typing editor closes", async () => {
    const takers: string[] = [];
    const file = open("a");
    open("a", "C:/repo/index.js", { peerLeft: () => (takers.push("first"), true) });
    open("a", "C:/repo/index.js", { peerLeft: () => (takers.push("second"), true) });
    close(file);
    await Promise.resolve();

    expect(takers).toEqual(["first"]);
  });

  it("keeps the history and hands nothing over when an editor is rebuilt", async () => {
    let handed = 0;
    const first = open("a");
    open("a", "C:/repo/index.js", { peerLeft: () => (handed++, true) });
    type(first, 1, "b");
    const doc = first.state.doc.toString();
    close(first);
    const rebuilt = open(doc);
    await Promise.resolve();

    expect(handed).toBe(0);
    expect(sharedUndoDepth(rebuilt)).toBe(1);
    sharedUndo(rebuilt);
    expect(rebuilt.state.doc.toString()).toBe("a");
  });

  it("keeps separate documents for different files", () => {
    const a = open("a", "C:/repo/a.js");
    const b = open("b", "C:/repo/b.js");
    type(a, 1, "!");

    expect(b.state.doc.toString()).toBe("b");
    expect(sharedUndoDepth(b)).toBe(0);
    expect(sharedUndoDepth(a)).toBe(1);
  });

  it("forgets the history once the last editor closes", async () => {
    const view = open("a");
    type(view, 1, "b");
    close(view);
    await Promise.resolve();

    expect(sharedUndoDepth(open("ab"))).toBe(0);
  });
});
