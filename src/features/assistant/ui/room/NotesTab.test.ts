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
