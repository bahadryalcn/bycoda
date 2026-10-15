import type { Element, ElementContent, Root } from "hast";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePresentationVisible } from "./presentationVisibility";

/*
 * Streaming prose, paced. Tokens land in uneven bursts; read straight off the
 * wire, whole clauses pop in at once and then nothing for a beat. Instead the
 * text is let out a word at a time at a steady rate that closes on whatever
 * has arrived, and each word fades in as it is let out (the fade itself is
 * `.word-fading [data-word-fade]` in index.css), so the reply grows with a
 * soft leading edge rather than a ragged one.
 */

/** How long one word takes to fade in; matches `word-fade-in` in index.css. */
export const WORD_FADE_MS = 320;
/**
 * The slowest the reveal goes, in characters a second, so the tail of a
 * finished reply never crawls out.
 */
const REVEAL_MIN_CPS = 90;
/**
 * The reveal closes on what has arrived over about this long, so a steady
 * stream runs this far behind the wire and a burst spreads over it.
 */
const REVEAL_CATCHUP_S = 0.22;
/**
 * How long a word still being written is held back once the reveal has
 * caught up to it. Past this the stream has paused on it, so it shows as is.
 */
const REVEAL_HOLD_MS = 150;
export const REVEAL_MAX_BACKLOG = 4096;
export const REVEAL_MAX_LAG_MS = 500;

/**
 * Where to stop revealing `text` for a reveal that has reached `at`: the end
 * of the word `at` falls in, so a word is never shown half written. A stream
 * still mid-word holds back at the last whole word; a finished one runs out.
 */
export function revealEnd(text: string, at: number, streaming: boolean): number {
  for (let i = Math.max(0, Math.ceil(at)); i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) return i;
  }
  if (!streaming) return text.length;
  let end = text.length;
  while (end > 0 && !isSpace(text.charCodeAt(end - 1))) end--;
  return end;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 10 || code === 9 || code === 13;
}

/**
 * Pace arriving output from its first chunk; callers opening saved output
 * opt out of mount reveal. Completion of an active stream remains immediate.
 * Newly completed replies may opt into a bounded mount reveal. Hidden views,
 * reduced motion, low-latency preference and large backlogs bypass pacing.
 */
