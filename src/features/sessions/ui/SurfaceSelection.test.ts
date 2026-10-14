// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../model/quoteDraft";
import { createNote } from "../../notes";
import { SurfaceSelection } from "./SurfaceSelection";

vi.mock("../../notes", () => ({
  createNote: vi.fn().mockResolvedValue({}),
  noteTitle: (text: string) => text,
}));
const settings = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../settings/model/settings", () => ({
  loadNotesEnabled: () => settings.enabled,
  subscribeNotesEnabled: () => () => {},
}));
let container: HTMLDivElement;
let root: Root;
const onAdd = vi.fn();
const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
const toolbar = () => document.querySelector('[role="toolbar"]');
const action = (name: string) =>
  Array.from(toolbar()?.querySelectorAll("button") ?? []).find((button) =>
    button.textContent?.includes(name),
  )!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onAdd.mockClear();
  vi.mocked(createNote).mockClear();
  settings.enabled = true;
  window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => new DOMRect(50, 60, 90, 20),
  } as DOMRectList);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function selectText() {
  const range = document.createRange();
  range.selectNodeContents(container.querySelector("p")!);
  await act(async () => {
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await wait();
  });
}
it("quotes the selected text with its source and saves note provenance", async () => {
  await act(async () =>
    root.render(
      createElement(
        SurfaceSelection,
        { context: "@report.docx", cwd: "project", sessionId: "s1" },
        createElement("p", null, "Selected paragraph"),
      ),
    ),
  );
  await selectText();
  expect(onAdd).not.toHaveBeenCalled();
  await act(async () => action("Add to chat").click());
  expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toEqual({
    text: "@report.docx\n\nSelected paragraph",
    mode: "quote",
  });
  await selectText();
  await act(async () => action("Add to notes").click());
  expect(createNote).toHaveBeenCalledWith({
    title: "Selected paragraph",
    body: "@report.docx\n\nSelected paragraph",
    sourceCwd: "project",
    sourceSessionId: "s1",
  });
});
it("drops stale selections when content changes or the parent is hidden", async () => {
  const render = (version: number) =>
    root.render(
      createElement(
        SurfaceSelection,
        { contentVersion: version },
        createElement("p", null, "Selected paragraph"),
      ),
    );
  await act(async () => render(1));
  await selectText();
  expect(toolbar()).not.toBeNull();
  await act(async () => render(2));
  expect(toolbar()).toBeNull();
  await selectText();
  await act(async () => {
    container.setAttribute("aria-hidden", "true");
    await wait();
  });
  expect(toolbar()).toBeNull();
});
it("supports textarea keyboard selection and omits disabled note actions", async () => {
  settings.enabled = false;
  await act(async () =>
    root.render(
      createElement(
        SurfaceSelection,
        null,
        createElement("textarea", { defaultValue: "Before selected after" }),
      ),
    ),
  );
  const field = container.querySelector("textarea")!;
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 200, 100));
  await act(async () => {
    field.focus();
    field.setSelectionRange(7, 15);
    field.dispatchEvent(new Event("select", { bubbles: true }));
    await wait();
  });
  expect(toolbar()?.textContent).toContain("Add to chat");
  expect(toolbar()?.textContent).not.toContain("Add to notes");
  await act(async () => action("Add to chat").click());
  expect((onAdd.mock.calls[0][0] as CustomEvent).detail.text).toBe("selected");
  await act(async () => {
    field.setSelectionRange(0, 6);
    field.dispatchEvent(new Event("select", { bubbles: true }));
    await wait();
  });
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })));
  expect(toolbar()).toBeNull();
});
it("waits for a textarea drag to finish before opening the menu", async () => {
  await act(async () =>
    root.render(
      createElement(
        SurfaceSelection,
        { allowNotes: false },
        createElement("textarea", { defaultValue: "Selected" }),
      ),
    ),
  );
  const field = container.querySelector("textarea")!;
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 200, 100));
  await act(async () => {
    field.focus();
    field.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    field.setSelectionRange(0, 8);
    field.dispatchEvent(new Event("select", { bubbles: true }));
    await wait();
  });
  expect(toolbar()).toBeNull();
  await act(async () => {
    document.dispatchEvent(new PointerEvent("pointerup", { clientX: 40, clientY: 40 }));
    await wait();
  });
  expect(toolbar()?.textContent).toContain("Add to chat");
});
