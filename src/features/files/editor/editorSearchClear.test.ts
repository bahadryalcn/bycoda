// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getSearchQuery, openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";
import { afterEach, expect, it } from "vitest";
import { editorSearch, openReplacePanel } from "./editorSearch";

let view: EditorView | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  view?.destroy();
  host?.remove();
});

it("clears editor matches while preserving replace text, options and the open panel", () => {
  host = document.createElement("div");
  document.body.append(host);
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: "alpha beta alpha", extensions: [editorSearch] }),
  });
  openReplacePanel(view);
  const input = host.querySelector<HTMLInputElement>('input[name="search"]')!;
  const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
  expect(clear.hidden).toBe(true);
  input.value = "alpha";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(clear.hidden).toBe(false);
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ search: "alpha", replace: "replacement", caseSensitive: true }),
    ),
  });
  clear.click();
  const query = getSearchQuery(view.state);
  expect(query.search).toBe("");
  expect(query.replace).toBe("replacement");
  expect(query.caseSensitive).toBe(true);
  expect(clear.hidden).toBe(true);
  expect(host.querySelector(".cm-find-count")!.textContent).toBe("");
  expect(host.querySelector(".cm-find")).not.toBeNull();
  expect(document.activeElement).toBe(input);
});

it("shows the editor clear control when the search is set programmatically", () => {
  host = document.createElement("div");
  document.body.append(host);
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: "alpha", extensions: [editorSearch] }),
  });
  openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })) });
  expect(host.querySelector<HTMLButtonElement>(".cm-find-clear")!.hidden).toBe(false);
});
