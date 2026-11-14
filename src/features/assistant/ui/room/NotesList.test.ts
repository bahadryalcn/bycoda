// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { NotesList } from "./NotesList";

it("opens the targeted note's context menu and edits it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const note = { id: "a", title: "First", body: "Body", tags: [], updatedAt: 1 } as AssistantNote;
  const edit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(NotesList, {
          notes: [note],
          selectedId: undefined,
          onSelect: vi.fn(),
          checked: new Set<string>(),
          onCheck: vi.fn(),
          onEdit: edit,
          onDelete: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      host
        .querySelector("li")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 30 })),
    );
    const action = [...document.querySelectorAll("[role=menuitem]")].find((item) =>
      item.textContent?.includes("Edit"),
    );
    expect(action).toBeTruthy();
    await act(async () => (action as HTMLElement).click());
    expect(edit).toHaveBeenCalledWith(note);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
