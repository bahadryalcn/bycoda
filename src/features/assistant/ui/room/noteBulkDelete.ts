import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";

export type NoteDeleteResult = { ok?: boolean; trashId?: string };

export type NoteBulkDeleteOutcome = {
  /** Recovery ids the Host confirmed, in deletion order. */
  trashIds: string[];
  /** Notes deleted without a `notetrash:` receipt; their copies are in Recently deleted. */
  withoutReceipt: string[];
  deleted: number;
  /** The first failure; deletion stops there so later notes stay untouched. */
  error?: unknown;
};

/**
 * Deletes notes one at a time through the single-note operation, so every note keeps its own
 * version check and recovery copy. Stops at the first failure instead of guessing past it.
 */
export async function deleteNotesInOrder(
  notes: readonly AssistantNote[],
  remove: (note: AssistantNote) => Promise<NoteDeleteResult>,
): Promise<NoteBulkDeleteOutcome> {
  const outcome: NoteBulkDeleteOutcome = { trashIds: [], withoutReceipt: [], deleted: 0 };
  for (const note of notes) {
    try {
      const result = await remove(note);
      if (result.ok !== true) throw new Error("Note deletion was not confirmed.");
      outcome.deleted += 1;
      if (result.trashId?.startsWith("notetrash:")) outcome.trashIds.push(result.trashId);
      else outcome.withoutReceipt.push(note.title);
    } catch (error) {
      outcome.error = error;
      break;
    }
  }
  return outcome;
}

/**
 * Restores recovery ids in order and returns the ids still deleted. Stops at the first failure
 * so the caller can keep the remainder for a later retry. `error` is the thrown error, absent
 * when the Host answered without confirming.
 */
export async function restoreNotesInOrder(
  ids: readonly string[],
  restore: (id: string) => Promise<{ ok?: boolean }>,
): Promise<{ remaining: string[]; error?: unknown }> {
  for (const [index, id] of ids.entries()) {
    try {
      if ((await restore(id)).ok !== true) return { remaining: ids.slice(index) };
    } catch (error) {
      return { remaining: ids.slice(index), error };
    }
  }
  return { remaining: [] };
}
