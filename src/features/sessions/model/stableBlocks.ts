import type { Attachment, Block } from "./session";
import type { LastTurnRecall } from "./editLastTurn";
import { registerBlockChanges } from "./blockChanges";
const textUpdates = new WeakMap<Block[], WeakMap<Block[], number>>();
// The shell can retain an older array across many text frames. A lineage holds
// no arrays, so cumulative comparisons stay constant-time without retaining
// previous transcripts or traversing a chain of token updates.
const textLineages = new WeakMap<Block[], { token: object; index: number }>();
/** Only call at a producer that copied the array and changed just this text. */
export function registerStreamingTextUpdate(previous: Block[], next: Block[], index: number): void {
  let updates = textUpdates.get(previous);
  if (!updates) {
    updates = new WeakMap();
    textUpdates.set(previous, updates);
  }
  updates.set(next, index);
  registerBlockChanges(previous, next, [next[index]]);
  const previousLineage = textLineages.get(previous);
  const lineage = previousLineage?.index === index ? previousLineage : { token: {}, index };
  if (!previousLineage) textLineages.set(previous, lineage);
  textLineages.set(next, lineage);
}
export function streamingTextUpdate(previous: Block[], next: Block[]): number | undefined {
  const direct = textUpdates.get(previous)?.get(next);
  if (direct !== undefined) return direct;
  const before = textLineages.get(previous);
  const after = textLineages.get(next);
  return before && after && before.token === after.token && before.index === after.index
    ? before.index
    : undefined;
}

/**
 * True when `next` differs from `previous` only by the text of the block being
 * streamed: every other block is the same object, and the last one keeps its
 * id, role and every field but `text`. Consumers that never read an assistant's
 * words (the activity dock, side questions, the subagent sheet) can keep
 * their previous input across such a frame.
 */
export function sameBlocksIgnoringStreamingText(previous: Block[], next: Block[]): boolean {
  if (previous === next) return true;
  if (streamingTextUpdate(previous, next) === next.length - 1) return true;
  if (previous.length !== next.length || next.length === 0) return false;
  const last = next.length - 1;
  for (let index = 0; index < last; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  const a = previous[last];
  const b = next[last];
  if (a === b) return true;
  if (a.id !== b.id || a.role !== b.role) return false;
  if (a.role !== "assistant" && a.role !== "reasoning") return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("text");
  for (const key of keys) {
    if (!Object.is(a[key as keyof Block], b[key as keyof Block])) return false;
  }
  return true;
}

function sameAttachments(a: readonly Attachment[], b: readonly Attachment[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

/** `lastTurnRecall` builds a new object per call; this compares what it holds. */
export function sameLastTurnRecall(a: LastTurnRecall | null, b: LastTurnRecall | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.text === b.text && sameAttachments(a.attachments, b.attachments);
}

/** Shallow equality for short lists of primitives or stable references. */
export function shallowArrayEqual<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
