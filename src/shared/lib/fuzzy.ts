/** Sequential fuzzy match — all query characters in order, with bonuses
 *  for consecutive runs, path separators, and camelCase boundaries. */

export type FuzzyHit = {
  score: number;
  positions: number[];
};

/** A query split and lowercased once, for hot loops matching many texts. */
export type PreparedFuzzyQuery = { tokens: string[] };

export function prepareFuzzyQuery(query: string): PreparedFuzzyQuery {
  return {
    tokens: query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toLowerCase()),
  };
}

export function fuzzyMatch(query: string | PreparedFuzzyQuery, text: string): FuzzyHit | null {
  const tokens = typeof query === "string" ? prepareFuzzyQuery(query).tokens : query.tokens;
  if (tokens.length === 0) return { score: 0, positions: [] };
  if (tokens.length === 1) return matchToken(tokens[0], text);

  const positions: number[] = [];
  let score = 0;
  for (const token of tokens) {
    const hit = matchToken(token, text);
    if (!hit) return null;
    score += hit.score;
    for (const index of hit.positions) positions.push(index);
  }
  positions.sort((a, b) => a - b);
  return { score, positions };
}

/** `needle` must already be lowercased. */
function matchToken(needle: string, text: string): FuzzyHit | null {
  if (!needle) return { score: 0, positions: [] };

  const hay = text.toLowerCase();
  // Lowercasing can expand a character (İ becomes i + combining dot). Keep
  // matching the folded text, but return offsets into the original UTF-16 text.
  const originalIndices = hay.length === text.length ? null : lowercaseIndices(text);
  const positions: number[] = [];
  let score = 0;
  let consecutive = 0;
  let qi = 0;

  for (let i = 0; i < hay.length && qi < needle.length; i++) {
    if (hay[i] !== needle[qi]) {
      consecutive = 0;
      continue;
    }
    const originalIndex = originalIndices?.[i] ?? i;
    if (positions[positions.length - 1] !== originalIndex) positions.push(originalIndex);
    consecutive += 1;
    score += 1 + consecutive * 4;
    if (originalIndex === 0 || isBreak(text[originalIndex - 1])) score += 14;
    else if (isUpper(text[originalIndex]) && !isUpper(text[originalIndex - 1])) score += 10;
    qi += 1;
  }

  if (qi !== needle.length) return null;
  score -= hay.length - needle.length;
  return { score, positions };
}

function lowercaseIndices(text: string): number[] {
  const indices: number[] = [];
  let originalIndex = 0;
  for (const character of text) {
    const lowered = character.toLowerCase();
    for (let index = 0; index < lowered.length; index++) {
      indices.push(originalIndex + Math.min(index, character.length - 1));
    }
    originalIndex += character.length;
  }
  return indices;
}

function isBreak(ch: string): boolean {
  return ch === "/" || ch === "\\" || ch === "-" || ch === "_" || ch === "." || ch === " ";
}

function isUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

/** Prefer filename hits over directory-only hits. Positions index `relative`. */
export function scorePath(
  query: string | PreparedFuzzyQuery,
  relative: string,
  name: string,
): FuzzyHit | null {
  const needle = typeof query === "string" ? prepareFuzzyQuery(query) : query;
  if (needle.tokens.length === 0) return { score: 0, positions: [] };

  const offset = Math.max(0, relative.length - name.length);
  const nameHit = fuzzyMatch(needle, name);
  if (nameHit) {
    return {
      score: nameHit.score + 400,
      positions: nameHit.positions.map((index) => index + offset),
    };
  }

  return fuzzyMatch(needle, relative);
}
