import type { Block } from "../../src/features/sessions/model/session";
import {
  blockDigest,
  isDigestBlock,
  projectedDigest,
  transcriptDigests,
} from "../../src/features/sync/model/conversationDigest";
import { buildChains, rememberChains } from "../../src/features/sync/model/conversationHead";

/**
 * Digests of a desktop transcript, reused across refreshes by block id and desktop
 * revision. The desktop bumps a block's revision whenever its stored JSON changes, so an
 * unchanged revision means an unchanged block and its digest is reused without hashing.
 * Every result equals `transcriptDigests(blocks)`; whatever the revisions cannot vouch
 * for falls back to it.
 */

type Snapshot = { session: { blocks: readonly Block[] }; blockRevisions?: Record<string, number> };

/** The per-session state, as parallel arrays so an unchanged transcript costs no allocation. */
type Entry = {
  blocks: number;
  /** Every block, in order: the id and revision that cover it. */
  allIds: string[];
  allRevisions: number[];
  /** The blocks that take part in a comparison, in order. */
  ids: string[];
  revisions: number[];
  roles: string[];
  lengths: number[];
  digests: string[];
  chains: readonly string[];
  /** The snapshot whose blocks `digests` describe, and whether it matched the one before. */
  lastSnapshot?: object;
  lastEqual: boolean;
  /** The host transcript at this revision equals `lastSnapshot`. Cleared on any change. */
  agreed?: { hostRevision: number };
};
type Columns = Pick<
  Entry,
  "allIds" | "allRevisions" | "ids" | "revisions" | "roles" | "lengths" | "digests"
>;

const MAX_SESSIONS = 64;
const MAX_BLOCKS = 200_000;
const MAX_SESSION_BLOCKS = 100_000;

/** Per owner (one engine), least recently used sessions first. */
const owners = new WeakMap<object, Map<string, Entry>>();

/** Digest arrays whose chains this module has already remembered. */
const chained = new WeakSet<readonly string[]>();

/** Held transcripts (the host's blocks) and their digests, by the blocks array. */
const held = new WeakMap<readonly Block[], string[] | undefined>();

function emptyEntry(blocks: number): Entry {
  return {
    blocks,
    allIds: [],
    allRevisions: [],
    ids: [],
    revisions: [],
    roles: [],
    lengths: [],
    digests: [],
    chains: [],
    lastEqual: false,
  };
}

/** The session's entry, moved to most recently used, with the budget enforced. */
function entryFor(owner: object, sessionId: string, blocks: number): Entry {
  let sessions = owners.get(owner);
  if (!sessions) owners.set(owner, (sessions = new Map()));
  const entry = sessions.get(sessionId) ?? emptyEntry(blocks);
  sessions.delete(sessionId);
  entry.blocks = blocks;
  sessions.set(sessionId, entry);
  let total = 0;
  for (const value of sessions.values()) total += value.blocks;
  while (sessions.size > 1 && (sessions.size > MAX_SESSIONS || total > MAX_BLOCKS)) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    total -= sessions.get(oldest)?.blocks ?? 0;
    sessions.delete(oldest);
  }
  return entry;
}

/**
 * True when every block still has the id and revision it had in `prev`, and every
 * digest block the same role, text length and digest. Then `prev.digests` is the answer.
 * False also when unsure; `build` decides whether the digests can be computed at all.
 */
function unchanged(prev: Entry, blocks: readonly Block[], revisions: Record<string, number>): boolean {
  if (prev.allIds.length !== blocks.length) return false;
  let k = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const id = block.id;
    const rev: number | undefined = typeof id === "string" ? revisions[id] : undefined;
    if (rev === undefined || prev.allIds[i] !== id || prev.allRevisions[i] !== rev) return false;
    if (!isDigestBlock(block)) continue;
    const projected = projectedDigest(block);
    // Same rule as transcriptDigests: a shrunk block without a digest cannot be compared.
    if (block.remoteContent && !projected) return false;
    if (
      k >= prev.ids.length ||
      prev.ids[k] !== id ||
      prev.revisions[k] !== rev ||
      prev.roles[k] !== block.role ||
      prev.lengths[k] !== (block.text?.length ?? 0) ||
      (projected !== undefined && prev.digests[k] !== projected)
    )
      return false;
    k++;
  }
  return k === prev.ids.length;
}

/**
 * The digest columns of `blocks`, reusing the previous digest of every block whose
 * desktop revision, role and text length are unchanged. `undefined` when the revisions
 * cannot vouch for the blocks (missing or duplicate ids, a shrunk block without a digest).
 */