export function usePacedText(
  text: string,
  streaming: boolean,
  revealOnMount = streaming,
  enabled = true,
): { text: string; revealing: boolean } {
  const visible = usePresentationVisible();
  const shown = useRef(revealOnMount ? 0 : text.length);
  const pacing = useRef(streaming || revealOnMount);
  const mountReveal = useRef(revealOnMount && !streaming);
  const latest = useRef({ text, streaming });
  latest.current = { text, streaming };
  const backlogSince = useRef<number | null>(null);
  const [direct, setDirect] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () =>
      setDirect(
        !!preference?.matches || window.localStorage.getItem("bycoda-low-latency-text") === "true",
      );
    update();
    preference?.addEventListener?.("change", update);
    window.addEventListener("storage", update);
    return () => {
      preference?.removeEventListener?.("change", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  if (streaming) pacing.current = true;
  if (!pacing.current) shown.current = text.length;
  shown.current = Math.min(shown.current, text.length);
  if (
    !visible ||
    !enabled ||
    direct ||
    (!streaming && !mountReveal.current) ||
    text.length - shown.current > REVEAL_MAX_BACKLOG
  )
    shown.current = text.length;
  const behind = shown.current < text.length;

  useEffect(() => {
    if (!pacing.current) return;
    if (!behind) {
      backlogSince.current = null;
      if (!streaming) {
        pacing.current = false;
        mountReveal.current = false;
      }
      return;
    }
    let position = shown.current;
    let last = performance.now();
    backlogSince.current ??= last;
    let heldText = "";
    let heldAt = 0;
    let frame = requestAnimationFrame(function tick(now) {
      const { text, streaming } = latest.current;
      if (now - (backlogSince.current ?? now) >= REVEAL_MAX_LAG_MS) {
        shown.current = text.length;
        backlogSince.current = null;
        rerender();
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const backlog = text.length - position;
      const speed = Math.max(REVEAL_MIN_CPS, backlog / REVEAL_CATCHUP_S);
      position = Math.min(text.length, position + speed * dt);
      const end = revealEnd(text, position, streaming);
      if (end > shown.current) {
        shown.current = end;
        rerender();
      }
      // Once the reveal has run into the end of what has arrived there is
      // nothing to do until more does, which restarts this.
      if (position >= text.length && shown.current < text.length) {
        if (heldText !== text) {
          heldText = text;
          heldAt = now;
        }
        if (now - heldAt >= REVEAL_HOLD_MS) {
          shown.current = text.length;
          backlogSince.current = null;
          rerender();
        }
      }
      if (shown.current < text.length) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // New chunks change the target without restarting the reveal clock.
  }, [streaming, behind, visible, direct, enabled]);

  return {
    text: behind ? text.slice(0, shown.current) : text,
    revealing: behind,
  };
}

/**
 * Whether a reply's words may fade: while it streams or is being let out, and
 * for one fade after, so the last word finishes. Outside that the fade is off
 * — an animation replays whenever its element is hidden and shown again, and
 * a finished reply folded away and reopened must not fade in all over again.
 */
export function useWordFading(active: boolean, fadeMs = WORD_FADE_MS): boolean {
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    const timer = window.setTimeout(() => setLingering(false), fadeMs);
    return () => window.clearTimeout(timer);
  }, [active, fadeMs]);

  return active || lingering;
}

/*
 * Text here is either not prose (code, math, drawings) or read whole by the
 * component that renders it (links).
 */
const UNFADED_TAGS = new Set(["a", "code", "pre", "svg", "math", "kbd"]);

/** What the word fade needs to know that the tree it is handed does not say. */
export type WordFadeOptions = {
  /**
   * How many of the last words of the block are still fading in. Read each
   * time a block is parsed. Absent, every word counts as new.
   */
  freshWords?: () => number;
  /** Fixed timing for a word, measured back from the end of the parsed block. */
  wordStyle?: (fromEnd: number) => string | undefined;
};

export const ADAPTIVE_FADE_MAX_MS = 300;

/** Arrival-only fade window. Timing belongs to each word, never to the container:
 * a later burst cannot retime a fade that is already running. */
export function useArrivalFadeWindow(
  text: string,
  enabled: boolean,
  visible: boolean,
  entrance: boolean,
): WordFadeOptions & { id: number } {
  const state = useRef({
    text,
    enabled,
    visible,
    average: 100,
    lastBurst: null as number | null,
    base: entrance && enabled && visible ? 0 : text.length,
    log: [] as { at: number; length: number }[],
    words: [] as { at: number; duration: number }[],
    fresh: 0,
  });
  const options = useMemo(
    () => ({
      id: nextWindowId++,
      freshWords: () => state.current.fresh,
      wordStyle: (fromEnd: number) => {
        const words = state.current.words;
        const word = words[words.length - fromEnd - 1];
        return word ? `animation-duration:${word.duration}ms` : undefined;
      },
    }),
    [],
  );
  const s = state.current;
  const now = performance.now();
  const reset =
    !enabled || !visible || enabled !== s.enabled || visible !== s.visible ||
    (text !== s.text && !text.startsWith(s.text));
  if (reset) {
    s.base = text.length;
    s.log = [];
    s.words = [];
    s.average = 100;
    s.lastBurst = null;
  } else if (
    text !== s.text ||
    (entrance && s.base === 0 && s.log.length === 0 && text.length > 0)
  ) {
    const gap = s.lastBurst === null ? null : now - s.lastBurst;
    // A long pause starts a fresh rhythm instead of inflating later fades.
    s.average = gap === null || gap > 1000 ? 100 : s.average * 0.7 + gap * 0.3;
    const duration = Math.round(
      Math.max(80, Math.min(ADAPTIVE_FADE_MAX_MS, s.average * 2.5)),
    );
    const previousLength = s.log.length ? s.log[s.log.length - 1].length : s.base;
    const newWords = countTokens(text, previousLength);
    // Extending an unfinished word keeps its original fade and element.
    const continuing = previousLength > 0 &&
      !isSpace(text.charCodeAt(previousLength - 1)) &&
      previousLength < text.length && !isSpace(text.charCodeAt(previousLength));
    for (let i = continuing ? 1 : 0; i < newWords; i++) {
      s.words.push({ at: now, duration });
    }
    s.log.push({ at: now, length: text.length });
    s.lastBurst = now;
  }
  s.text = text;
  s.enabled = enabled;
  s.visible = visible;
  while (s.log.length && s.log[0].at <= now - ADAPTIVE_FADE_MAX_MS) {
    s.base = s.log.shift()!.length;
  }
  s.words = s.words.filter((word) => word.at > now - ADAPTIVE_FADE_MAX_MS);
  const settledPartial = s.base > 0 && s.base < text.length &&
    !isSpace(text.charCodeAt(s.base - 1)) && !isSpace(text.charCodeAt(s.base));
  s.fresh = reset
    ? 0
    : Math.max(0, countTokens(text, s.base) - (settledPartial ? 1 : 0));
  return options;
}

let nextWindowId = 0;

/**
 * A reply's fade window: how many of the words at the end of its text were
 * let out within the last `WORD_FADE_MS`. Only those need a span; words that
 * finished fading are plain text, so a long reply keeps a handful of spans, not
 * one per word. The returned options object never changes, and carries a
 * distinct `id` because Streamdown caches its processors by plugin name and
 * serialised options, and the plugin must read this reply's window, not
 * another's.
 */
export function useWordFadeWindow(text: string): WordFadeOptions & { id: number } {
  const state = useRef({
    length: text.length,
    // Text already there when the reply mounts is not a new word.
    log: [{ at: -Infinity, length: text.length }],
    fresh: 0,
  });
  const options = useMemo(
    () => ({ id: nextWindowId++, freshWords: () => state.current.fresh }),
    [],
  );

  const s = state.current;
  const now = performance.now();
  if (text.length < s.length) s.log = [{ at: -Infinity, length: text.length }];
  else if (text.length > s.length) s.log.push({ at: now, length: text.length });
  s.length = text.length;
  while (s.log.length > 1 && s.log[1].at <= now - WORD_FADE_MS) s.log.shift();
  s.fresh = countTokens(text, s.log[0].length);

  return options;
}

/** Whitespace-separated words in `text` from `from` on, the one a `from` falls inside included. */
function countTokens(text: string, from: number): number {
  let count = 0;
  let inWord = false;
  for (let i = from; i < text.length; i++) {
    const word = !isSpace(text.charCodeAt(i));
    if (word && !inWord) count++;
    inWord = word;
  }
  return count;
}

function countWords(parent: Root | Element): number {
  let count = 0;
  for (const child of parent.children) {
    if (child.type === "text") count += countTokens(child.value, 0);
    else if (child.type === "element" && !UNFADED_TAGS.has(child.tagName)) {
      count += countWords(child);
    }
  }
  return count;
}

/**
 * Wraps the words that are still fading in a span that fades in as it is
 * added to the page; with no `freshWords` that is every word. A word already
 * on screen keeps its element however often its block re-renders, so it never
 * fades twice, and a word the reveal has just let out is a new element, so it
 * does. That holds because each word's element is keyed by its place in the
 * block: the JSX keys count elements by tag name, so a plain `span` would hand
 * its key, and the finished fade it carries, on to the next word as the window
 * slides along. Words past the window go back to plain text, which is also
 * what stops a block's spans growing with its length.
 */
export function rehypeWordFade(options?: WordFadeOptions) {
  return (tree: Root) => {
    const total = countWords(tree);
    const firstFresh = options?.freshWords ? total - options.freshWords() : -1;
    let seen = 0;

    const wrap = (value: string): ElementContent[] => {
      const out: ElementContent[] = [];
      let plain = "";
      for (const part of value.split(/(\s+)/)) {
        if (!part) continue;
        if (isSpace(part.charCodeAt(0)) || seen++ < firstFresh) {
          plain += part;
          continue;
        }
        if (plain) out.push({ type: "text", value: plain });
        plain = "";
        out.push({
          type: "element",
          tagName: `fade-w${seen}`,
          properties: {
            dataWordFade: "",
            ...(options?.wordStyle ? { style: options.wordStyle(total - seen) } : {}),
          },
          children: [{ type: "text", value: part }],
        });
      }
      if (plain) out.push({ type: "text", value: plain });
      return out;
    };

    const walk = (parent: Root | Element) => {
      const children: Array<Root["children"][number]> = [];
      for (const child of parent.children) {
        if (child.type === "text") children.push(...wrap(child.value));
        else {
          if (child.type === "element" && !UNFADED_TAGS.has(child.tagName)) {
            walk(child);
          }
          children.push(child);
        }
      }
      parent.children = children as typeof parent.children;
    };

    walk(tree);
  };
}
