import type { CodeHighlighterPlugin, HighlightResult, ThemeInput } from "@streamdown/code";
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type GrammarState,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * `@streamdown/code` keeps every token result in a module-level Map that is
 * never evicted. Streamdown highlights a fence again on every streamed update,
 * so each partial version of every code block an agent wrote stayed in memory
 * for the life of the window. Its key (length plus the first and last 100
 * characters) also let different blocks share a result. This keeps the same
 * `CodeHighlighterPlugin` shape with a bounded LRU and an exact key, and loads
 * languages into one highlighter per theme pair instead of one per language.
 *
 * Mounted blocks hold their tokens in component state, so eviction only means
 * a remounted block briefly shows plain text while it is highlighted again.
 */
const DEFAULT_THEMES: [ThemeInput, ThemeInput] = ["github-light", "github-dark"];
const MAX_ENTRIES = 100;
const MAX_CACHED_CHARS = 500_000;
/** Streams resumed independently: replies, panes and subagents can stream fences at once. */
const MAX_CHECKPOINTS = 8;

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
type HighlightCallback = (result: HighlightResult) => void;

export type BoundedCodePlugin = CodeHighlighterPlugin & {
  /** Number of token results currently cached. */
  cachedResults(): number;
};

const engine = createJavaScriptRegexEngine({ forgiving: true });
const aliases: Record<string, string> = Object.fromEntries(
  bundledLanguagesInfo.flatMap((info) => (info.aliases ?? []).map((alias) => [alias, info.id])),
);
const supported = new Set(Object.keys(bundledLanguages));

function normalizeLanguage(language: string): string {
  const lower = language.trim().toLowerCase();
  return aliases[lower] ?? lower;
}

function themeName(theme: ThemeInput): string {
  return typeof theme === "string" ? theme : (theme.name ?? "custom");
}

function themeKey(theme: ThemeInput): string {
  return typeof theme === "string" ? theme : JSON.stringify(theme);
}

export function createBoundedCodePlugin(
  options: {
    themes?: [ThemeInput, ThemeInput];
    maxEntries?: number;
    maxChars?: number;
  } = {},
): BoundedCodePlugin {
  const themes = options.themes ?? DEFAULT_THEMES;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxChars = options.maxChars ?? MAX_CACHED_CHARS;
  const highlighters = new Map<string, Promise<Highlighter>>();
  const results = new Map<string, HighlightResult>();
  const pending = new Map<string, Set<HighlightCallback>>();
  let cachedChars = 0;
  // Bounded streaming prefixes, one per growing block and independent of the
  // exact-result LRU. Only newline-terminated lines are reusable; the unfinished
  // tail can change syntax. `key` is the latest partial result of that stream.
  type Checkpoint = {
    config: string;
    source: string;
    tokens: HighlightResult["tokens"];
    state: GrammarState | undefined;
    key: string;
  };
  let checkpoints: Checkpoint[] = [];
  const checkpointChars = () => checkpoints.reduce((sum, item) => sum + item.source.length, 0);

  const highlighterFor = (pair: [ThemeInput, ThemeInput]) => {
    const key = `${themeKey(pair[0])}\u0000${themeKey(pair[1])}`;
    let highlighter = highlighters.get(key);
    if (!highlighter) {
      highlighter = createHighlighter({ themes: pair, langs: [], engine });
      highlighters.set(key, highlighter);
      highlighter.catch(() => highlighters.delete(key));
    }
    return highlighter;
  };

  const remember = (key: string, result: HighlightResult) => {
    if (results.delete(key)) cachedChars -= key.length;
    // A block larger than the whole budget is delivered but never cached.
    if (key.length <= maxChars) {
      results.set(key, result);
      cachedChars += key.length;
    }
    while (results.size > maxEntries || cachedChars + checkpointChars() > maxChars) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      results.delete(oldest);
      cachedChars -= oldest.length;
    }
  };

  return {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage: (language) => supported.has(normalizeLanguage(language)),
    getSupportedLanguages: () => Array.from(supported) as BundledLanguage[],
    getThemes: () => themes,
    cachedResults: () => results.size,
    highlight({ code, language, themes: pair }, callback) {
      const lang = normalizeLanguage(language);
      const names = [themeName(pair[0]), themeName(pair[1])] as const;
      const config = `${lang}\u0000${themeKey(pair[0])}\u0000${themeKey(pair[1])}`;
      const key = `${config}\u0000${code}`;
      const cached = results.get(key);
      if (cached) {
        // Refresh recency so blocks still on screen are evicted last.
        results.delete(key);
        results.set(key, cached);
        return cached;
      }
      const waiting = pending.get(key);
      if (waiting) {
        if (callback) waiting.add(callback);
        return null;
      }
      pending.set(key, new Set(callback ? [callback] : []));
      void highlighterFor(pair)
        .then(async (highlighter) => {
          if (supported.has(lang) && !highlighter.getLoadedLanguages().includes(lang)) {
            await highlighter.loadLanguage(lang as BundledLanguage);
          }
          const usable = highlighter.getLoadedLanguages().includes(lang) ? lang : "text";
          const settings = {
            lang: usable as BundledLanguage,
            themes: { light: names[0], dark: names[1] },
          };
          let previous: Checkpoint | undefined;
          for (const item of checkpoints)
            if (
              item.config === config &&
              code.startsWith(item.source) &&
              item.source.length > (previous?.source.length ?? -1)
            )
              previous = item;
          const offset = previous?.source.length ?? 0;
          const boundary = code.lastIndexOf("\n") + 1;
          let prefix = previous?.tokens ?? [];
          let state = previous?.state;
          const shifted = (tokens: HighlightResult["tokens"], start: number) =>
            tokens.map((line) => line.map((token) => ({ ...token, offset: token.offset + start })));
          if (boundary > offset) {
            const end = code[boundary - 2] === "\r" ? boundary - 2 : boundary - 1;
            const complete = highlighter.codeToTokens(code.slice(offset, end), {
              ...settings,
              grammarState: state,
            });
            prefix = [...prefix, ...shifted(complete.tokens, offset)];
            state = complete.grammarState;
          }
          const tail = highlighter.codeToTokens(code.slice(boundary), {
            ...settings,
            grammarState: state,
          });
          const result = { ...tail, tokens: [...prefix, ...shifted(tail.tokens, boundary)] };
          // A newer version of the same stream supersedes its last partial result,
          // so streaming one fence no longer pushes finished blocks out of the LRU.
          if (
            previous &&
            previous.key !== key &&
            key.startsWith(previous.key) &&
            results.delete(previous.key)
          )
            cachedChars -= previous.key.length;
          checkpoints = checkpoints.filter((item) => item !== previous);
          if (boundary > 0 && boundary <= maxChars) {
            checkpoints.push({
              config,
              source: code.slice(0, boundary),
              tokens: prefix,
              state,
              key,
            });
            while (checkpoints.length > MAX_CHECKPOINTS || checkpointChars() > maxChars)
              checkpoints.shift();
          }
          remember(key, result);
          const callbacks = pending.get(key);
          pending.delete(key);
          callbacks?.forEach((notify) => notify(result));
        })
        .catch((error: unknown) => {
          pending.delete(key);
          console.error("[Code highlight] Failed to highlight code:", error);
        });
      return null;
    },
  };
}
