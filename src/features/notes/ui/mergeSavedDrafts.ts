import { drafts } from "../noteDrafts";
import { summarizeNote, type NoteSummary } from "../notes";

/** Folds newer saved drafts into the list; returns the same array when no row changed. */
export function mergeSavedDrafts(current: NoteSummary[]): NoteSummary[] {
  let changed = false;
  const next = current.map((note) => {
    const saved = drafts.get(note.id)?.saved;
    if (!saved || saved.updatedAt <= note.updatedAt) return note;
    changed = true;
    return summarizeNote(saved);
  });
  return changed ? next : current;
}
