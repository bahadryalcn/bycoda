import { beforeEach, expect, it, vi } from "vitest";
import {
  applyNotesToTurn,
  getNote,
  invalidateNotes,
  loadNoteSummaries,
  peekNoteDetail,
  peekNoteSummaries,
  upsertNote,
  type Note,
  type NoteSummary,
} from "./notes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const summary: NoteSummary = {
  id: "one",
  slug: "plan",
  title: "Plan",
  preview: "Short preview",
  tags: ["ideas"],
  createdAt: 1,
  updatedAt: 1,
};
const note: Note = { ...summary, body: "Full text beyond the preview" };

beforeEach(() => {
  invoke.mockReset();
  invalidateNotes();
});

it("deduplicates summary requests without fetching bodies and keeps mutation results bounded", async () => {
  invoke.mockResolvedValueOnce([summary]);
  expect(await Promise.all([loadNoteSummaries(), loadNoteSummaries()])).toEqual([
    [summary],
    [summary],
  ]);
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("notes_list_summaries");
  expect(peekNoteDetail(summary.id, summary.updatedAt)).toBeNull();
  const saved = { ...note, body: "x".repeat(20_000), updatedAt: 2 };
  invoke.mockResolvedValueOnce(saved);
  await upsertNote(saved);
  expect(peekNoteSummaries()?.[0]).not.toHaveProperty("body");
  expect(peekNoteSummaries()?.[0].preview.length).toBeLessThanOrEqual(120);
  expect(peekNoteDetail(saved.id, saved.updatedAt)?.body).toBe(saved.body);
});

it("supersedes a late summary read and preserves the newest failure", async () => {
  let finish!: (values: NoteSummary[]) => void;
  invoke
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce([{ ...summary, title: "Latest" }]);
  const old = loadNoteSummaries(true);
  await loadNoteSummaries(true);
  finish([summary]);
  expect((await old)[0].title).toBe("Latest");
  invoke.mockRejectedValueOnce(new Error("Read unavailable"));
  await expect(loadNoteSummaries(true)).rejects.toThrow("Read unavailable");
  expect(peekNoteSummaries()?.[0].title).toBe("Latest");
});

it("deduplicates selected-body reads and does not cache late bodies after invalidation", async () => {
  let finish!: (value: Note) => void;
  invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const reads = [getNote(note.id), getNote(note.id)];
  expect(invoke).toHaveBeenCalledOnce();
  invalidateNotes();
  finish(note);
  expect(await Promise.all(reads)).toEqual([note, note]);
  expect(peekNoteDetail(note.id, note.updatedAt)).toBeNull();
});

it("resolves mention bodies only for referenced notes, preserving the complete prompt", async () => {
  invoke.mockImplementation(async (command: string, params?: { id: string }) => {
    if (command === "notes_list_summaries")
      return [summary, { ...summary, id: "two", slug: "unused" }];
    if (command === "notes_get") return params?.id === note.id ? note : null;
    throw new Error(command);
  });
  const prompt = await applyNotesToTurn("Review @note/plan and @note/plan.");
  expect(prompt).toContain(note.body);
  expect(prompt).not.toContain(summary.preview);
  expect(invoke.mock.calls.filter(([command]) => command === "notes_get")).toEqual([
    ["notes_get", { id: "one" }],
  ]);
  expect(invoke.mock.calls.some(([command]) => command === "notes_list")).toBe(false);
});
