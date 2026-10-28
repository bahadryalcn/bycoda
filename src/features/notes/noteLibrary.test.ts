import { describe, expect, it } from "vitest";
import {
  filterNoteLibrary,
  groupNoteLibrary,
  noteLibraryProjects,
  noteLibraryDate,
  noteLibraryMatchLocation,
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
  it("explains deep body matches without pretending a truncated summary contains the match", () => {
    const summary = { ...note("deep"), body: undefined, preview: "Opening paragraph" };
    const matches = new Set(["deep"]);
    expect(noteLibraryMatchLocation(summary, "needle", matches)).toBe("content");
    expect(noteLibraryMatchLocation(summary, "opening", matches)).toBe("preview");
    expect(noteLibraryMatchLocation(summary, "deep", matches)).toBe("title");
    expect(noteLibraryMatchLocation(summary, "needle")).toBeNull();
    expect(noteLibraryMatchLocation(summary, "", matches)).toBeNull();
    expect(noteLibraryMatchLocation({ ...summary, tags: ["later"] }, "#later", matches)).toBe("metadata");
  });

  it("shows the timestamp used for created or content-updated sorting", () => {
    const original = { ...note("a"), createdAt: 10, updatedAt: 900, contentUpdatedAt: 20 };
    const newerContent = { ...note("b"), createdAt: 5, updatedAt: 500, contentUpdatedAt: 30 };
    expect(noteLibraryDate(original, "updated")).toEqual({ timestamp: 20, label: "Updated" });
    expect(noteLibraryDate(original, "created")).toEqual({ timestamp: 10, label: "Created" });
    expect(noteLibraryDate(note("legacy"), "updated")).toEqual({ timestamp: 1, label: "Updated" });
    expect(filterNoteLibrary([original, newerContent], {
      query: "", project: null, tag: null, sort: "updated",
    }).map((entry) => entry.id)).toEqual(["b", "a"]);
  });

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
