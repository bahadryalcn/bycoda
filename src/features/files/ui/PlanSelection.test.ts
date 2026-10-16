// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { createNote } from "../../notes";
import { PlanSelection } from "./PlanSelection";

vi.mock("../../notes", () => ({
  createNote: vi.fn().mockResolvedValue({}),
  noteTitle: (text: string) => text,
}));
vi.mock("../../settings/model/settings", () => ({
  loadNotesEnabled: () => true,
  subscribeNotesEnabled: () => () => {},
}));

it("offers plan selection actions, quotes only the selection and saves its source", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => new DOMRect(50, 60, 90, 20),
  } as DOMRectList);
  const render = async (active = true, text = "Selected plan detail") => {
    await act(async () =>
      root.render(
        createElement(
          PlanSelection,
          { active, blockId: "plan-1", text, sessionId: "session-1", cwd: "project" },
          createElement("p", null, text),
        ),
      ),
    );
  };
  const select = async () => {
    const range = document.createRange();
    range.selectNodeContents(container.querySelector("p")!);
    await act(async () => {
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  };
  const action = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')).find(
      (button) => button.textContent?.includes(label),
    )!;
  try {
    await render();
    await select();
    expect(action("Add to notes")).toBeDefined();
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () => action("Add to chat").click());
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: "Selected plan detail",
      mode: "quote",
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await select();
    await act(async () => action("Add to notes").click());
    expect(createNote).toHaveBeenCalledWith({
      title: "Selected plan detail",
      body: "Selected plan detail",
      sourceSessionId: "session-1",
      sourceCwd: "project",
    });
    await select();
    await render(false);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await render();
    await select();
    await render(true, "Updated plan");
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await select();
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    window.getSelection()?.removeAllRanges();
    window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
