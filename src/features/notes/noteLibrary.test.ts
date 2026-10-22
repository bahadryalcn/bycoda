import { describe, expect, it } from "vitest";
import {
  filterNoteLibrary,
  groupNoteLibrary,
  noteLibraryProjects,
  type NoteGrouping,
} from "./noteLibrary";
import type { Note } from "./notes";

const note = (id: string, sourceCwd?: string, tags: string[] = []): Note => ({
  id,
  slug: id,
  title: id,
  body: `Body ${id}`,
  tags,
  sourceCwd,
  createdAt: 1,
  updatedAt: 1,
});

describe("note library", () => {
  it("keeps equal folder names and remote hosts distinct, while merging equivalent Windows paths", () => {
    const notes = [
      note("a", "G:/one/Project"),
      note("b", "g:\\one\\project\\"),
      note("c", "G:/two/Project"),
      note("d", "remote://host-a/work/Project"),
      note("e", "remote://host-b/work/Project"),
      note("f"),
    ];
    expect(
      noteLibraryProjects(notes)
        .map((project) => project.count)
        .sort(),
    ).toEqual([1, 1, 1, 2]);
    expect(
      groupNoteLibrary(notes, "project")
        .map((group) => group.notes.length)
        .sort(),
    ).toEqual([1, 1, 1, 1, 2]);
  });

  it("combines body search, exact project and tag filters without mutating the input", () => {
    const notes = [
      note("a", "/work/A", ["ideas"]),
      note("b", "/work/B", ["ideas"]),
      note("c", "/work/A", ["todo"]),
    ];
    expect(
      filterNoteLibrary(notes, {
        query: "BODY",
        project: "/work/A",
        tag: "ideas",
        sort: "title",
      }).map((note) => note.id),
    ).toEqual(["a"]);
    expect(
      filterNoteLibrary(notes, { query: "#todo", project: null, tag: null, sort: "updated" }).map(
        (note) => note.id,
      ),
    ).toEqual(["c"]);
    expect(notes.map((note) => note.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by the requested field with stable ties and keeps unassigned notes accessible", () => {
    const notes = [
      { ...note("z"), createdAt: 8, updatedAt: 2 },
      { ...note("a"), createdAt: 1, updatedAt: 9 },
    ];
    const filter = { query: "", project: "", tag: null };
    expect(filterNoteLibrary(notes, { ...filter, sort: "created" }).map((note) => note.id)).toEqual(
      ["z", "a"],
    );
    expect(filterNoteLibrary(notes, { ...filter, sort: "updated" }).map((note) => note.id)).toEqual(
      ["a", "z"],
    );
  });

  it.each<NoteGrouping>(["tag", "project", "none"])(
    "retains all notes when grouping by %s",
    (grouping) => {
      const notes = [note("a", undefined, ["one", "two"]), note("b")];
      const groups = groupNoteLibrary(notes, grouping);
      expect(new Set(groups.flatMap((group) => group.notes.map((note) => note.id)))).toEqual(
        new Set(["a", "b"]),
      );
      if (grouping === "tag")
        expect(groups.find((group) => group.label === "#two")?.notes[0].id).toBe("a");
    },
  );
});
