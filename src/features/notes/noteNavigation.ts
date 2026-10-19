/** Explicit navigation from a session panel into the full note library. */
export const OPEN_NOTE_LIBRARY_EVENT = "bycoda:open-note-library";
export type NoteLibraryTarget = { id?: string; cwd?: string };
let pendingTarget: NoteLibraryTarget | null = null;

export function requestOpenNoteLibrary(target: NoteLibraryTarget) {
  pendingTarget = target;
  window.dispatchEvent(new Event(OPEN_NOTE_LIBRARY_EVENT));
}

export function takeNoteLibraryTarget() {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}
