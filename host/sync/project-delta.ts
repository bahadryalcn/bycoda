import { createHash } from "node:crypto";
import type { ProjectSessionsDelta } from "../../src/features/connections/model/projectSessionDelta";

type Row = { id: string };
type State = {
  /** The revision the receiver holds; a delta is only computed against it. */
  revision: number;
  etag: string;
  ids: string[];
  /** Row fingerprints the receiver is known to hold. */
  hashes: Map<string, string>;
};
export type ProjectStreamRead<T extends Row> =
  | { kind: "snapshot"; revision: number; value: { etag: string; sessions: T[] } }
  | { kind: "delta"; revision: number; base: number; value: ProjectSessionsDelta<T> }
  | { kind: "unchanged"; revision: number };

/** Sender-state key for one principal's delta stream of a project; ids may contain ":". */
export function projectStreamKey(principalId: string, projectId: string): string {
  return JSON.stringify([principalId, projectId]);
}

/** The project id inside a `projectStreamKey`. */
export function projectStreamProjectId(key: string): string {
  return (JSON.parse(key) as [string, string])[1];
}

function rowHash(row: Row): string {
  return createHash("sha1").update(JSON.stringify(row)).digest("base64");
}

/**
 * Order hint of a delta: the shortest prefix of the new order after which only previous
 * rows follow, in their previous order; absent when that prefix is empty. A row moved
 * or added to the front (the usual change) makes a one-id head. Every surviving row is
 * in the new list, so the receiver's `head + (previous minus removed minus head)` is it.
 */
function orderHint(previous: string[], next: string[]): string[] | undefined {
  const position = new Map(previous.map((id, index) => [id, index]));
  let start = next.length;
  let after = Number.POSITIVE_INFINITY;
  while (start > 0) {
    const at = position.get(next[start - 1]!);
    if (at === undefined || at >= after) break;
    after = at;
    start--;
  }
  return start ? next.slice(0, start) : undefined;
}

/**
 * Per-stream sender state for project session list deltas (`projectSessionDelta.ts`).
 * A delta is computed only when the stream's committed revision equals the state's
 * revision, so an event the hub dropped can never leave the receiver with rows the
 * sender assumed; anything else is a snapshot.
 */
export class ProjectDeltaEncoder {
  private readonly states = new Map<string, State>();
  private revision = 0;

  encode<T extends Row>(
    key: string,
    current: { etag: string; list: T[] },
    committed: number | undefined,
    forceSnapshot: boolean,
  ): ProjectStreamRead<T> {
    const previous = this.states.get(key);
    const hashes = new Map(current.list.map((row) => [row.id, rowHash(row)]));
    const ids = current.list.map((row) => row.id);
    if (forceSnapshot || !previous || committed === undefined || previous.revision !== committed) {
      const revision = ++this.revision;
      this.states.set(key, { revision, etag: current.etag, ids, hashes });
      return { kind: "snapshot", revision, value: { etag: current.etag, sessions: current.list } };
    }
    const sessions = current.list.filter(
      (row) => previous.hashes.get(row.id) !== hashes.get(row.id),
    );
    const removed = previous.ids.filter((id) => !hashes.has(id));
    const head = orderHint(previous.ids, ids);
    if (!sessions.length && !removed.length && !head && current.etag === previous.etag)
      return { kind: "unchanged", revision: previous.revision };
    const revision = ++this.revision;
    this.states.set(key, { revision, etag: current.etag, ids, hashes });
    return {
      kind: "delta",
      revision,
      base: previous.revision,
      value: {
        etag: current.etag,
        sessions,
        ...(removed.length ? { removed } : {}),
        ...(head ? { head } : {}),
      },
    };
  }

  /** Forget streams whose key the caller no longer needs. */
  retain(keep: (key: string) => boolean): void {
    for (const key of this.states.keys()) if (!keep(key)) this.states.delete(key);
  }
}