function build(
  prev: Entry | undefined,
  blocks: readonly Block[],
  revisions: Record<string, number>,
): Columns | undefined {
  const columns: Columns = {
    allIds: [],
    allRevisions: [],
    ids: [],
    revisions: [],
    roles: [],
    lengths: [],
    digests: [],
  };
  const seen = new Set<string>();
  let byId: Map<string, number> | undefined;
  for (const block of blocks) {
    const id = block.id;
    if (typeof id !== "string" || !id) return undefined;
    const rev: number | undefined = revisions[id];
    if (rev === undefined) return undefined;
    // Revisions are keyed by id, so a duplicate id (in any block) leaves them ambiguous.
    if (seen.has(id)) return undefined;
    seen.add(id);
    columns.allIds.push(id);
    columns.allRevisions.push(rev);
    if (!isDigestBlock(block)) continue;
    if (block.remoteContent && !projectedDigest(block)) return undefined;
    const role = block.role;
    const textLength = block.text?.length ?? 0;
    const projected = projectedDigest(block);
    let digest: string;
    if (projected) {
      digest = projected;
    } else {
      const k = columns.ids.length;
      let j = -1;
      if (prev) {
        if (prev.ids[k] === id) j = k;
        else {
          byId ??= new Map(prev.ids.map((value, index) => [value, index]));
          j = byId.get(id) ?? -1;
        }
      }
      const hit =
        prev !== undefined &&
        j >= 0 &&
        prev.revisions[j] === rev &&
        prev.roles[j] === role &&
        prev.lengths[j] === textLength;
      digest = hit ? prev.digests[j] : blockDigest(block);
    }
    columns.ids.push(id);
    columns.revisions.push(rev);
    columns.roles.push(role);
    columns.lengths.push(textLength);
    columns.digests.push(digest);
  }
  return columns;
}

/**
 * `transcriptDigests(blocks)`, reusing the digest of every block whose desktop revision
 * and role and text length are unchanged since the last call for this session. An
 * unchanged transcript returns the same array as the previous call.
 */
export function desktopDigests(
  owner: object,
  sessionId: string,
  blocks: readonly Block[],
  revisions?: Record<string, number>,
): string[] | undefined {
  if (!revisions || blocks.length > MAX_SESSION_BLOCKS) return transcriptDigests(blocks);
  const prev = owners.get(owner)?.get(sessionId);
  const equal = !!prev && unchanged(prev, blocks, revisions);
  let columns: Columns | undefined;
  if (!equal) {
    columns = build(prev, blocks, revisions);
    if (!columns) return transcriptDigests(blocks);
  }
  const digests = columns ? columns.digests : prev!.digests;
  const chains = columns ? buildChains(digests, prev?.digests, prev?.chains) : prev!.chains;
  if (columns && !chained.has(digests)) {
    rememberChains(digests, chains);
    chained.add(digests);
  }
  const entry = entryFor(owner, sessionId, blocks.length);
  if (columns) {
    Object.assign(entry, columns);
    entry.agreed = undefined;
  }
  entry.chains = chains;
  entry.lastSnapshot = blocks;
  entry.lastEqual = equal;
  return digests;
}

/**
 * True only when `desktopDigests` has just run on this snapshot's blocks and found them
 * unchanged from the previous call, the host transcript at `current.revision` is the one
 * recorded by `recordAgreed`, and the host holds the same number of blocks.
 */
export function sameByRevisions(
  owner: object,
  sessionId: string,
  current: { revision: number; session: { blocks: readonly Block[] } },
  snapshot: Snapshot,
): boolean {
  const entry = owners.get(owner)?.get(sessionId);
  const blocks = snapshot.session.blocks;
  if (
    !entry ||
    entry.lastSnapshot !== blocks ||
    !entry.lastEqual ||
    entry.agreed?.hostRevision !== current.revision
  )
    return false;
  return current.session.blocks.length === blocks.length;
}

/**
 * Records that the host transcript at `hostRevision` equals `snapshot`'s blocks. Only
 * when `desktopDigests` has just run on this snapshot; otherwise it forgets the agreement.
 */
export function recordAgreed(
  owner: object,
  sessionId: string,
  hostRevision: number,
  snapshot: Snapshot,
): void {
  const blocks = snapshot.session.blocks;
  const entry = owners.get(owner)?.get(sessionId);
  if (!entry) return;
  if (entry.lastSnapshot !== blocks) {
    entry.agreed = undefined;
    return;
  }
  entry.agreed = { hostRevision };
}

/** `transcriptDigests(blocks)` for the host's transcript, computed once per blocks array. */
export function heldDigests(blocks: readonly Block[]): string[] | undefined {
  if (held.has(blocks)) return held.get(blocks);
  const digests = transcriptDigests(blocks);
  if (digests) rememberHeld(blocks, digests);
  return digests;
}

/** Seeds `heldDigests` for `blocks`, e.g. with the digests of the transcript just saved. */
export function rememberHeld(blocks: readonly Block[], digests: string[]): void {
  held.set(blocks, digests);
  if (chained.has(digests)) return;
  rememberChains(digests, buildChains(digests));
  chained.add(digests);
}

/** Drops everything remembered about a session. */
export function forgetDesktopDigests(owner: object, sessionId: string): void {
  owners.get(owner)?.delete(sessionId);
}
