import { projectDisplayName } from "../projects/model/projectNames";
import { pathKey } from "../../shared/lib/paths";
import { noteSourceProject, type NoteMetadata } from "./notes";

export type NoteGrouping = "project" | "tag" | "none";
export type NoteSort = "updated" | "created" | "title";
export type NoteLibraryPreferences = { grouping: NoteGrouping; sort: NoteSort };
const PREFERENCES_KEY = "bycoda.notes.library.v1";

export function loadNoteLibraryPreferences(): NoteLibraryPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    return {
      grouping: ["project", "tag", "none"].includes(value?.grouping) ? value.grouping : "project",
      sort: ["updated", "created", "title"].includes(value?.sort) ? value.sort : "updated",
    };
  } catch {
    return { grouping: "project", sort: "updated" };
  }
}

export function saveNoteLibraryPreferences(value: NoteLibraryPreferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
  } catch {
    // Browsing and editing still work if storage is unavailable.
  }
}

export function noteProjectKey(note: NoteMetadata) {
  return noteSourceProject(note.sourceCwd) && note.sourceCwd ? pathKey(note.sourceCwd) : "";
}

export function noteLibraryProjects(notes: readonly NoteMetadata[]) {
  const projects = new Map<string, { key: string; path: string; name: string; count: number }>();
  for (const note of notes) {
    const key = noteProjectKey(note);
    if (!key) continue;
    const project = projects.get(key);
    if (project) project.count += 1;
    else
      projects.set(key, {
        key,
        path: note.sourceCwd!,
        name: projectDisplayName(note.sourceCwd!),
        count: 1,
      });
  }
  return [...projects.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
}

export function filterNoteLibrary<NoteItem extends NoteMetadata>(
  notes: readonly NoteItem[],
  {
    query,
    project,
    tag,
    sort,
    bodyMatches,
  }: {
    query: string;
    project: string | null;
    tag: string | null;
    sort: NoteSort;
    bodyMatches?: ReadonlySet<string>;
  },
) {
  const needle = query.trim().toLocaleLowerCase();
  return notes
    .filter((note) => {
      if (project !== null && noteProjectKey(note) !== project) return false;
      if (tag !== null && !note.tags.includes(tag)) return false;
      return (
        !needle ||
        bodyMatches?.has(note.id) ||
        [
          note.title,
          "body" in note && typeof note.body === "string" ? note.body : "",
          "preview" in note && typeof note.preview === "string" ? note.preview : "",
          note.slug,
          note.sourceCwd ?? "",
          ...note.tags.map((value) => `#${value}`),
        ].some((value) => value.toLocaleLowerCase().includes(needle))
      );
    })
    .sort((a, b) => {
      const order =
        sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "created"
            ? b.createdAt - a.createdAt
            : (b.contentUpdatedAt ?? b.updatedAt) - (a.contentUpdatedAt ?? a.updatedAt);
      return order || a.id.localeCompare(b.id);
    });
}

export type NoteLibraryGroup<NoteItem extends NoteMetadata = NoteMetadata> = {
  key: string;
  label: string;
  path?: string;
  notes: NoteItem[];
};
export function groupNoteLibrary<NoteItem extends NoteMetadata>(
  notes: NoteItem[],
  grouping: NoteGrouping,
): NoteLibraryGroup<NoteItem>[] {
  if (grouping === "none") return [{ key: "all", label: "", notes }];
  const groups = new Map<string, NoteLibraryGroup<NoteItem>>();
  for (const note of notes) {
    const entries =
      grouping === "project"
        ? [
            {
              key: `project:${noteProjectKey(note)}`,
              label: noteSourceProject(note.sourceCwd) ?? "",
              path: note.sourceCwd,
            },
          ]
        : (note.tags.length ? note.tags : [""]).map((tag) => ({
            key: `tag:${tag}`,
            label: tag ? `#${tag}` : "",
            path: undefined,
          }));
    for (const entry of entries) {
      const group = groups.get(entry.key);
      if (group) group.notes.push(note);
      else groups.set(entry.key, { ...entry, notes: [note] });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(!a.label) - Number(!b.label) ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
}
