/**
 * Compact wire form of a streamed session delta (hosts advertising
 * `transport.ws.sessions.tail.v1`, opened with `target.tail`). A delta may omit
 * `blockIds` when the list did not change since the previous event of the same
 * stream, and may carry a streaming block's text as an appended suffix. The
 * receiver rebuilds the ordinary full delta from what it already holds, or
 * throws, which makes the subscription ask for a fresh snapshot.
 */
export const STREAM_TAIL_CAPABILITY = "transport.ws.sessions.tail.v1";
/** Shorter texts are cheaper to resend than to patch. */
export const STREAM_APPEND_MIN_CHARS = 1024;

export type TextAppend = { id: string; baseLength: number; text: string };

/** What a stream receiver knows from its previous events. */
export type StreamDeltaState = { ids?: string[]; texts: Map<string, string> };

export function createStreamDeltaState(): StreamDeltaState {
  return { texts: new Map() };
}

type BlockLike = { id: string; text: string };

/** Replace the remembered state with a full snapshot's blocks. */
export function rememberStreamSnapshot(state: StreamDeltaState, blocks: readonly BlockLike[]) {
  state.ids = blocks.map((block) => block.id);
  state.texts = new Map(blocks.map((block) => [block.id, block.text]));
}

/** Fold an expanded delta into the remembered state. */
export function rememberStreamDelta(
  state: StreamDeltaState,
  blockIds: readonly string[],
  blocks: readonly BlockLike[],
) {
  const previous = state.ids;
  state.ids = [...blockIds];
  if (
    !previous ||
    previous.length !== blockIds.length ||
    previous.some((id, i) => id !== blockIds[i])
  ) {
    const kept = new Set(blockIds);
    for (const id of state.texts.keys()) if (!kept.has(id)) state.texts.delete(id);
  }
  for (const block of blocks) state.texts.set(block.id, block.text);
}

/** Rebuild the full delta from its compact form. Throws when the state cannot support it. */
export function expandStreamDelta(raw: unknown, state: StreamDeltaState): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("Invalid full transcript delta");
  const { textAppends, ...delta } = raw as Record<string, unknown>;
  if (delta.blockIds === undefined) {
    if (!state.ids) throw new Error("Host stream delta has no block list to reuse");
    delta.blockIds = state.ids;
  }
  if (textAppends === undefined) return delta;
  if (!Array.isArray(textAppends) || !Array.isArray(delta.blocks))
    throw new Error("Invalid streamed text append");
  const appends = new Map<string, TextAppend>();
  for (const append of textAppends as TextAppend[]) {
    if (
      typeof append?.id !== "string" ||
      typeof append.text !== "string" ||
      !Number.isSafeInteger(append.baseLength)
    )
      throw new Error("Invalid streamed text append");
    appends.set(append.id, append);
  }
  const blocks = (delta.blocks as BlockLike[]).map((block) => {
    const append = appends.get(block.id);
    if (!append) return block;
    const previous = state.texts.get(block.id);
    if (previous === undefined || previous.length !== append.baseLength)
      throw new Error("Streamed text append does not follow the previous text");
    appends.delete(block.id);
    return { ...block, text: previous + append.text };
  });
  if (appends.size) throw new Error("Streamed text append names a block outside the delta");
  delta.blocks = blocks;
  return delta;
}
