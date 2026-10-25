import { useEffect, useMemo, useState } from "react";
import { parseStreamingMarkdown } from "./streamingMarkdown";
import { MarkdownParseQueue } from "./markdownParseQueue";

export const LARGE_MARKDOWN_CHARS = 32 * 1024;
const queue = new MarkdownParseQueue(
  () => new Worker(new URL("./streamingMarkdown.worker.ts", import.meta.url), { type: "module" }),
);

/** Large replies keep their last complete parse while a bounded worker catches up. */
export function useParsedMarkdown(text: string, stream: string) {
  const [failed, setFailed] = useState(false);
  const [parsed, setParsed] = useState<{ source: string; blocks: string[] } | null>(null);
  const background = !failed && text.length > LARGE_MARKDOWN_CHARS && typeof Worker !== "undefined";
  const synchronous = useMemo(
    () => (background ? null : parseStreamingMarkdown(text, stream)),
    [background, text, stream],
  );
  useEffect(() => {
    if (!background) return;
    return queue.subscribe(stream, {
      result: (source, blocks) => setParsed({ source, blocks }),
      error: () => setFailed(true),
    });
  }, [background, stream]);
  useEffect(() => {
    if (background) queue.request(stream, text);
  }, [background, stream, text]);
  const compatible = parsed && text.startsWith(parsed.source) ? parsed : null;
  return {
    blocks: synchronous ?? compatible?.blocks ?? [],
    pending: background && compatible?.source !== text,
  };
}
