import type { Block } from "../../src/features/sessions/model/session";
import { transcriptDigests } from "../../src/features/sync/model/conversationDigest";

/**
 * The blocks to digest for `mine`, with each block whose content equals the host block
 * at the same index replaced by that host block. Equal content has an equal digest, so
 * `transcriptDigests` of the result equals `transcriptDigests(mine)`, but only the
 * blocks that differ from the host are hashed. The host's blocks keep their digest
 * cache entries across refreshes; desktop blocks are fresh objects every time.
 */
export function alignForDigest(mine: readonly Block[], held: readonly Block[]): Block[] {
  const stable: Block[] = [];
  for (let index = 0; index < mine.length; index++) {
    const host = held[index];
    const same =
      index < held.length &&
      (mine[index] === host || JSON.stringify(mine[index]) === JSON.stringify(host));
    stable.push(same ? host : mine[index]);
  }
  return stable;
}

/** Digests of both sides of a refresh, as `transcriptDigests` computes them. */
export function refreshDigests(
  mine: readonly Block[],
  held: readonly Block[],
): { mine: string[] | undefined; held: string[] | undefined } {
  return {
    mine: transcriptDigests(alignForDigest(mine, held)),
    held: transcriptDigests(held),
  };
}
