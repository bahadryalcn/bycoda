import type { HighlightOptions, HighlightResult } from "@streamdown/code";
import { createBoundedCodePlugin } from "./codeHighlightCore";

// The renderer caches complete results. This worker only retains loaded grammars.
const highlighter = createBoundedCodePlugin({ maxChars: 0, maxEntries: 0 });
self.onmessage = ({ data }: MessageEvent<{ id: number; args: HighlightOptions }>) => {
  const reply = ({ grammarState: _grammar, ...result }: HighlightResult) => {
    // Shiki's grammar checkpoint contains engine objects. The renderer only needs the tokens and colors.
    self.postMessage({ id: data.id, result });
  };
  const cached = highlighter.highlight(data.args, reply);
  if (cached) reply(cached);
};
