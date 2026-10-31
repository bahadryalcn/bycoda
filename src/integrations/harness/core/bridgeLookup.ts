/** A Host bridge lookup is optional context for a turn, so it must never hold a send. */
export const BRIDGE_LOOKUP_TIMEOUT_MS = 2_000;
/** How long a definite empty or failed answer is reused before asking the Host again. */
export const BRIDGE_NEGATIVE_TTL_MS = 10_000;
const MAX_NEGATIVE = 256;

/**
 * Caches a bridge answer per session. A usable answer is kept; a definite empty or
 * failed answer is kept for BRIDGE_NEGATIVE_TTL_MS so the next send (and the
 * second lookup inside one send) reuses it instead of asking the Host again. A
 * lookup that outlives the cap keeps running and still fills the cache when it
 * finishes, so the following turn gets the bridge.
 */
export function createBridgeLookup<T>(
  fetch: (sessionId: string) => Promise<T | null>,
  timeoutMs = BRIDGE_LOOKUP_TIMEOUT_MS,
  negativeTtlMs = BRIDGE_NEGATIVE_TTL_MS,
) {
  const found = new Map<string, T>();
  const missing = new Map<string, number>();
  const inflight = new Map<string, Promise<T | null>>();

  const remember = (key: string, value: T | null) => {
    if (value) {
      found.set(key, value);
      missing.delete(key);
      return;
    }
    rememberMissing(key);
  };
  const rememberMissing = (key: string) => {
    if (found.has(key)) return;
    const now = Date.now();
    for (const [id, expires] of missing) if (expires <= now) missing.delete(id);
    if (missing.size >= MAX_NEGATIVE)
      missing.delete(missing.keys().next().value!);
    missing.set(key, now + negativeTtlMs);
  };

  return async function lookup(key: string): Promise<T | null> {
    const cached = found.get(key);
    if (cached) return cached;
    if ((missing.get(key) ?? 0) > Date.now()) return null;
    missing.delete(key);
    let pending = inflight.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => fetch(key))
        .catch(() => null)
        .then((value) => {
          remember(key, value);
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
