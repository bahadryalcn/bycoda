import { themePalette } from "../../../shared/theme/palette";
import type { GraphRef } from "./gitGraph";

/** Colour of the avatar for an author with no name. */
const ANONYMOUS_COLOR = themePalette.hsl_0_0pct_50pct;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Up to two letters: first of the first word and first of the last word. */
export function authorInitials(name: string): string {
  const words = normalizeName(name).split(" ").filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  // Array.from keeps surrogate pairs (emoji, rare CJK) in one piece.
  const letter = (word: string) => (Array.from(word)[0] ?? "").toLocaleUpperCase();
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return letter(first) + (last ? letter(last) : "");
}

/** FNV-1a, so the same name always lands on the same hue. */
function hashName(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Avatar background derived from the author name. Case and spacing do not
 * change it. Mid lightness, so the theme's base colour reads on top of it.
 */
export function authorColor(name: string): string {
  const normalized = normalizeName(name).toLocaleLowerCase();
  if (!normalized) return ANONYMOUS_COLOR;
  return `hsl(${hashName(normalized) % 360} 55% 55%)`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "3m", "2h", "5d", "3w", "8mo", "2y"; timestamps in the future read as "now". */
export function formatRelativeTime(timestampSeconds: number, nowMs: number): string {
  const age = Math.max(0, Math.floor(nowMs / 1000 - timestampSeconds));
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  const days = Math.floor(age / DAY);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30.44))}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Local date and time for tooltips. */
export function formatAbsoluteTime(
  timestampSeconds: number,
  locale?: string,
  timeZone?: string,
): string {
  return new Date(timestampSeconds * 1000).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function isMergeCommit(commit: { parents: readonly string[] }): boolean {
  return commit.parents.length > 1;
}

export type GraphRefChip = GraphRef & {
  /** The branch HEAD is on. */
  current: boolean;
};

const KIND_ORDER: Record<string, number> = { local: 0, remote: 1, tag: 2 };

/**
 * Local branches first, then remotes, then tags. The order the layout already
 * chose (current branch, its upstream, coloured refs) is kept within a kind.
 */
export function orderGraphRefs(refs: readonly GraphRef[], head: boolean): GraphRefChip[] {
  const ordered = refs
    .map((ref, index) => ({ ref, index }))
    .sort(
      (a, b) => (KIND_ORDER[a.ref.kind] ?? 3) - (KIND_ORDER[b.ref.kind] ?? 3) || a.index - b.index,
    )
    .map(({ ref }) => ref);
  const currentRef = head ? ordered.find((ref) => ref.kind === "local") : undefined;
  return ordered.map((ref) => ({ ...ref, current: ref === currentRef }));
}

const PILL_CHROME_PX = 16;
const PILL_CHAR_PX = 5.6;
const PILL_GAP_PX = 4;
/** Width reserved for the "+N" pill. */
const MORE_PILL_PX = 26;

/** Rough rendered width of a pill at 10px type, capped like the pill itself. */
export function estimatePillWidth(ref: GraphRef, maxPillPx: number): number {
  return Math.min(maxPillPx, PILL_CHROME_PX + ref.name.length * PILL_CHAR_PX);
}

/**
 * Splits refs into the pills that fit a pixel budget and the rest, which go
 * behind a "+N" pill. The first pill always shows (truncated if it must).
 */
export function splitRefsForBudget<T extends GraphRef>(
  refs: readonly T[],
  budgetPx: number,
  maxPillPx: number,
): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  let used = 0;
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i];
    if (!ref) continue;
    const width = estimatePillWidth(ref, maxPillPx) + (shown.length ? PILL_GAP_PX : 0);
    const reserve = i < refs.length - 1 ? PILL_GAP_PX + MORE_PILL_PX : 0;
    if (shown.length > 0 && used + width + reserve > budgetPx) break;
    shown.push(ref);
    used += width;
  }
  return { shown, hidden: refs.slice(shown.length) };
}
