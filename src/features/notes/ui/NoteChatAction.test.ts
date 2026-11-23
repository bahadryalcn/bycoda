// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NoteChatAction } from "./NoteChatAction";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";
import { ADD_NOTE_TO_CHAT_EVENT, requestAddNoteToChat, type Note } from "../notes";

it("keeps the quick action on the note project and offers a distinct destination", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  const updatedDraft = vi.fn();
  const recents = [
    { path: "/work/other", openedAt: 1 },
    { path: "/work/notes", openedAt: 2 },
  ];
  const render = (onAdd: (cwd?: string) => void) =>
    act(() =>
      root.render(createElement(NoteChatAction, { projectCwd: "/work/notes", recents, onAdd })),
    );
  const reads = vi.spyOn(localStorage, "getItem");
  try {
    render(onAdd);
    act(() => container.querySelector<HTMLButtonElement>('[data-split-part="primary"]')!.click());
    expect(onAdd).toHaveBeenLastCalledWith("/work/notes");
    reads.mockClear();
    render(updatedDraft);
    expect(reads.mock.calls.filter(([key]) => key.includes("labels"))).toHaveLength(0);
    act(() => container.querySelector<HTMLButtonElement>('[data-split-part="menu"]')!.click());
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    act(() => saveTabGroupLabel("/work/other", "Local rename"));
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Local rename");
    const key = "bycoda:tab-group:workspace-labels";
    localStorage.setItem(key, JSON.stringify({ "/work/other": "Renamed destination" }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    const other = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Renamed destination"),
    );
    expect(other).toBeDefined();
    act(() => other!.click());
    expect(updatedDraft).toHaveBeenLastCalledWith("/work/other");
  } finally {
    act(() => root.unmount());
    reads.mockRestore();
    localStorage.removeItem("bycoda:tab-group:workspace-labels");
    localStorage.removeItem("bycoda:tab-group:labels");
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("routes a note without rewriting its source project or canonical note", () => {
  const note: Note = {
    id: "note",
    slug: "note",
    title: "Note",
    body: "Exact **Markdown**.",
    tags: [],
    sourceCwd: "/work/source",
    createdAt: 1,
    updatedAt: 1,
  };
  const onAdd = vi.fn();
  window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  try {
    requestAddNoteToChat(note, "/work/target");
    expect(onAdd).toHaveBeenCalledOnce();
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      body: note.body,
      sourceCwd: "/work/source",
      targetCwd: "/work/target",
    });
    expect(note.sourceCwd).toBe("/work/source");
  } finally {
    window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }
});
