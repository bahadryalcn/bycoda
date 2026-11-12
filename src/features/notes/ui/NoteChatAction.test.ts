// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NoteChatAction } from "./NoteChatAction";
import { ADD_NOTE_TO_CHAT_EVENT, requestAddNoteToChat, type Note } from "../notes";

it("keeps the quick action on the note project and offers a distinct destination", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(NoteChatAction, {
          projectCwd: "/work/notes",
          recents: [
            { path: "/work/other", openedAt: 1 },
            { path: "/work/notes", openedAt: 2 },
          ],
          onAdd,
        }),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>('[data-split-part="primary"]')!.click());
    expect(onAdd).toHaveBeenLastCalledWith("/work/notes");
    act(() => container.querySelector<HTMLButtonElement>('[data-split-part="menu"]')!.click());
    const other = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("other"),
    );
    expect(other).toBeDefined();
    act(() => other!.click());
    expect(onAdd).toHaveBeenLastCalledWith("/work/other");
  } finally {
    act(() => root.unmount());
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
