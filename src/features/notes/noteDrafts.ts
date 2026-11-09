import type { Note } from "./notes";
import {
  NoteInputOwner,
  beginNoteWork,
  noteInputWorkError,
  type NoteInputWork,
} from "./notesInputOwners";

export type Edits = Partial<Pick<Note, "title" | "body" | "tags">>;
export type Draft = {
  edits: { current: Edits };
  project: { current: { path: string } | null };
  skipSave: { current: boolean };
  error: string | null;
  saved?: Note;
  base: Note;
  mounts?: number;
  inputOwner?: NoteInputOwner;
  unadmittedInputs?: string[];
  imageApplicationErrors?: { asset: { name: string; markdownPath: string }; message: string }[];
};
export function draftInputOwner(draft: Draft) {
  if (draft.inputOwner?.isRetiring()) draft.inputOwner = undefined;
  return (draft.inputOwner ??= new NoteInputOwner(() => {
    const current = draft.saved ?? draft.base;
    return {
      surface: draft.mounts ? "library" : "retained-draft",
      sourceSurface: "library",
      noteId: current.id,
      base: draft.base,
      lastSaved: draft.saved,
      edits: draft.edits.current,
      canonical: {
        ...current,
        ...draft.edits.current,
        ...(draft.project.current ? { sourceCwd: draft.project.current.path } : {}),
      },
      project: draft.project.current,
      skipSave: draft.skipSave.current,
      error: draft.error,
      unadmittedInputs: draft.unadmittedInputs,
      imageApplicationErrors: draft.imageApplicationErrors,
    };
  }));
}
export function removeNoteDraft(id: string) {
  const draft = drafts.get(id);
  drafts.delete(id);
  draft?.inputOwner?.retire();
}
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
const pendingPrunes = new WeakSet<Draft>();
export function pruneDraft(id: string, draft: Draft) {
  if (drafts.get(id) !== draft) return;
  if (
    draft.mounts ||
    draft.error ||
    draft.imageApplicationErrors?.length ||
    draft.project.current ||
    Object.keys(draft.edits.current).length ||
    noteSaveQueues.has(id)
  )
    return;
  const owner = draft.inputOwner;
  if (owner?.hasUnappliedPrivateInputs()) return;
  if (owner?.hasPendingWork()) {
    if (!pendingPrunes.has(draft)) {
      pendingPrunes.add(draft);
      void owner.whenSettled().then(() => {
        pendingPrunes.delete(draft);
        pruneDraft(id, draft);
      });
    }
    return;
  }
  if (drafts.get(id) === draft) removeNoteDraft(id);
  notifyDrafts();
}
export function notifyDrafts() {
  for (const draft of drafts.values()) {
    const owner = draft.inputOwner;
    if (owner?.closed() && !owner.allowed()) owner.external(() => {});
    else owner?.changed();
  }
  window.dispatchEvent(new Event(DRAFT_CHANGED_EVENT));
}

// Keep pending saves ordered across editor unmounts and reopened notes.
export const noteSaveQueues = new Map<string, { pending: Promise<void>; saved?: Note }>();

export function enqueueNoteSave(
  id: string,
  save: (latest?: Note, work?: NoteInputWork) => void | Promise<Note | void>,
  parent?: NoteInputWork,
) {
  const owner = drafts.get(id)?.inputOwner;
  const work = owner
    ? owner.operation("note-save-queue", parent)
    : beginNoteWork("note-save-queue", parent);
  if (!work) return Promise.reject(noteInputWorkError(owner));
  const queue = noteSaveQueues.get(id) ?? { pending: Promise.resolve() };
  const persist = async () => {
    const saved = await work.apply(() => save(queue.saved, work));
    if (saved) queue.saved = saved;
  };
  const pending = queue.pending.then(persist, persist).finally(() => {
    if (queue.pending === pending) noteSaveQueues.delete(id);
    work();
  });
  queue.pending = pending;
  noteSaveQueues.set(id, queue);
  return pending;
}
