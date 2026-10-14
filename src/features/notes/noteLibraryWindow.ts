import { LIST_PAGE_SIZE } from "../../shared/lib/listWindow";
import type { NoteLibraryGroup } from "./noteLibrary";
import type { NoteMetadata } from "./notes";

/** Group headings and note cards share a bounded page, including collapsed groups. */
export function windowNoteLibrary<NoteItem extends NoteMetadata>(
  groups: NoteLibraryGroup<NoteItem>[],
  collapsed: ReadonlySet<string>,
  requestedStart: number,
  headings: boolean,
) {
  const count = (group: NoteLibraryGroup<NoteItem>) =>
    Number(headings) + (collapsed.has(group.key) ? 0 : group.notes.length);
  const total = groups.reduce((sum, group) => sum + count(group), 0);
  const lastStart = Math.max(0, Math.floor((total - 1) / LIST_PAGE_SIZE) * LIST_PAGE_SIZE);
  const start = Math.max(
    0,
    Math.min(lastStart, Math.floor(requestedStart / LIST_PAGE_SIZE) * LIST_PAGE_SIZE),
  );
  const end = Math.min(total, start + LIST_PAGE_SIZE);
  let offset = 0;
  const windowed: (NoteLibraryGroup<NoteItem> & { totalNotes: number })[] = [];
  for (const group of groups) {
    const groupEnd = offset + count(group);
    if (groupEnd > start && offset < end) {
      const bodyStart = offset + Number(headings);
      windowed.push({
        ...group,
        totalNotes: group.notes.length,
        notes: collapsed.has(group.key)
          ? []
          : group.notes.slice(Math.max(0, start - bodyStart), Math.max(0, end - bodyStart)),
      });
    }
    offset = groupEnd;
    if (offset >= end) break;
  }
  return { groups: windowed, start, end, total };
}

export function noteLibraryItemIndex(
  groups: NoteLibraryGroup[],
  collapsed: ReadonlySet<string>,
  id: string | null,
  headings: boolean,
  preferredGroup?: string | null,
) {
  if (!id) return -1;
  let offset = 0;
  for (const group of groups) {
    const index = group.notes.findIndex((note) => note.id === id);
    if (index >= 0 && (!preferredGroup || preferredGroup === group.key))
      return collapsed.has(group.key) ? offset : offset + Number(headings) + index;
    offset += Number(headings) + (collapsed.has(group.key) ? 0 : group.notes.length);
  }
  if (preferredGroup) return noteLibraryItemIndex(groups, collapsed, id, headings);
  return -1;
}
