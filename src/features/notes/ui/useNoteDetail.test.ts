// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNoteDetail } from "../useNoteDetail";
import * as noteOwners from "../notesInputOwners";
import {
  getNote,
  invalidateNotes,
  loadNoteSummaries,
  summarizeNote,
  type Note,
  type NoteSummary,
} from "../notes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const original: Note = {
  id: "detail-version",
  slug: "detail",
  title: "Detail",
  body: "Old body",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};
let root: Root;
let summary: NoteSummary;
let result: ReturnType<typeof useNoteDetail>;
function Probe() {
  result = useNoteDetail(summary);
  return null;
}
const render = () => act(async () => root.render(createElement(Probe)));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  invalidateNotes();
  summary = summarizeNote(original);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("refetches an older deduplicated read when the selected summary advances", async () => {
  let resolve!: (value: Note) => void;
  const latest = { ...original, body: "Current body", updatedAt: 2 };
  invoke.mockImplementation(async (command: string) => {
    if (command === "notes_list_summaries") return [summarizeNote(latest)];
    if (command === "notes_get")
      return new Promise<Note>((done) => {
        resolve = done;
      });
    throw new Error(command);
  });
  await render();
  await act(async () => {
    summary = (await loadNoteSummaries(true))[0];
  });
  await render();
  invoke.mockResolvedValueOnce(latest);
  await act(async () => resolve(original));
  expect(result.note?.body).toBe("Current body");
  expect(result.note?.updatedAt).toBe(2);
  expect(invoke.mock.calls.filter(([command]) => command === "notes_get")).toHaveLength(2);
});

it("stops after one fresh read when storage still returns an older version", async () => {
  summary = summarizeNote({ ...original, updatedAt: 2 });
  invoke.mockResolvedValue(original);
  await render();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(result.note).toBeNull();
  expect(result.loading).toBe(false);
  expect(result.error).toContain("changed on the computer");
});

it("does not bypass another selected note's cache after a prior retry", async () => {
  invoke.mockRejectedValueOnce(new Error("Read unavailable"));
  await render();
  expect(result.error).toBe("Read unavailable");
  invoke.mockResolvedValueOnce(original);
  await act(async () => result.retry());
  const other = { ...original, id: "cached-other", title: "Other" };
  invoke.mockResolvedValueOnce(other);
  await getNote(other.id);
  invoke.mockClear();
  summary = summarizeNote(other);
  await render();
  expect(result.note?.id).toBe(other.id);
  expect(invoke).not.toHaveBeenCalled();
});

it("allows another retry after note-read admission was refused", async () => {
  vi.spyOn(noteOwners, "beginNoteWork").mockReturnValueOnce(null).mockReturnValueOnce(null);
  invoke.mockResolvedValue(original);
  await render();
  await act(async () => result.retry());
  expect(result.retrying).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => result.retry());
  expect(result.note?.id).toBe(original.id);
});
