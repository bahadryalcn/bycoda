import type { ExtraWorktreeRecord } from "../git/git-worktrees";
import type { HostStore } from "../store";

/**
 * Durable rollback journal of the sibling worktrees a creation operation made, one row per
 * sibling path (upserted, so a retry never grows it and a rollback deletes its row). A row is
 * saved before Git runs, so a Host crash never leaves a sibling the journal does not know. Rows
 * turn `committed` together with the prepare result and then double as the workspace's sibling
 * list for removal and rename.
 */
export const loadSiblingJournal = (
  store: HostStore,
  operationId: string,
): Promise<ExtraWorktreeRecord[]> => store.workspaceSiblings({ operationId });

/** Returns a writer that makes each record durable; awaiting it guarantees the row exists. */
export function siblingJournalWriter(store: HostStore, operationId: string, workspaceId: string) {
  return (record: ExtraWorktreeRecord): Promise<void> =>
    store.saveWorkspaceSibling({ ...record, operationId, workspaceId });
}
