import type { Block } from "./session";

export type BlockChanges = ReadonlyMap<string, Block | null>;
const changes = new WeakMap<readonly Block[], WeakMap<readonly Block[], BlockChanges>>();

/** Producer-owned metadata: the new array changed only these block IDs. */
export function registerBlockChanges(
  previous: readonly Block[],
  next: readonly Block[],
  updated: readonly Block[],
  removed: readonly string[] = [],
): void {
  let following = changes.get(previous);
  if (!following) {
    following = new WeakMap();
    changes.set(previous, following);
  }
  const delta = new Map<string, Block | null>();
  for (const id of removed) delta.set(id, null);
  for (const block of updated) delta.set(block.id, block);
  following.set(next, delta);
}

export function changedBlocks(
  previous: readonly Block[],
  next: readonly Block[],
): BlockChanges | undefined {
  return previous === next ? EMPTY : changes.get(previous)?.get(next);
}
const EMPTY: BlockChanges = new Map();
