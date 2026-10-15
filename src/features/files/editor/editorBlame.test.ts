// @vitest-environment happy-dom
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitBlameLine } from "../../../platform/tauri/fs";
import { blameLinesOf, editorBlame, refreshBlame } from "./editorBlame";

const views: EditorView[] = [];

function open(doc: string, onOpenCommit = vi.fn()): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [editorBlame({ onOpenCommit })],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function entry(line: number, sha: string, author = "Ann"): GitBlameLine {
  return {
    line,
    sha,
    shortSha: sha.slice(0, 7),
    author,
    timestamp: Math.floor(Date.now() / 1000) - 3 * 86_400,
    summary: `commit ${sha}`,
  };
}

const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

async function load(view: EditorView, base: Text, blame: GitBlameLine[]) {
  await refreshBlame(
    view,
    base,
    () => Promise.resolve(blame),
    () => true,
  );
}

function labels(view: EditorView): string[] {
  return [...view.dom.querySelectorAll(".cm-blameEntry")].map((el) => el.textContent ?? "");
}

describe("editorBlame", () => {
  const doc = "one\ntwo\nthree\nfour";
  const blame = [entry(1, A), entry(2, A), entry(3, B, "Bob"), entry(4, ZERO)];

  it("attributes each line to its commit", async () => {
    const view = open(doc);
    await load(view, view.state.doc, blame);
    expect(blameLinesOf(view.state).map((l) => l?.sha ?? null)).toEqual([A, A, B, null]);
  });

  it("names the commit on the first line of a run only", async () => {
    const view = open(doc);
    await load(view, view.state.doc, blame);
    const text = labels(view);
    expect(text[0]).toMatch(/^Ann · 3d ago$/);
    expect(text[1]).toBe("");
    expect(text[2]).toMatch(/^Bob · 3d ago$/);
    expect(text[3]).toBe("Not committed yet");
  });

  it("keeps attributions of unchanged lines while typing and unblames edited ones", async () => {
    const view = open(doc);
    await load(view, view.state.doc, blame);
    view.dispatch({ changes: { from: 0, insert: "zero\n" } });
    expect(blameLinesOf(view.state).map((l) => l?.sha ?? null)).toEqual([null, A, A, B, null]);
    view.dispatch({ changes: { from: 6, insert: "!" } });
    expect(blameLinesOf(view.state).map((l) => l?.sha ?? null)).toEqual([null, null, A, B, null]);
    expect(labels(view)[1]).toBe("");
    expect(labels(view)[0]).toBe("Not committed yet");
  });

  it("maps a result through edits made while git was running", async () => {
    const view = open(doc);
    const base = view.state.doc;
    const pending = refreshBlame(
      view,
      base,
      () => Promise.resolve(blame),
      () => true,
    );
    view.dispatch({ changes: { from: 0, insert: "new\n" } });
    await pending;
    expect(blameLinesOf(view.state).map((l) => l?.sha ?? null)).toEqual([null, A, A, B, null]);
  });

  it("maps blame of the saved text onto a dirty buffer", async () => {
    const view = open(doc);
    const saved = view.state.doc;
    view.dispatch({ changes: { from: 4, to: 7, insert: "TWO" } });
    await load(view, saved, blame);
    expect(blameLinesOf(view.state).map((l) => l?.sha ?? null)).toEqual([A, null, B, null]);
  });

  it("ignores a result superseded by a newer request", async () => {
    const view = open(doc);
    let first!: (value: GitBlameLine[]) => void;
    const slow = refreshBlame(
      view,
      view.state.doc,
      () => new Promise<GitBlameLine[]>((resolve) => (first = resolve)),
      () => true,
    );
    await load(view, view.state.doc, [entry(1, B)]);
    first(blame);
    await slow;
    expect(blameLinesOf(view.state)[0]?.sha).toBe(B);
    expect(blameLinesOf(view.state)[1]).toBeNull();
  });

  it("opens the commit from a gutter entry", async () => {
    const onOpenCommit = vi.fn();
    const view = open(doc, onOpenCommit);
    await load(view, view.state.doc, blame);
    (view.dom.querySelector(".cm-blameCommit") as HTMLElement).click();
    expect(onOpenCommit).toHaveBeenCalledWith(
      expect.objectContaining({ sha: A, author: "Ann", subject: `commit ${A}` }),
    );
  });

  it("shows the hover card with sha, author, date and subject", async () => {
    const view = open(doc);
    await load(view, view.state.doc, blame);
    const first = view.dom.querySelector(".cm-blameCommit") as HTMLElement;
    first.dispatchEvent(new MouseEvent("mouseenter"));
    const card = document.body.querySelector(".cm-blameCard");
    expect(card?.textContent).toContain("aaaaaaa");
    expect(card?.textContent).toContain("Ann");
    expect(card?.textContent).toContain(`commit ${A}`);
    first.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.body.querySelector(".cm-blameCard")).toBeNull();
  });

  it("leaves a rejected fetch to the caller and keeps the old blame", async () => {
    const view = open(doc);
    await load(view, view.state.doc, blame);
    await expect(
      refreshBlame(
        view,
        view.state.doc,
        () => Promise.reject(new Error("no git")),
        () => true,
      ),
    ).rejects.toThrow("no git");
    expect(blameLinesOf(view.state)[0]?.sha).toBe(A);
  });

  it("only builds gutter elements for the lines in view", async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const view = open(big);
    await load(
      view,
      view.state.doc,
      Array.from({ length: 5000 }, (_, i) => entry(i + 1, A)),
    );
    expect(view.dom.querySelectorAll(".cm-blameEntry").length).toBeLessThan(1000);
  });
});
