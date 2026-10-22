/** Lossless ordered output; a safety drain caps retained hidden output at 4 MiB. */
type Output = string | Uint8Array;
export function terminalOutputBuffer(write: (data: Output) => void, limit = 4 * 1024 * 1024) {
  let visible = false;
  let chunks: Output[] = [];
  let size = 0;
  const flush = () => {
    if (!chunks.length) return;
    const pending = chunks;
    chunks = [];
    size = 0;
    for (let start = 0; start < pending.length;) {
      let end = start + 1;
      const text = typeof pending[start] === "string";
      while (end < pending.length && (typeof pending[end] === "string") === text) end++;
      const group = pending.slice(start, end);
      if (text) write(group.join(""));
      else {
        const bytes = group as Uint8Array[];
        const combined = new Uint8Array(bytes.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        for (const chunk of bytes) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        write(combined);
      }
      start = end;
    }
  };
  return {
    append(data: Output) {
      if (visible) write(data);
      else {
        chunks.push(data);
        size += typeof data === "string" ? data.length * 2 : data.byteLength;
        // Preserve ANSI parser state and all output without unbounded retention.
        if (size >= limit) flush();
      }
    },
    setVisible(next: boolean) {
      visible = next;
      if (visible) flush();
    },
    dispose() {
      chunks = [];
      size = 0;
    },
  };
}
