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

/** Boolean filtering uses the same folded subsequences without scoring or collecting offsets. */
export function fuzzyIncludes(query: PreparedFuzzyQuery, text: string): boolean {
  const hay = text.toLowerCase();
  for (const token of query.tokens) {
    let offset = 0;
    for (let i = 0; i < token.length; i++) {
      const at = hay.indexOf(token[i], offset);
      if (at < 0) return false;
      offset = at + 1;
    }
  }
  return true;
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
  // Tokens may highlight the same character; list each position once.
  const unique = positions.filter((index, i) => i === 0 || index !== positions[i - 1]);
  return { score, positions: unique };
}

/** Largest needle × text area (in folded characters) that gets the best-alignment search. */
const MAX_ALIGNMENT_CELLS = 16_384;

// Scratch tables reused across calls (matching is synchronous, never re-entrant).
const bestScore = new Int32Array(MAX_ALIGNMENT_CELLS);
const runLength = new Int32Array(MAX_ALIGNMENT_CELLS);
const previousEnd = new Int32Array(MAX_ALIGNMENT_CELLS);
const charBonuses = new Int32Array(MAX_ALIGNMENT_CELLS);
const UNREACHED = -0x40000000;

/** `needle` must already be lowercased. */
function matchToken(needle: string, text: string): FuzzyHit | null {
  if (!needle) return { score: 0, positions: [] };

  const hay = text.toLowerCase();
  // Lowercasing can expand a character (İ becomes i + combining dot). Keep
  // matching the folded text, but return offsets into the original UTF-16 text.
  const originalIndices = hay.length === text.length ? null : lowercaseIndices(text);

  // The cheap leftmost scan decides whether the text matches at all, and is the
  // result for inputs too large to search for a better alignment.
  const greedy = matchGreedy(needle, hay, text, originalIndices);
  // shortcut: oversized needle × text pairs keep the leftmost alignment, raise the cap if real inputs hit it.
  if (!greedy || needle.length * hay.length > MAX_ALIGNMENT_CELLS) return greedy;
  return matchBest(needle, hay, text, originalIndices) ?? greedy;
}

function matchGreedy(
  needle: string,
  hay: string,
  text: string,
  originalIndices: number[] | null,
): FuzzyHit | null {
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
    score += 1 + consecutive * 4 + charBonus(text, originalIndex);
    qi += 1;
  }

  if (qi !== needle.length) return null;
  score -= hay.length - needle.length;
  return { score, positions };
}

/**
 * Highest-scoring in-order alignment under the same scoring as the leftmost scan.
 * The text is split into runs of adjacent matched characters; `bestScore[(c - 1) * m + e]`
 * is the best score with `c` needle characters matched and the last one at folded index `e`.
 * A run starting at `j` follows the best state that ended at least one character before `j`.
 * Ties keep the earliest candidate so the result is deterministic.
 */
function matchBest(
  needle: string,
  hay: string,
  text: string,
  originalIndices: number[] | null,
): FuzzyHit | null {
  const n = needle.length;
  const m = hay.length;
  bestScore.fill(UNREACHED, 0, n * m);
  for (let i = 0; i < m; i++) charBonuses[i] = charBonus(text, originalIndices?.[i] ?? i);

  for (let matched = 0; matched < n; matched++) {
    let baseScore = matched === 0 ? 0 : UNREACHED;
    let baseEnd = -1;
    for (let start = 0; start < m; start++) {
      if (matched > 0 && start >= 2) {
        const candidate = bestScore[(matched - 1) * m + start - 2];
        if (candidate > baseScore) {
          baseScore = candidate;
          baseEnd = start - 2;
        }
      }
      if (baseScore === UNREACHED) continue;

      let score = baseScore;
      for (
        let length = 1;
        start + length <= m &&
        matched + length <= n &&
        hay[start + length - 1] === needle[matched + length - 1];
        length++
      ) {
        const end = start + length - 1;
        score += 1 + length * 4 + charBonuses[end];
        const cell = (matched + length - 1) * m + end;
        if (score > bestScore[cell]) {
          bestScore[cell] = score;
          runLength[cell] = length;
          previousEnd[cell] = baseEnd;
        }
      }
    }
  }

  let end = -1;
  let score = UNREACHED;
  for (let i = 0; i < m; i++) {
    const candidate = bestScore[(n - 1) * m + i];
    if (candidate > score) {
      score = candidate;
      end = i;
    }
  }
  if (end < 0) return null;

  const folded: number[] = [];
  for (let matched = n; matched > 0;) {
    const cell = (matched - 1) * m + end;
    const length = runLength[cell];
    for (let i = end; i > end - length; i--) folded.push(i);
    matched -= length;
    end = previousEnd[cell];
  }

  const positions: number[] = [];
  for (let i = folded.length - 1; i >= 0; i--) {
    const originalIndex = originalIndices?.[folded[i]] ?? folded[i];
    if (positions[positions.length - 1] !== originalIndex) positions.push(originalIndex);
  }
  return { score: score - (m - n), positions };
}

function charBonus(text: string, originalIndex: number): number {
  if (originalIndex === 0 || isBreak(text[originalIndex - 1])) return 14;
  if (isUpper(text[originalIndex]) && !isUpper(text[originalIndex - 1])) return 10;
  return 0;
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
