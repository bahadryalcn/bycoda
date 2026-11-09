import { discardNativeOutputItems, type NativeOutputItem } from "./nativeOutputDelivery";

export type Buffered = {
  items: string[];
  bytes: number;
  nativeItems?: (NativeOutputItem | null)[];
};

export const MAX_BUFFERED = 1000;
// UTF-16 code units, which is close enough to bytes for a memory bound.
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** Drops the oldest items past either bound; the newest item always stays,
 * even when it alone exceeds the byte bound. */
export function pushBounded<Key>(
  map: Map<Key, Buffered>,
  sessionId: Key,
  items: readonly string[],
  maxBytes = MAX_BUFFERED_BYTES,
  nativeItems?: readonly NativeOutputItem[],
) {
  const queued = map.get(sessionId) ?? { items: [], bytes: 0 };
  if (nativeItems && !queued.nativeItems) queued.nativeItems = queued.items.map(() => null);
  for (const [index, item] of items.entries()) {
    queued.items.push(item);
    queued.nativeItems?.push(nativeItems?.[index] ?? null);
    queued.bytes += item.length;
  }
  let drop = Math.max(0, queued.items.length - MAX_BUFFERED);
  let kept = queued.bytes;
  for (let i = 0; i < drop; i += 1) kept -= queued.items[i].length;
  while (kept > maxBytes && drop < queued.items.length - 1) {
    kept -= queued.items[drop].length;
    drop += 1;
  }
  if (drop > 0) {
    if (queued.nativeItems)
      discardNativeOutputItems(queued.nativeItems.splice(0, drop), "buffer-dropped");
    queued.items.splice(0, drop);
    queued.bytes = kept;
  }
  map.set(sessionId, queued);
}
