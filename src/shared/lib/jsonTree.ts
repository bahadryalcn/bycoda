/** Largest JSON text the tree views parse; bigger text stays in its raw, highlighted view. */
export const MAX_JSON_TREE_CHARS = 2_000_000;

export type JsonTreeParse = { ok: true; data: object } | { ok: false };

const FAILED: JsonTreeParse = { ok: false };
const cache = new Map<string, JsonTreeParse>();
const CACHE_LIMIT = 24;
// Parsed results are kept only for small texts: a streamed reply re-renders its settled fences many times.
const CACHE_TEXT_LIMIT = 200_000;

/**
 * Parses a complete JSON object or array for a tree view. Scalars, invalid text and oversized text are
 * `{ ok: false }` so the caller keeps showing the raw block. Settled texts are parsed once.
 */
export function parseJsonTree(text: string): JsonTreeParse {
  const cached = cache.get(text);
  if (cached) return cached;
  const trimmed = text.trim();
  let result = FAILED;
  if (trimmed.length <= MAX_JSON_TREE_CHARS && (trimmed[0] === "{" || trimmed[0] === "[")) {
    try {
      const data: unknown = JSON.parse(trimmed);
      if (data && typeof data === "object") result = { ok: true, data };
    } catch {
      // Not JSON (yet): the raw view is the answer.
    }
  }
  if (text.length <= CACHE_TEXT_LIMIT) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(text, result);
  }
  return result;
}

const NODE_LIMIT = 400;

function countNodes(value: unknown, budget: { left: number }): void {
  budget.left -= 1;
  if (budget.left <= 0 || !value || typeof value !== "object") return;
  for (const child of Object.values(value)) {
    countNodes(child, budget);
    if (budget.left <= 0) return;
  }
}

/**
 * How many levels of a tree start open. Small documents open fully to three levels, medium ones to two,
 * and large ones show only the root's children so the first view stays a table of contents.
 */
export function jsonOpenDepth(data: unknown): number {
  const budget = { left: NODE_LIMIT };
  countNodes(data, budget);
  const nodes = NODE_LIMIT - Math.max(budget.left, 0);
  if (budget.left > 0 && nodes <= 40) return 3;
  if (budget.left > 0 && nodes <= 150) return 2;
  return 1;
}
