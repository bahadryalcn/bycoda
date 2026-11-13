import { useEffect, useMemo, useRef, useState } from "react";
import { parseStreamingMarkdown } from "./streamingMarkdown";
import { MarkdownParseQueue } from "./markdownParseQueue";
import { createMarkdownWorker } from "./markdownWorker";

export const LARGE_MARKDOWN_CHARS = 128 * 1024;
const queue = new MarkdownParseQueue(createMarkdownWorker);

/** Large replies keep their last complete parse while a bounded worker catches up. */
export function useParsedMarkdown(text: string, stream: string) {
  const [failed, setFailed] = useState(false);
  const [parsed, setParsed] = useState<{ stream: string; source: string; blocks: string[] } | null>(
    null,
  );
  const previous = useRef<typeof parsed>(null);
  const large = text.length > LARGE_MARKDOWN_CHARS;
  const background = !failed && large && typeof Worker !== "undefined";
  const synchronous = useMemo(
    () => (large ? null : parseStreamingMarkdown(text, stream)),
    [large, text, stream],
  );
  if (synchronous) previous.current = { stream, source: text, blocks: synchronous };
  useEffect(() => {
    if (!background) return;
    return queue.subscribe(stream, {
      result: (source, blocks) => setParsed({ stream, source, blocks }),
      error: () => setFailed(true),
    });
  }, [background, stream]);
  useEffect(() => {
    if (background) queue.request(stream, text);
  }, [background, stream, text]);
  const fromWorker = parsed?.stream === stream && text.startsWith(parsed.source) ? parsed : null;
  const fromPrevious =
    previous.current?.stream === stream && text.startsWith(previous.current.source)
      ? previous.current
      : null;
  const compatible =
    fromWorker && (!fromPrevious || fromWorker.source.length >= fromPrevious.source.length)
      ? fromWorker
      : fromPrevious;
  return {
    blocks: synchronous ?? compatible?.blocks ?? [],
    pending: background && compatible?.source !== text,
    sourceFallback: large && !background,
  };
}
