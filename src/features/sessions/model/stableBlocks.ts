import type { Attachment, Block, Session } from "./session";
import type { LastTurnRecall } from "./editLastTurn";
import { registerBlockChanges } from "./blockChanges";
import { delegationToolKind } from "./bycodaToolCall";
export type StreamingBlockUpdate = { index: number; kind: "text" | "tool-output" };
const directUpdates = new WeakMap<Block[], WeakMap<Block[], StreamingBlockUpdate>>();
// Identical lineage objects prove only one field on the same block changed across
// skipped frames. Neither the lineage nor the weak keys retain previous transcripts.
const lineages = new WeakMap<Block[], StreamingBlockUpdate>();
export function registerStreamingBlockUpdate(
  previous: Block[],
  next: Block[],
  index: number,
  kind: StreamingBlockUpdate["kind"],
): void {
  const before = lineages.get(previous);
  const lineage = before?.index === index && before.kind === kind ? before : { index, kind };
  let updates = directUpdates.get(previous);
  if (!updates) {
    updates = new WeakMap();
    directUpdates.set(previous, updates);
  }
  updates.set(next, lineage);
  registerBlockChanges(previous, next, [next[index]]);
  if (!before) lineages.set(previous, lineage);
  lineages.set(next, lineage);
}

export function registerStreamingTextUpdate(previous: Block[], next: Block[], index: number): void {
  registerStreamingBlockUpdate(previous, next, index, "text");
}
export function streamingBlockUpdate(
  previous: Block[],
  next: Block[],
): StreamingBlockUpdate | undefined {
  const direct = directUpdates.get(previous)?.get(next);
  if (direct) return direct;
  const before = lineages.get(previous);
  return before === lineages.get(next) ? before : undefined;
}
export function streamingTextUpdate(previous: Block[], next: Block[]): number | undefined {
  const update = streamingBlockUpdate(previous, next);
  return update?.kind === "text" ? update.index : undefined;
}

/**
 * True when `next` differs from `previous` only by the text of the block being
 * streamed: every other block is the same object, and the changed one keeps its
 * id, role and every field but `text`. Consumers that never read an assistant's
 * words (the activity dock, side questions, the subagent sheet) can keep
 * their previous input across such a frame.
 */
export function sameBlocksIgnoringStreamingText(previous: Block[], next: Block[]): boolean {
  if (previous === next) return true;
  const update = streamingTextUpdate(previous, next);
  if (update !== undefined) {
    const role = next[update].role;
    return role === "assistant" || role === "reasoning";
  }
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

export function onlyRunningToolOutputChanged(a: Block, b: Block): boolean {
  if (a.role !== "tool" || b.role !== "tool" || !a.tool || !b.tool) return false;
  if (a.id !== b.id || !a.streaming || !b.streaming || delegationToolKind(a)) return false;
  return (
    sameFieldsExcept(a, b, "tool") && sameFieldsExcept(a.tool, b.tool, "detail", "outputTruncated")
  );
}

function sameFieldsExcept<T extends object>(a: T, b: T, ...ignored: string[]): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of ignored) keys.delete(key);
  for (const key of keys) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
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

/** Keep all session metadata; each consumer specifies the block updates it reads separately. */
export function sameSessionIgnoringStreamingText(
  a: Session,
  b: Session,
  sameBlocks = sameBlocksIgnoringStreamingText,
): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key !== "blocks" && !Object.is(a[key as keyof Session], b[key as keyof Session]))
      return false;
  }
  return a.blocks === b.blocks || (!!a.busy && !!b.busy && sameBlocks(a.blocks, b.blocks));
}
