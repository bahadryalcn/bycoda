import { parseStreamingMarkdown } from "./streamingMarkdown";

self.onmessage = (event: MessageEvent<{ stream: string; text: string; sequence: number }>) => {
  const { stream, text, sequence } = event.data;
  try {
    self.postMessage({ sequence, blocks: parseStreamingMarkdown(text, stream) });
  } catch {
    self.postMessage({ sequence, failed: true });
  }
};
