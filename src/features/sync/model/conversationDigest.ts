import type { Block } from "../../sessions/model/session";
import { isTurnInterruptMessage } from "../../sessions/model/inFlight";
import { canonicalJson } from "./canonicalJson";
import { hash128, headOfDigests, type ConversationHead } from "./conversationHead";

/**
 * Digests of a conversation, shared by the desktop and its host.
 *
 * Two copies of a transcript are compared by what each block says, never by
 * comparing a full block with the lossy projection another computer receives
 * (`host/transcriptPage.ts previewBlock`). The side that holds the full block
 * computes its digest; the projection carries it in `remoteContent.digest`.
 *
 * The hash is for equality between cooperating peers, not for security.
 */

/** Stamped on a user message by whichever side ran the turn, after the other
 * side may have copied it. It never changes what the user wrote. */
const USER_TURN_BOOKKEEPING = [
  "startedAt",
  "durationMs",
  "providerTurnId",
  "turnMetrics",
  "turnModel",
] as const;

/** Attachment fields that identify the content; where a machine stored the
 * file (`path`) and its previews are local to it. */
const ATTACHMENT_IDENTITY = [
  "id",
  "name",
  "mimeType",
  "kind",
  "size",
  "browserAnnotation",
] as const;

/** The block as it is compared: without the projection's marks, preview-only
 * and machine-local fields, and without a finished stream flag. */
function comparableBlock(block: Block): Record<string, unknown> {
  const { remoteContent: _remote, streaming, image, attachments, ...rest } = block;
  const form: Record<string, unknown> = { ...rest };
  if (block.role === "user") for (const key of USER_TURN_BOOKKEEPING) delete form[key];
  // The host keeps a finished block's `streaming: false`; desktop storage drops it.
  if (streaming) form.streaming = true;
  if (image) {
    const { data: _data, loadPreview: _load, ...kept } = image;
    form.image = kept;
  }
  if (attachments?.length)
    form.attachments = attachments.map((file) => {
      const kept: Record<string, unknown> = {};
      for (const key of ATTACHMENT_IDENTITY)
        if ((file as Record<string, unknown>)[key] !== undefined)
          kept[key] = (file as Record<string, unknown>)[key];
      return kept;
    });
  return form;
}

const cache = new WeakMap<Block, string>();

/** The digest the projection stamped on a shrunk block, if any. */
export function projectedDigest(block: Block): string | undefined {
  const digest = block.remoteContent?.digest;
  return typeof digest === "string" && digest ? digest : undefined;
}

/**
 * Stable over the whole block. A shrunk block carries the digest of the full
 * block it was made from; anything else is hashed. Blocks are treated as
 * immutable once built (the projection cache relies on the same).
 */
export function blockDigest(block: Block): string {
  const projected = projectedDigest(block);
  if (projected) return projected;
  let digest = cache.get(block);
  if (digest === undefined) {
    digest = hash128(canonicalJson(comparableBlock(block)));
    cache.set(block, digest);
  }
  return digest;
}

/** Notices written when the app quit mid-turn are not conversation content. */
function isQuitNotice(block: Block): boolean {
  return (
    block.role === "system" && (block.notice === "interrupt" || isTurnInterruptMessage(block.text))
  );
}

/** Blocks that take part in a comparison: not quit notices, and not an
 * approval still waiting for an answer. */
export function isDigestBlock(block: Block): boolean {
  if (isQuitNotice(block)) return false;
  return block.role !== "approval" || !!block.approval?.decided;
}

/**
 * One digest per block that takes part in a comparison, or `undefined` when a
 * shrunk block has no digest: it was projected by a host that did not send
 * them, and its content cannot be compared.
 */
export function transcriptDigests(blocks: readonly Block[]): string[] | undefined {
  const digests: string[] = [];
  for (const block of blocks) {
    if (!isDigestBlock(block)) continue;
    if (block.remoteContent && !projectedDigest(block)) return undefined;
    digests.push(blockDigest(block));
  }
  return digests;
}

/** The head of a transcript, or `undefined` when it cannot be compared. */
export function conversationHead(blocks: readonly Block[]): ConversationHead | undefined {
  const digests = transcriptDigests(blocks);
  return digests && headOfDigests(digests);
}
