import type { ReactNode } from "react";

type Props = {
  text: string;
  positions: number[];
  active: boolean;
};

export const MAX_MATCH_POSITIONS = 2048;
const MAX_MATCH_RUNS = 128;

/** Bound decoration work; the complete original text remains selectable/searchable. */
export function matchPositions(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  for (let from = haystack.indexOf(needle); from >= 0 && positions.length < MAX_MATCH_POSITIONS;) {
    for (let i = 0; i < needle.length && positions.length < MAX_MATCH_POSITIONS; i++)
      positions.push(from + i);
    from = haystack.indexOf(needle, from + needle.length);
  }
  return positions;
}

/** Fuzzy-match text with the matched characters accented. */
export function MatchText({ text, positions, active }: Props): ReactNode {
  if (!active || positions.length === 0) return text;
  const marked = [...new Set(positions.slice(0, MAX_MATCH_POSITIONS))]
    .filter((position) => Number.isInteger(position) && position >= 0 && position < text.length)
    .sort((a, b) => a - b);
  const runs: { text: string; match: boolean }[] = [];
  let cursor = 0;
  let groups = 0;
  for (let index = 0; index < marked.length && groups < MAX_MATCH_RUNS; groups++) {
    const from = marked[index++];
    let to = from + 1;
    while (index < marked.length && marked[index] === to) {
      index++;
      to++;
    }
    if (from > cursor) runs.push({ text: text.slice(cursor, from), match: false });
    runs.push({ text: text.slice(from, to), match: true });
    cursor = to;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), match: false });
  return runs.map((run, index) =>
    run.match ? (
      <span key={index} className="text-accent">
        {run.text}
      </span>
    ) : (
      <span key={index}>{run.text}</span>
    ),
  );
}
