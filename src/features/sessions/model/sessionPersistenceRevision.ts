import type { Session } from "./session";

const snapshots = new WeakMap<Session, string>();
let sequence = 0;

/** O(1) dirty stamp for an immutable snapshot. Store revision is renderer-local;
 * the sequence also distinguishes imported/remote snapshots outside the store.
 * This stamp is bookkeeping only: native writes retain their durable CAS revision.
 */
export function sessionPersistenceRevision(session: Session, storeRevision: number): string {
  let revision = snapshots.get(session);
  if (revision === undefined) {
    revision = `snapshot:${storeRevision}:${++sequence}`;
    snapshots.set(session, revision);
  }
  return revision;
}
