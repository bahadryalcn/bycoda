import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateNotes, noteHeading, upsertNote, withNoteHeading, type Note } from "./notes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("noteHeading", () => {
  it("returns the first level-one heading, unwrapped", () => {
    expect(noteHeading("intro\n# **Release** planning\n\n# Second")).toBe("Release planning");
  });
  it("ignores deeper headings and headings inside code fences", () => {
    expect(noteHeading("## Sub\n```\n# not a title\n```\ntext")).toBeUndefined();
    expect(noteHeading("plain text")).toBeUndefined();
  });
});

describe("withNoteHeading", () => {
  it("rewrites only the first level-one heading", () => {
    expect(withNoteHeading("# Old\n\nbody\n# Other", "New name")).toBe(
      "# New name\n\nbody\n# Other",
    );
  });
  it("leaves a body without a level-one heading unchanged", () => {
    expect(withNoteHeading("body only", "New name")).toBe("body only");
  });
});

describe("saved note name", () => {
  beforeEach(() => {
    invoke.mockReset();
    invalidateNotes();
  });
  const saved = (title: string): Note => ({
    id: "n1",
    slug: "n1",
    title,
    body: "",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
  });
  it("stores the first heading as the name so the two never differ", async () => {
    invoke.mockResolvedValueOnce(saved("Release checklist"));
    await upsertNote({
      id: "n1",
      expectedUpdatedAt: 1,
      title: "Release planning",
      body: "# Release checklist\n\nitems",
      tags: [],
    });
    expect(invoke).toHaveBeenCalledWith("notes_upsert", {
      note: expect.objectContaining({ title: "Release checklist" }),
    });
  });
  it("keeps the saved name of a note without a heading", async () => {
    invoke.mockResolvedValueOnce(saved("Legacy name"));
    await upsertNote({
      id: "n1",
      expectedUpdatedAt: 1,
      title: "Legacy name",
      body: "no heading here",
      tags: [],
    });
    expect(invoke).toHaveBeenCalledWith("notes_upsert", {
      note: expect.objectContaining({ title: "Legacy name" }),
    });
  });
});
