type Output = string | Uint8Array;
type Entry = { data: Output; consumed: () => void };
/** Ordered parser admission, including a bounded hidden hold. */
export function terminalOutputBuffer(
  write: (data: Output, consumed?: () => void) => void,
  limit = 4 * 1024 * 1024,
  acknowledged = false,
) {
  let visible = false,
    disposed = false,
    writing = false;
  let held: Output[] = [];
  let size = 0;
  const queue: Entry[] = [];
  let activeDone: (() => void) | undefined;
  const pump = () => {
    if (writing || disposed) return;
    const entry = queue.shift();
    if (!entry) return;
    writing = true;
    let done = false;
    const consumed = () => {
      if (done) return;
      done = true;
      entry.consumed();
      activeDone = undefined;
      writing = false;
      pump();
    };
    activeDone = consumed;
    try {
      if (acknowledged) write(entry.data, consumed);
      else {
        write(entry.data);
        consumed();
      }
    } catch (error) {
      consumed();
      throw error;
    }
  };
  const flush = (consumed = () => {}) => {
    const chunks = held;
    held = [];
    size = 0;
    if (!chunks.length) {
      consumed();
      return;
    }
    for (let start = 0; start < chunks.length;) {
      let end = start + 1;
      const text = typeof chunks[start] === "string";
      while (end < chunks.length && (typeof chunks[end] === "string") === text) end++;
      const group = chunks.slice(start, end);
      let data: Output;
      if (text) data = group.join("");
      else {
        const bytes = group as Uint8Array[];
        const combined = new Uint8Array(bytes.reduce((length, chunk) => length + chunk.length, 0));
        let offset = 0;
        for (const chunk of bytes) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        data = combined;
      }
      queue.push({ data, consumed: end === chunks.length ? consumed : () => {} });
      start = end;
    }
    pump();
  };
  return {
    append(data: Output, consumed = () => {}) {
      if (disposed) {
        consumed();
        return;
      }
      // Withhold credits during hidden safety drains too, bounding the downstream queue.
      if (visible || writing || queue.length) {
        queue.push({ data, consumed });
        pump();
      } else {
        held.push(data);
        size += typeof data === "string" ? data.length * 2 : data.byteLength;
        if (size >= limit) flush(consumed);
        else consumed();
      }
    },
    setVisible(next: boolean) {
      visible = next;
      if (visible && !disposed) flush();
    },
    dispose() {
      disposed = true;
      held = [];
      size = 0;
      activeDone?.();
      for (const entry of queue.splice(0)) entry.consumed();
    },
  };
}
