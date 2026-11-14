// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type {
  AssistantNote,
  AssistantSnapshot,
} from "../../../../shared/model/host-contracts/assistant";
import type { AssistantRoom } from "./assistantRoomContext";
import { NotesTab } from "./NotesTab";

const state = vi.hoisted(() => ({ room: {} as AssistantRoom, closes: [] as (() => void)[] }));
vi.mock("./assistantRoomContext", () => ({ useAssistantRoom: () => state.room }));
vi.mock("../AssistantNoteEditor", () => ({
  NoteEditor: ({ onClose }: { onClose: () => void }) => {
    state.closes.push(onClose);
    return null;
  },
}));

it("does not close a different note when an earlier inline editor finishes saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first = {
    id: "first",
    title: "First",
    body: "Draft A",
    updatedAt: 1,
    createdAt: 1,
    tags: ["assistant"],
  } satisfies AssistantNote;
  const second = { ...first, id: "second", title: "Second" };
  state.closes = [];
  state.room = {
    environmentId: "host-one",
    query: "",
    noteEdit: first,
    setNoteEdit: (update) => {
      state.room.noteEdit = typeof update === "function" ? update(state.room.noteEdit) : update;
    },
  } as AssistantRoom;
  const snapshot = { notes: [first, second] } as AssistantSnapshot;
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(createElement(NotesTab, { snapshot })));
    const earlierSaveFinished = state.closes.at(-1)!;
    state.room.noteEdit = second;
    await act(async () => root.render(createElement(NotesTab, { snapshot })));
    earlierSaveFinished();
    expect(state.room.noteEdit).toBe(second);
    state.closes.at(-1)!();
    expect(state.room.noteEdit).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps checked notes across search and removes only confirmed deletions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first = {
    id: "first",
    title: "First",
    body: "",
    tags: [],
    updatedAt: 1,
    createdAt: 1,
  } satisfies AssistantNote;
  const second = { ...first, id: "second", title: "Second" };
  let confirmation: { onConfirm: () => Promise<void> } | undefined;
  state.room = {
    environmentId: "host-one",
    view: "Notes",
    query: "",
    privacy: { key: "scope" },
    assistantRequest: vi.fn(async ({ id }: { id: string }) =>
      id === "first" ? { ok: true, trashId: "notetrash:first" } : { ok: false },
    ),
    setConfirm: (value: typeof confirmation) => {
      confirmation = value;
    },
    setUndo: vi.fn(),
    setDeletedNoteWithoutReceipt: vi.fn(),
    setNoteEdit: vi.fn(),
    errorFor: () => null,
    empty: () => null,
  } as unknown as AssistantRoom;
  // This fixture supplies only the snapshot fields read by NotesTab.
  const snapshot = {
    notes: [first, second],
    capabilities: { notes: true },
  } as unknown as AssistantSnapshot;
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(createElement(NotesTab, { snapshot })));
    const selectAll = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => selectAll.click());
    state.room.query = "Second";
    await act(async () => root.render(createElement(NotesTab, { snapshot })));
    expect(host.textContent).toContain("2 selected");
    const deleteButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete",
    )!;
    await act(async () => deleteButton.click());
    await act(async () => {
      await expect(confirmation!.onConfirm()).rejects.toThrow();
    });
    expect(host.textContent).toContain("1 selected");
    expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.checked).toBe(
      true,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
