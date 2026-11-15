import type { SessionSync } from "../../src/features/connections/model/protocol";
import {
  STREAM_APPEND_MIN_CHARS,
  type TextAppend,
} from "../../src/features/connections/model/sessionStreamDelta";

type State = {
  /** The revision the receiver holds; a delta is only compacted against it. */
  revision: number;
  ids: string[];
  /** Texts the receiver is known to hold. */
  texts: Map<string, string>;
  /** First block of a windowed stream; absent for a full-transcript stream. */
  firstId?: string;
};

/**
 * Per-stream sender state for the compact delta form of `sessionStreamDelta.ts`.
 * A delta is compacted only when the stream's committed revision equals the
 * state's revision, so an event the hub dropped can never leave the receiver
 * with a list or a text prefix the sender assumed.
 */
export class StreamDeltaEncoder {
  private readonly states = new Map<string, State>();

  /** First block id an incremental read must keep when the stream at `revision` is windowed. */
  windowStart(key: string, revision: number | undefined): string | undefined {
    const state = this.states.get(key);
    return state && revision !== undefined && state.revision === revision
      ? state.firstId
      : undefined;
  }

  encode(key: string, sync: SessionSync): SessionSync {
    if (sync.kind === "unchanged") return sync;
    if (sync.kind === "snapshot") {
      const blocks = sync.value.session.blocks;
      this.states.set(key, {
        revision: sync.value.revision,
        ids: blocks.map((block) => block.id),
        texts: new Map(blocks.map((block) => [block.id, block.text])),
        firstId: sync.value.history ? blocks[0]?.id : undefined,
      });
      return sync;
    }
    const state = this.states.get(key);
    const trusted = state !== undefined && state.revision === sync.base;
    const previous = trusted ? state : undefined;
    const sameIds =
      !!previous &&
      previous.ids.length === sync.blockIds.length &&
      previous.ids.every((id, index) => id === sync.blockIds[index]);
    const appends: TextAppend[] = [];
    const blocks = sync.blocks.map((block) => {
      const known = previous?.texts.get(block.id);
      if (
        known === undefined ||
        known.length < STREAM_APPEND_MIN_CHARS ||
        !block.text.startsWith(known)
      )
        return block;
      appends.push({
        id: block.id,
        baseLength: known.length,
        text: block.text.slice(known.length),
      });
      return { ...block, text: "" };
    });
    const texts = previous?.texts ?? new Map<string, string>();
    if (!sameIds) {
      const kept = new Set(sync.blockIds);
      for (const id of texts.keys()) if (!kept.has(id)) texts.delete(id);
    }
    for (const block of sync.blocks) texts.set(block.id, block.text);
    this.states.set(key, {
      revision: sync.value.revision,
      ids: sync.blockIds,
      texts,
      firstId: previous ? previous.firstId : sync.partial ? sync.blockIds[0] : undefined,
    });
    const { blockIds, ...rest } = sync;
    return {
      ...rest,
      ...(sameIds ? {} : { blockIds }),
      blocks,
      ...(appends.length ? { textAppends: appends } : {}),
    } as unknown as SessionSync;
  }

  /** Forget streams whose key the caller no longer needs. */
  retain(keep: (key: string) => boolean): void {
    for (const key of this.states.keys()) if (!keep(key)) this.states.delete(key);
  }
}
