import type { Block } from "./session";

/** Follow explicit continuation ownership; an untimed imported user is a boundary. */
export function executionUserIndex(blocks: readonly Block[]): number {
  let index = blocks.length - 1;
  while (index >= 0 && blocks[index].role !== "user") index--;
  while (index >= 0) {
    const owner = blocks[index].continuationOf;
    if (!owner) return index;
    let candidate = index - 1;
    while (candidate >= 0 && (blocks[candidate].role !== "user" || blocks[candidate].id !== owner))
      candidate--;
    index = candidate;
  }
  return -1;
}
