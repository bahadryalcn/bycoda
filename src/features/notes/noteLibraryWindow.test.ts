import { expect, it } from "vitest";
import { LIST_PAGE_SIZE } from "../../shared/lib/listWindow";
import { groupNoteLibrary } from "./noteLibrary";
import { noteLibraryItemIndex, windowNoteLibrary } from "./noteLibraryWindow";
import type { NoteSummary } from "./notes";

const notes: NoteSummary[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `note-${index}`,
  slug: `note-${index}`,
  title: `Note ${index}`,
  preview: "Preview",
  tags: [index % 2 ? "one" : "two"],
  sourceCwd: "/repo",
  createdAt: 1,
  updatedAt: 1,
}));

it("keeps the last selected note in a bounded window rather than mounting every preceding note", () => {
  const groups = groupNoteLibrary(notes, "none");
  const index = noteLibraryItemIndex(groups, new Set(), "note-999", false);
  const last = windowNoteLibrary(groups, new Set(), index, false);
  expect(last.start).toBe(992);
  expect(last.groups.flatMap((group) => group.notes)).toHaveLength(8);
  expect(last.groups[0].notes.at(-1)?.id).toBe("note-999");
  const first = windowNoteLibrary(groups, new Set(), 0, false);
  expect(first.groups[0].notes).toHaveLength(LIST_PAGE_SIZE);
});

it("retains group totals and collapsed headings while bounding tagged rows", () => {
  const groups = groupNoteLibrary(notes, "tag");
  const first = windowNoteLibrary(groups, new Set(), 0, true);
  expect(first.groups[0].totalNotes).toBe(500);
  expect(first.groups.reduce((sum, group) => sum + group.notes.length, 0)).toBeLessThanOrEqual(
    LIST_PAGE_SIZE,
  );
  const collapsed = new Set([groups[0].key]);
  const next = windowNoteLibrary(groups, collapsed, 0, true);
  expect(next.groups[0].notes).toHaveLength(0);
  expect(next.groups[0].totalNotes).toBe(500);
  expect(next.groups[1].notes.length).toBeLessThan(LIST_PAGE_SIZE);
  expect(noteLibraryItemIndex(groups, collapsed, groups[0].notes[0].id, true)).toBe(0);
});

it("clamps a stale page after filtering or deletion", () => {
  const first = windowNoteLibrary(
    groupNoteLibrary(notes.slice(0, 2), "project"),
    new Set(),
    960,
    true,
  );
  expect(first.start).toBe(0);
  expect(first.groups[0].notes).toHaveLength(2);
  expect(windowNoteLibrary([], new Set(), 960, true)).toMatchObject({
    groups: [],
    start: 0,
    total: 0,
  });
});

it("distinguishes rendered tag rows from unique notes and names bounded pages", () => {
  const repeated = notes.slice(0, 2).map((note) => ({ ...note, tags: ["one", "two"] }));
  const groups = groupNoteLibrary(repeated, "tag");
  expect(windowNoteLibrary(groups, new Set(), 0, true)).toMatchObject({
    rangeStart: 1,
    rangeEnd: 6,
    total: 6,
    uniqueTotal: 2,
    visibleUniqueCount: 2,
    pageNumber: 1,
    pageCount: 1,
    hasPrevious: false,
    hasNext: false,
  });
  expect(windowNoteLibrary(groups, new Set(groups.map((group) => group.key)), 0, true)).toMatchObject({
    total: 2,
    uniqueTotal: 2,
    visibleUniqueCount: 0,
  });
  expect(windowNoteLibrary([], new Set(), 0, true)).toMatchObject({
    rangeStart: 0, rangeEnd: 0, pageNumber: 0, pageCount: 0, uniqueTotal: 0,
  });
});
