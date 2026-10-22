import type { HostSession } from "../src/features/connections/model/protocol";
import type { BlockChanges } from "../src/features/sessions/model/blockChanges";
import { changedBlocks } from "../src/features/sessions/model/blockChanges";
import { streamingTextUpdate } from "../src/features/sessions/model/stableBlocks";

// Copy a small shard per changed block, rather than a whole transcript-sized
// record. The proxy preserves Record/JSON/spread semantics for existing readers.
const SHARDS = 128;
type RevisionIndex = { shards: ReadonlyArray<Record<string, number>>; keys?: string[] };
const indexes = new WeakMap<Record<string, number>, RevisionIndex>();
const shardFor = (id: string) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash & (SHARDS - 1);
};

function indexOf(record: Record<string, number>): RevisionIndex {
  let index = indexes.get(record);
  if (index) return index;
  const shards = Array.from(
    { length: SHARDS },
    () => Object.create(null) as Record<string, number>,
  );
  for (const [id, revision] of Object.entries(record)) shards[shardFor(id)][id] = revision;
  index = { shards };
  indexes.set(record, index);
  return index;
}

function revisionRecord(index: RevisionIndex): Record<string, number> {
  const record = new Proxy(Object.create(null) as Record<string, number>, {
    get: (_target, key) => (typeof key === "string" ? index.shards[shardFor(key)][key] : undefined),
    has: (_target, key) =>
      typeof key === "string" && Object.hasOwn(index.shards[shardFor(key)], key),
    ownKeys: () => (index.keys ??= index.shards.flatMap((shard) => Object.keys(shard))),
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key !== "string" || !Object.hasOwn(index.shards[shardFor(key)], key))
        return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: false,
        value: index.shards[shardFor(key)][key],
      };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  indexes.set(record, index);
  return record;
}

function patchRevisions(previous: Record<string, number>, changes: BlockChanges, revision: number) {
  if (!changes.size) return previous;
  const source = indexOf(previous);
  const shards = source.shards.slice();
  const copied = new Set<number>();
  for (const [id, block] of changes) {
    const position = shardFor(id);
    if (!copied.has(position)) {
      shards[position] = Object.assign(
        Object.create(null) as Record<string, number>,
        shards[position],
      );
      copied.add(position);
    }
    if (block === null) delete shards[position][id];
    else shards[position][id] = revision;
  }
  return revisionRecord({ shards });
}

/** Unknown/imported arrays retain the structural fallback; owned deltas are sparse. */
export function blockRevisions(
  previous: HostSession | undefined,
  next: HostSession,
  changes?: BlockChanges,
): Record<string, number> {
  if (previous?.blockRevisions) {
    if (previous.session.blocks === next.session.blocks) return previous.blockRevisions;
    const known = changes ?? changedBlocks(previous.session.blocks, next.session.blocks);
    if (known) return patchRevisions(previous.blockRevisions, known, next.revision);
    const updatedIndex = streamingTextUpdate(previous.session.blocks, next.session.blocks);
    if (updatedIndex !== undefined) {
      const block = next.session.blocks[updatedIndex];
      const old = previous.session.blocks[updatedIndex];
      if (block.id === old.id) {
        return block.text === old.text
          ? previous.blockRevisions
          : patchRevisions(previous.blockRevisions, new Map([[block.id, block]]), next.revision);
      }
    }
  }
  const before = new Map(previous?.session.blocks.map((block) => [block.id, block]));
  const revisions = Object.create(null) as Record<string, number>;
  for (const block of next.session.blocks) {
    const old = before.get(block.id);
    const stamp = previous?.blockRevisions?.[block.id];
    revisions[block.id] =
      old && stamp !== undefined && (old === block || JSON.stringify(old) === JSON.stringify(block))
        ? stamp
        : next.revision;
  }
  return revisions;
}
