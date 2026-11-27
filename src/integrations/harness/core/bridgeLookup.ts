/** A Host bridge lookup is optional context for a turn, so it must never hold a send. */
export const BRIDGE_LOOKUP_TIMEOUT_MS = 2_000;
/** How long a definite empty or failed answer is reused. Short on purpose: a Host that was
 * still starting must be asked again by the next send, not skipped for a long pause. */
export const BRIDGE_NEGATIVE_TTL_MS = 2_000;
/** How long a usable answer is reused, counted from when its question was sent. It covers the
 * second lookup inside one send and rapid sends; it is far shorter than a Host restart, so an
 * answer from before a restart is never served after it (the executable and hub metadata
 * belong to one Host process). */
export const BRIDGE_FOUND_TTL_MS = 5_000;
const MAX_NEGATIVE = 256;
/** Usable answers are re-fetched after expiry; the cap bounds the process lifetime. */
const MAX_FOUND = 256;

/**
 * Caches a bridge answer per session key. A usable answer is reused for BRIDGE_FOUND_TTL_MS
 * after its question was sent; a definite empty or failed answer for BRIDGE_NEGATIVE_TTL_MS.
 * Neither survives its TTL, and a failed refresh never revives an older answer, so the bridge
 * of a Host that has since restarted is not reused. A lookup that outlives the cap keeps
 * running and still fills the cache when it finishes, so the following turn gets the bridge
 * of a Host that was slow to answer. Answers are never shared between keys.
 */
export function createBridgeLookup<T>(
  fetch: (sessionId: string) => Promise<T | null>,
  timeoutMs = BRIDGE_LOOKUP_TIMEOUT_MS,
  negativeTtlMs = BRIDGE_NEGATIVE_TTL_MS,
  /** A usable answer that is not final (e.g. the Host had not published its MCP hub yet)
   * is reused only for the negative TTL, so a later launch asks the Host again. */
  isFinal: (value: T) => boolean = () => true,
  foundTtlMs = BRIDGE_FOUND_TTL_MS,
) {
  const found = new Map<string, { value: T; expires: number }>();
  const provisional = new Map<string, { value: T; expires: number }>();
  const missing = new Map<string, number>();
  const inflight = new Map<string, Promise<T | null>>();

  const remember = (key: string, value: T | null, askedAt: number) => {
    // Any newer answer replaces what this key held; a failure leaves nothing to fall back on.
    found.delete(key);
    provisional.delete(key);
    const now = Date.now();
    if (value && !isFinal(value)) {
      for (const [id, entry] of provisional) if (entry.expires <= now) provisional.delete(id);
      if (provisional.size >= MAX_NEGATIVE) provisional.delete(provisional.keys().next().value!);
      provisional.set(key, { value, expires: now + negativeTtlMs });
      missing.delete(key);
      return;
    }
    if (value) {
      missing.delete(key);
      const expires = askedAt + foundTtlMs;
      // An answer that outlived its own TTL while the Host was slow is not reused.
      if (expires <= now) return;
      for (const [id, entry] of found) if (entry.expires <= now) found.delete(id);
      if (found.size >= MAX_FOUND) found.delete(found.keys().next().value!);
      found.set(key, { value, expires });
      return;
    }
    for (const [id, expires] of missing) if (expires <= now) missing.delete(id);
    if (missing.size >= MAX_NEGATIVE) missing.delete(missing.keys().next().value!);
    missing.set(key, now + negativeTtlMs);
  };

  return async function lookup(key: string): Promise<T | null> {
    const now = Date.now();
    const cached = found.get(key);
    if (cached && cached.expires > now) return cached.value;
    if (cached) found.delete(key);
    const soft = provisional.get(key);
    if (soft && soft.expires > now) return soft.value;
    if ((missing.get(key) ?? 0) > now) return null;
    missing.delete(key);
    let pending = inflight.get(key);
    if (!pending) {
      const askedAt = now;
      pending = Promise.resolve()
        .then(() => fetch(key))
        .catch(() => null)
        .then((value) => {
          remember(key, value, askedAt);
          return value;
        })
        .finally(() => {
          if (inflight.get(key) === pending) inflight.delete(key);
        });
      inflight.set(key, pending);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        // A slow answer is not a definite "no bridge": do not cache it. The shared
        // in-flight lookup still fills the cache when the Host finally answers.
        resolve(null);
      }, timeoutMs);
    });
    try {
      return await Promise.race([pending, capped]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
