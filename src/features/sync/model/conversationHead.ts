/**
 * Heads and reconciliation of conversation transcripts, with no dependencies,
 * so storage and the wire can use them. Block digests are in `conversationDigest.ts`.
 */

/** Sent when a request asks for digests (`digests: true`). */
export const DIGESTS_CAPABILITY = "sessions.digests";

/** Where a transcript stood when both sides last agreed on it: how many
 * blocks, and a hash chain over their digests. */
export type ConversationHead = { count: number; chain: string };

/** 128 bits (cyrb128-style mixing) as 32 hex characters. */
export function hash128(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

/** The chain over the first `count` digests. */
export function chainAt(digests: readonly string[], count = digests.length): string {
  let chain = "";
  for (let i = 0; i < count && i < digests.length; i++) chain = hash128(`${chain}:${digests[i]}`);
  return chain;
}

export function headOfDigests(digests: readonly string[]): ConversationHead {
  return { count: digests.length, chain: chainAt(digests) };
}

export function sameHead(
  a: ConversationHead | undefined,
  b: ConversationHead | undefined,
): boolean {
  return !!a && !!b && a.count === b.count && a.chain === b.chain;
}

/** A head read from storage or the wire: bounded and well-formed, or nothing. */
export function parseHead(value: unknown): ConversationHead | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { count, chain } = value as { count?: unknown; chain?: unknown };
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return undefined;
  if (typeof chain !== "string" || chain.length > 64) return undefined;
  if (count > 0 && !/^[0-9a-f]{32}$/.test(chain)) return undefined;
  if (count === 0 && chain !== "") return undefined;
  return { count, chain };
}

/** Whether a transcript is exactly the one `base` names. */
export function atHead(digests: readonly string[], head: ConversationHead): boolean {
  return digests.length === head.count && chainAt(digests, head.count) === head.chain;
}

/** The first of `candidates` that names `digests` exactly, else the first usable one. */
export function chooseBase(
  digests: readonly string[],
  ...candidates: Array<ConversationHead | undefined>
): ConversationHead | undefined {
  const usable = candidates.filter((head): head is ConversationHead => !!head);
  return usable.find((head) => atHead(digests, head)) ?? usable[0];
}

export type Reconciled = "equal" | "localAhead" | "hostAhead" | "conflict";

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

/**
 * Which side holds more of one conversation, given the digests of each and
 * the head both last agreed on. No I/O.
 *
 * - `equal`: the same blocks.
 * - A side still at `base` has not changed since the agreement, so the other
 *   side is simply ahead, including a rewind or reset.
 * - Without that, one side extending the other is ahead.
 * - `conflict`: both sides changed after the agreement and neither contains
 *   the other, so each holds blocks the other lacks.
 */
export function reconcile(
  local: readonly string[],
  host: readonly string[],
  base?: ConversationHead,
): Reconciled {
  const shared = commonPrefix(local, host);
  if (shared === local.length && shared === host.length) return "equal";
  if (base) {
    const localUnchanged = atHead(local, base);
    const hostUnchanged = atHead(host, base);
    if (localUnchanged !== hostUnchanged) return localUnchanged ? "hostAhead" : "localAhead";
  }
  if (shared === local.length) return "hostAhead";
  if (shared === host.length) return "localAhead";
  return "conflict";
}
