import { describe, expect, it } from "vitest";
import {
  groupCreateScope,
  noteMenuItems,
  noteMenuSelectedScope,
  type NoteMenuContext,
} from "./noteLibraryMenu";

const context = (overrides: Partial<NoteMenuContext> = {}): NoteMenuContext => ({
  openId: null,
  selectionMode: false,
  checkedIds: new Set(),
  creating: false,
  deleting: false,
  ...overrides,
});

const ids = (items: ReturnType<typeof noteMenuItems>) =>
  items.flatMap((item) => (item.kind === "item" ? [item.id] : []));
const find = (items: ReturnType<typeof noteMenuItems>, id: string) =>
  items.find((item) => item.kind === "item" && item.id === id);

describe("note library menu items", () => {
  const note = { kind: "note", id: "a", group: "g" } as const;

  it("offers only existing note actions and never invents move or duplicate", () => {
    const items = noteMenuItems(note, context());
    expect(ids(items)).toEqual(["open", "edit-title", "add-to-chat", "toggle-check", "delete"]);
    expect(ids(items).some((id) => /move|duplicate|copy/.test(id))).toBe(false);
  });

  it("omits Open for the note already in the editor", () => {
    expect(ids(noteMenuItems(note, context({ openId: "a" })))).not.toContain("open");
    expect(ids(noteMenuItems(note, context({ openId: "b" })))).toContain("open");
  });

  it("marks delete as danger and blocks selection and delete while a delete is pending", () => {
    const idle = noteMenuItems(note, context());
    expect(find(idle, "delete")).toMatchObject({ danger: true, disabled: false });
    const busy = noteMenuItems(note, context({ deleting: true }));
    expect(find(busy, "delete")).toMatchObject({ disabled: true });
    expect(find(busy, "toggle-check")).toMatchObject({ disabled: true });
  });

  it("labels the checkbox action by the target note's own state", () => {
    const unchecked = noteMenuItems(note, context({ selectionMode: true }));
    const checked = noteMenuItems(
      note,
      context({ selectionMode: true, checkedIds: new Set(["a"]) }),
    );
    expect(find(unchecked, "toggle-check")).toMatchObject({ label: "Select note" });
    expect(find(checked, "toggle-check")).toMatchObject({ label: "Deselect note" });
  });

  it("offers group headings a scoped new note and a collapse toggle only", () => {
    const group = {
      kind: "group",
      key: "project:x",
      label: "Mobile",
      path: "G:/p/mobile",
    } as const;
    const items = noteMenuItems(group, context());
    expect(ids(items)).toEqual(["new-note", "toggle-group"]);
    expect(find(items, "new-note")).toMatchObject({ label: "New note in Mobile" });
    expect(find(items, "toggle-group")).toMatchObject({ label: "Collapse group" });
    expect(find(noteMenuItems(group, context({ collapsed: true })), "toggle-group")).toMatchObject({
      label: "Expand group",
    });
    expect(find(noteMenuItems(group, context({ creating: true })), "new-note")).toMatchObject({
      disabled: true,
    });
  });

  it("shortens a long group name in the action label only", () => {
    const label = "an-extremely-long-project-folder-name-that-needs-truncation";
    const items = noteMenuItems({ kind: "group", key: "project:x", label }, context());
    const text = (find(items, "new-note") as { label: string }).label;
    expect(text.startsWith("New note in an-extremely-long-")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(40);
  });

  it("offers the empty area one new-note action describing where it lands", () => {
    const items = noteMenuItems(
      { kind: "library" },
      context({ scopeLabel: "upstream · #ideas", creating: true }),
    );
    expect(ids(items)).toEqual(["new-note"]);
    expect(find(items, "new-note")).toMatchObject({
      description: "upstream · #ideas",
      disabled: true,
    });
  });
});

describe("note menu multi-select scope", () => {
  const checked = new Set(["a", "b", "c"]);

  it("widens to the selection only when the clicked note belongs to it", () => {
    expect(noteMenuSelectedScope("a", true, checked).sort()).toEqual(["a", "b", "c"]);
    expect(noteMenuSelectedScope("z", true, checked)).toEqual([]);
  });

  it("stays single outside selection mode or with a lone checked note", () => {
    expect(noteMenuSelectedScope("a", false, checked)).toEqual([]);
    expect(noteMenuSelectedScope("a", true, new Set(["a"]))).toEqual([]);
  });

  it("adds a bulk delete item next to the single delete only for a checked note", () => {
    const member = noteMenuItems(
      { kind: "note", id: "a", group: "g" },
      context({ selectionMode: true, checkedIds: checked }),
    );
    expect(ids(member)).toContain("delete");
    expect(find(member, "delete-selected")).toMatchObject({
      label: "Delete selected (3)",
      danger: true,
    });
    const outsider = noteMenuItems(
      { kind: "note", id: "z", group: "g" },
      context({ selectionMode: true, checkedIds: checked }),
    );
    expect(ids(outsider)).not.toContain("delete-selected");
    expect(find(outsider, "delete")).toBeDefined();
  });

  it("disables the bulk delete while a delete is pending", () => {
    const items = noteMenuItems(
      { kind: "note", id: "a", group: "g" },
      context({ selectionMode: true, checkedIds: checked, deleting: true }),
    );
    expect(find(items, "delete-selected")).toMatchObject({ disabled: true });
  });
});

describe("group create scope", () => {
  it("uses the project path for project groups", () => {
    expect(groupCreateScope("project", { key: "project:x", path: "G:/p/x" })).toEqual({
      sourceCwd: "G:/p/x",
    });
  });

  it("has no scope for a group without a project", () => {
    expect(groupCreateScope("project", { key: "project:" })).toBeNull();
  });

  it("uses the tag for tag groups and none for untagged", () => {
    expect(groupCreateScope("tag", { key: "tag:ideas" })).toEqual({ tags: ["ideas"] });
    expect(groupCreateScope("tag", { key: "tag:" })).toBeNull();
    expect(groupCreateScope("tag", { key: "untagged" })).toBeNull();
  });

  it("has no scope when notes are not grouped", () => {
    expect(groupCreateScope("none", { key: "all", path: "G:/p/x" })).toBeNull();
  });
});
