import { beforeEach, expect, it, vi } from "vitest";
import {
  invalidateNotes,
  loadNotes,
  peekNotes,
  upsertNote,
  deleteNote,
  linkNoteToSession,
  type Note,
} from "./notes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const note: Note = {
  id: "cache-test",
  slug: "cache",
  title: "Original",
  body: "",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  invoke.mockReset();
  invalidateNotes();
});

it("updates the cached list after edits, links and deletions without a full reload", async () => {
  invoke.mockResolvedValueOnce([note]);
  await loadNotes();
  const saved = { ...note, body: "Latest draft" };
  invoke.mockResolvedValueOnce(saved);
  await upsertNote(saved);
  expect(await loadNotes()).toEqual([saved]);
  const linked = { ...saved, sourceSessionId: "session-1" };
  invoke.mockResolvedValueOnce(linked);
  await linkNoteToSession(note.id, "session-1");
  expect(await loadNotes()).toEqual([linked]);
  invoke.mockResolvedValueOnce(undefined);
  await deleteNote(note.id);
  expect(await loadNotes()).toEqual([]);
  expect(invoke.mock.calls.filter(([command]) => command === "notes_list")).toHaveLength(1);
});

it("reports a refresh failure and retains previously loaded notes", async () => {
  invoke.mockResolvedValueOnce([note]);
  await loadNotes();
  invoke.mockRejectedValueOnce(new Error("Disk unavailable"));
  await expect(loadNotes(true)).rejects.toThrow("Disk unavailable");
  expect(peekNotes()).toEqual([note]);
});

it("does not cache a failed initial load as an empty success", async () => {
  invoke.mockRejectedValueOnce(new Error("Cannot read notes"));
  await expect(loadNotes(true)).rejects.toThrow("Cannot read notes");
  expect(peekNotes()).toBeNull();
});

it("keeps a newer refresh when an old response completes late", async () => {
  const old = deferred<Note[]>();
  invoke.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...note, title: "New" }]);
  const oldRequest = loadNotes(true);
  await loadNotes(true);
  old.resolve([note]);
  expect(await oldRequest).toEqual([{ ...note, title: "New" }]);
  expect(peekNotes()?.[0].title).toBe("New");
});

it("invalidates pending list responses after a mutation", async () => {
  const old = deferred<Note[]>();
  const saved = { ...note, title: "Saved", updatedAt: 2 };
  invoke
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(saved)
    .mockResolvedValueOnce([saved]);
  const oldRequest = loadNotes(true);
  await upsertNote(saved);
  await loadNotes(true);
  old.resolve([note]);
  expect(await oldRequest).toEqual([saved]);
  expect(peekNotes()).toEqual([saved]);
});

it("propagates the newest refresh failure to superseded callers without retrying", async () => {
  const old = deferred<Note[]>();
  let rejectNew!: (error: Error) => void;
  const newest = new Promise<Note[]>((_, reject) => {
    rejectNew = reject;
  });
  invoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(newest);
  const oldRequest = loadNotes(true);
  const newRequest = loadNotes(true);
  const newFailure = expect(newRequest).rejects.toThrow("Refresh unavailable");
  rejectNew(new Error("Refresh unavailable"));
  await newFailure;
  const oldFailure = expect(oldRequest).rejects.toThrow("Refresh unavailable");
  old.resolve([note]);
  await oldFailure;
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(peekNotes()).toBeNull();
});
