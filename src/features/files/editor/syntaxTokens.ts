import { highlightSource } from "../../../shared/lib/syntaxHighlight";
import type { SyntaxToken } from "../../../shared/lib/syntaxHighlight";
import type { ColorScheme } from "../../settings";
import type { UnifiedBlock, UnifiedLine } from "../../source-control";
import { languageForPath } from "./editorLanguage";

export { highlightSource };
export type { SyntaxToken };

type DiffFile = {
  path: string;
  binary?: boolean;
  tooLarge?: boolean;
  blocks: readonly UnifiedBlock[];
};

// Translation catalogs routinely exceed 250 kB. Keep a bounded parsing budget
// without disabling syntax colors for normal application source files.
const MAX_DIFF_HIGHLIGHT_CHARS = 1_000_000;

type TokenPair = readonly [SyntaxToken[][], SyntaxToken[][]];
type PreparedDiff = {
  original: UnifiedLine[];
  current: UnifiedLine[];
  originalText: string;
  currentText: string;
  originalHash: string;
  currentHash: string;
};
const tokenCache = new Map<
  string,
  { original: string; current: string; value: Promise<TokenPair> }
>();
let cachedChars = 0;
// Keyed by the blocks array: the same diff re-highlights on every expand or theme change,
// and joining and hashing its full text each time is wasted main-thread work.
const preparedCache = new WeakMap<readonly UnifiedBlock[], PreparedDiff | null>();
function contentHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
function prepareDiff(blocks: readonly UnifiedBlock[]): PreparedDiff | null {
  if (preparedCache.has(blocks)) return preparedCache.get(blocks) ?? null;
  const original: UnifiedLine[] = [];
  const current: UnifiedLine[] = [];
  let originalChars = 0;
  let currentChars = 0;
  let prepared: PreparedDiff | null = null;
  collect: for (const block of blocks) {
    for (const line of block.lines) {
      if (line.kind === "hunk") continue;
      if (line.kind !== "add") {
        original.push(line);
        originalChars += line.text.length + 1;
      }
      if (line.kind !== "del") {
        current.push(line);
        currentChars += line.text.length + 1;
      }
      // Rendering remains complete; only decorative parsing is skipped.
      if (originalChars > MAX_DIFF_HIGHLIGHT_CHARS || currentChars > MAX_DIFF_HIGHLIGHT_CHARS) {
        break collect;
      }
    }
  }
  if (originalChars <= MAX_DIFF_HIGHLIGHT_CHARS && currentChars <= MAX_DIFF_HIGHLIGHT_CHARS) {
    const originalText = original.map((line) => line.text).join("\n");
    const currentText = current.map((line) => line.text).join("\n");
    prepared = {
      original,
      current,
      originalText,
      currentText,
      originalHash: contentHash(originalText),
      currentHash: contentHash(currentText),
    };
  }
  preparedCache.set(blocks, prepared);
  return prepared;
}
function diffTokens(path: string, diff: PreparedDiff, scheme: ColorScheme): Promise<TokenPair> {
  const { originalText: original, currentText: current } = diff;
  const key = `${path}:${scheme}:${diff.originalHash}:${diff.currentHash}`;
  const cached = tokenCache.get(key);
  // Verify exact text too: a hash collision must never color another document.
  if (cached && cached.original === original && cached.current === current) {
    tokenCache.delete(key);
    tokenCache.set(key, cached);
    return cached.value;
  }
  const value = import("../../source-control/public/diffWorker").then(({ runDiffWorker }) =>
    runDiffWorker(
      (remote) => remote.highlight(path, original, current, scheme),
      async () => {
        const language = await languageForPath(path);
        return [
          highlightSource(original, language, scheme),
          highlightSource(current, language, scheme),
        ] as const;
      },
      // The deadline scales with the input, so large files are not timed out as hangs.
      { size: original.length + current.length },
    ),
  );
  if (cached) cachedChars -= cached.original.length + cached.current.length;
  tokenCache.set(key, { original, current, value });
  cachedChars += original.length + current.length;
  while (tokenCache.size > 16 || cachedChars > 4_000_000) {
    const oldest = tokenCache.keys().next().value!;
    const entry = tokenCache.get(oldest)!;
    cachedChars -= entry.original.length + entry.current.length;
    tokenCache.delete(oldest);
  }
  void value.catch(() => {
    if (tokenCache.get(key)?.value === value) {
      tokenCache.delete(key);
      cachedChars -= original.length + current.length;
    }
  });
  return value;
}

export async function highlightDiffFile(
  file: DiffFile,
  scheme: ColorScheme,
): Promise<Map<UnifiedLine, SyntaxToken[]>> {
  const map = new Map<UnifiedLine, SyntaxToken[]>();
  if (file.binary || file.tooLarge) return map;

  const diff = prepareDiff(file.blocks);
  // Too large for decorative parsing: rendering stays complete without colors.
  if (!diff) return map;

  const [originalTokens, currentTokens] = await diffTokens(file.path, diff, scheme);
  assignLineTokens(map, diff.original, originalTokens, (line) => line.kind === "del");
  assignLineTokens(map, diff.current, currentTokens, (line) => line.kind !== "del");
  return map;
}

function assignLineTokens(
  map: Map<UnifiedLine, SyntaxToken[]>,
  lines: readonly UnifiedLine[],
  tokens: readonly SyntaxToken[][],
  take: (line: UnifiedLine) => boolean,
) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!take(line)) continue;
    const pieces = tokens[index];
    map.set(line, pieces && joinText(pieces) === line.text ? pieces : [{ text: line.text }]);
  }
}

function joinText(tokens: readonly SyntaxToken[]): string {
  return tokens.map((token) => token.text).join("");
}
