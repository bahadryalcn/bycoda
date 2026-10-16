// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import {
  chooseMergeRegion,
  createMergeResolution,
  mergeResolution,
  mergeResolutionField,
  mergeResolutionHistory,
  selectMergeRegion,
} from "./mergeResolution";

const markers =
  "top\n<<<<<<< HEAD\nprice=100\n=======\nprice=120\n>>>>>>> incoming\nmiddle\n<<<<<<< HEAD\nname=ours\n=======\nname=theirs\n>>>>>>> incoming\nend\n";
let view: EditorView;
afterEach(() => view?.destroy());
function mount(text = markers, base?: string) {
  const initial = createMergeResolution(text, base);
  view = new EditorView({
    doc: initial.doc,
    extensions: [
      history(),
      mergeResolutionField.init(() => initial.resolution),
      mergeResolutionHistory,
    ],
  });
  return view;
}

describe("editable merge result", () => {
  it("starts from the ancestor only inside conflicts and preserves merged context", () => {
    mount(markers, "top\nprice=80\nmiddle\nname=base\nend\n");
    expect(view.state.doc.toString()).toBe("top\nprice=80\nmiddle\nname=base\nend\n");
    expect(mergeResolution(view.state).regions.map((region) => region.choice)).toEqual([
      null,
      null,
    ]);
  });
  it("maps later conflicts after manual context edits and lets each side replace only its region", () => {
    mount();
    view.dispatch({ changes: { from: 0, to: 3, insert: "edited context" } });
    chooseMergeRegion(view, 0, "theirs");
    selectMergeRegion(view, 1);
    chooseMergeRegion(view, 1, "ours");
    expect(view.state.doc.toString()).toBe("edited context\nprice=120\nmiddle\nname=ours\nend\n");
    chooseMergeRegion(view, 0, "ours");
    expect(view.state.doc.toString()).toContain("price=100\nmiddle\nname=ours");
  });
  it("undo and redo restore both content and unresolved decisions, even for unchanged choices", () => {
    mount();
    chooseMergeRegion(view, 0, "ours");
    expect(mergeResolution(view.state).regions[0].choice).toBe("ours");
    expect(undo(view)).toBe(true);
    expect(mergeResolution(view.state).regions[0].choice).toBeNull();
    expect(redo(view)).toBe(true);
    expect(mergeResolution(view.state).regions[0].choice).toBe("ours");
    chooseMergeRegion(view, 1, "theirs");
    undo(view);
    expect(view.state.doc.toString()).toBe("top\nprice=100\nmiddle\nname=ours\nend\n");
    expect(mergeResolution(view.state).regions[1].choice).toBeNull();
  });
  it("preserves separate result ranges after replacing the whole document", () => {
    mount();
    const edited = view.state.doc.toString().replace("name=ours", "name=custom");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited } });
    chooseMergeRegion(view, 1, "manual");
    chooseMergeRegion(view, 0, "theirs");
    expect(view.state.doc.toString()).toBe("top\nprice=120\nmiddle\nname=custom\nend\n");
  });
  it("navigation does not add undo steps or clear redo", () => {
    mount();
    chooseMergeRegion(view, 0, "theirs");
    selectMergeRegion(view, 1);
    expect(undo(view)).toBe(true);
    expect(mergeResolution(view.state).regions[0].choice).toBeNull();
    selectMergeRegion(view, 1);
    expect(redo(view)).toBe(true);
    expect(mergeResolution(view.state).regions[0].choice).toBe("theirs");
  });
  it("keeps manual result edits and supports empty sides, diff3 and missing final newline", () => {
    mount("prefix\n<<<<<<< HEAD\n||||||| base\nold\n=======\nnew\n>>>>>>> topic");
    const region = mergeResolution(view.state).regions[0];
    view.dispatch({ changes: { from: region.from, to: region.to, insert: "custom" } });
    chooseMergeRegion(view, 0, "manual");
    expect(view.state.doc.toString()).toBe("prefix\ncustom");
    chooseMergeRegion(view, 0, "ours");
    expect(view.state.doc.toString()).toBe("prefix\n");
    chooseMergeRegion(view, 0, "theirs");
    expect(view.state.doc.toString()).toBe("prefix\nnew");
  });
  it("records where pending text came from and resets a decision to it", () => {
    mount(markers, "top\nprice=80\nmiddle\nname=base\nend\n");
    expect(mergeResolution(view.state).regions.map((region) => region.origin)).toEqual([
      "base",
      "base",
    ]);
    chooseMergeRegion(view, 1, "both");
    chooseMergeRegion(view, 0, "theirs");
    chooseMergeRegion(view, 1, "reset");
    expect(view.state.doc.toString()).toBe("top\nprice=120\nmiddle\nname=base\nend\n");
    expect(mergeResolution(view.state).regions.map((region) => region.choice)).toEqual([
      "theirs",
      null,
    ]);
    view.destroy();
    mount();
    expect(mergeResolution(view.state).regions[0].origin).toBe("ours");
  });
  it("does not consume adjacent conflicts when selecting an empty side", () => {
    mount(
      "<<<<<<< HEAD\n=======\na\n>>>>>>> branch\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> branch\n",
    );
    chooseMergeRegion(view, 0, "ours");
    chooseMergeRegion(view, 1, "theirs");
    expect(view.state.doc.toString()).toBe("c\n");
    chooseMergeRegion(view, 0, "theirs");
    expect(view.state.doc.toString()).toBe("a\nc\n");
  });
});
