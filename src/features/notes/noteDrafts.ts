import type { Note } from "./notes";

export type Edits = Partial<Pick<Note, "title" | "body" | "tags">>;
export type Draft = {
  edits: { current: Edits };
  project: { current: { path: string } | null };
  skipSave: { current: boolean };
  error: string | null;
  saved?: Note;
  base: Note;
  mounts?: number;
};
// Session-lifetime recovery: keep unsaved content outside editor/view mounts.
export const drafts = new Map<string, Draft>();
export const DRAFT_CHANGED_EVENT = "bycoda:note-draft-changed";
let viewMounts = 0;
export function isNotesViewOpen() {
  return viewMounts > 0;
}
export function mountNotesView() {
  viewMounts += 1;
  notifyDrafts();
  return () => {
    viewMounts = Math.max(0, viewMounts - 1);
    notifyDrafts();
  };
}
export function pruneDraft(id: string, draft: Draft) {
  if (
    draft.mounts ||
    draft.error ||
    draft.project.current ||
    Object.keys(draft.edits.current).length ||
    noteSaveQueues.has(id)
  )
    return;
  if (drafts.get(id) === draft) drafts.delete(id);
  notifyDrafts();
}
export function notifyDrafts() {
  window.dispatchEvent(new Event(DRAFT_CHANGED_EVENT));
}

// Keep pending saves ordered across editor unmounts and reopened notes.
export const noteSaveQueues = new Map<string, { pending: Promise<void>; saved?: Note }>();

export function enqueueNoteSave(id: string, save: (latest?: Note) => void | Promise<Note | void>) {
  const queue = noteSaveQueues.get(id) ?? { pending: Promise.resolve() };
  const persist = async () => {
    const saved = await save(queue.saved);
    if (saved) queue.saved = saved;
  };
  const pending = queue.pending.then(persist, persist).finally(() => {
    if (queue.pending === pending) noteSaveQueues.delete(id);
  });
  queue.pending = pending;
  noteSaveQueues.set(id, queue);
  return pending;
}
