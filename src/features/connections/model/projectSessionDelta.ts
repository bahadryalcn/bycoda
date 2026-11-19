/**
 * Wire form of a project session list stream opened with `target.delta` on hosts
 * advertising `transport.ws.projects.delta.v1`. A snapshot carries the whole list;
 * a delta carries only changed or added rows, removed ids and an order hint against
 * the receiver's previous list. The receiver rebuilds the full list or throws, which
 * retires the stream to the polled snapshot path.
 */
export const PROJECT_DELTA_CAPABILITY = "transport.ws.projects.delta.v1";

export type ProjectSessionsDelta<T> = {
  etag: string;
  /** Changed or added rows. */
  sessions: T[];
  removed?: string[];
  /**
   * The new order up to the longest suffix it shares with the surviving previous rows;
   * those rows follow in their previous order. Absent when that order did not change.
   */
  head?: string[];
};

/** What a project stream receiver holds from its previous events. */
export type ProjectStreamState<T> = { revision: number; rows: Map<string, T>; ids: string[] };

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

/**
 * Rebuild the full list from a delta at `revision` following `base`. Throws when the
 * delta does not follow `state` or names rows it does not carry. Never mutates `state`.
 */
export function applyProjectDelta<T extends { id: string }>(
  state: ProjectStreamState<T> | undefined,
  raw: unknown,
  base: number | undefined,
  revision: number | undefined,
  parseRow: (row: unknown) => T,
): { etag: string; next: ProjectStreamState<T> } {
  if (!state || base === undefined || state.revision !== base)
    throw new Error("Host project delta does not follow the held list");
  if (revision === undefined || !Number.isSafeInteger(revision) || revision <= base)
    throw new Error("Invalid project session delta");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("Invalid project session delta");
  const delta = raw as Record<string, unknown>;
  const allowed = new Set(["etag", "sessions", "removed", "head"]);
  if (
    Object.keys(delta).some((key) => !allowed.has(key)) ||
    typeof delta.etag !== "string" ||
    !Array.isArray(delta.sessions) ||
    (delta.removed !== undefined && !stringList(delta.removed)) ||
    (delta.head !== undefined && !stringList(delta.head))
  )
    throw new Error("Invalid project session delta");
  const removed = new Set(delta.removed as string[] | undefined);
  const rows = new Map(state.rows);
  for (const id of removed) {
    if (!rows.has(id)) throw new Error("Project delta removes an unknown session");
    rows.delete(id);
  }
  const changed = new Set<string>();
  for (const value of delta.sessions) {
    const row = parseRow(value);
    if (removed.has(row.id) || changed.has(row.id))
      throw new Error("Project delta repeats a session");
    changed.add(row.id);
    rows.set(row.id, row);
  }
  const head = delta.head as string[] | undefined;
  const moved = new Set(head);
  const ids = state.ids.filter((id) => !removed.has(id) && !moved.has(id));
  if (head) ids.unshift(...head);
  if (
    ids.length !== rows.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !rows.has(id))
  )
    throw new Error("Project delta order does not match its sessions");
  return { etag: delta.etag, next: { revision, rows, ids } };
}

/** The ordered list a stream state holds. */
export function projectStreamList<T>(state: ProjectStreamState<T>): T[] {
  return state.ids.map((id) => state.rows.get(id)!);
}
