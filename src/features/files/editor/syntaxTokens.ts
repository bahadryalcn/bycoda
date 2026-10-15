import { highlightSource } from "../../source-control/model/diffHighlightSource";
export { highlightSource } from "../../source-control/model/diffHighlightSource";
import { runDiffWorker } from "../../source-control/model/diffWorker";
import type { ColorScheme } from "../../settings/model/appearance";
import type { UnifiedBlock, UnifiedLine } from "../../source-control/model/unifiedDiff";
import { languageForPath } from "./editorLanguage";

type DiffFile = {
  path: string;
  binary?: boolean;
  tooLarge?: boolean;
  blocks: readonly UnifiedBlock[];
};

export type SyntaxToken = {
  text: string;
  color?: string;
};

// Translation catalogs routinely exceed 250 kB. Keep a bounded parsing budget
// without disabling syntax colors for normal application source files.
const MAX_DIFF_HIGHLIGHT_CHARS = 1_000_000;

type TokenPair = readonly [SyntaxToken[][], SyntaxToken[][]];
const tokenCache = new Map<
  string,
  { original: string; current: string; value: Promise<TokenPair> }
>();
let cachedChars = 0;
function contentHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
function diffTokens(
  path: string,
  original: string,
  current: string,
  scheme: ColorScheme,
): Promise<TokenPair> {
  const key = `${path}:${scheme}:${contentHash(original)}:${contentHash(current)}`;
  const cached = tokenCache.get(key);
  // Verify exact text too: a hash collision must never color another document.
  if (cached && cached.original === original && cached.current === current) {
    tokenCache.delete(key);
    tokenCache.set(key, cached);
    return cached.value;
  }
  const value = runDiffWorker(
    (remote) => remote.highlight(path, original, current, scheme),
    async () => {
      const language = await languageForPath(path);
      return [
        highlightSource(original, language, scheme),
        highlightSource(current, language, scheme),
      ] as const;
    },
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

  const original: UnifiedLine[] = [];
  const current: UnifiedLine[] = [];
  let originalChars = 0;
  let currentChars = 0;
  for (const block of file.blocks) {
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
        return map;
      }
    }
  }

  const [originalTokens, currentTokens] = await diffTokens(
    file.path,
    original.map((line) => line.text).join("\n"),
    current.map((line) => line.text).join("\n"),
    scheme,
  );
  assignLineTokens(map, original, originalTokens, (line) => line.kind === "del");
  assignLineTokens(map, current, currentTokens, (line) => line.kind !== "del");
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
