/** Largest single stdout line a hub child may send; past this the line is dropped whole. */
export const MAX_CHILD_LINE_BYTES = 4 * 1024 * 1024;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export type StdoutLines = {
  push: (chunk: Buffer) => void;
  end: () => void;
};

/**
 * Splits raw stdout bytes into lines without holding more than `maxBytes` of an unfinished line.
 * An oversized line is discarded up to its newline and reported once through `onOverflow`;
 * the lines after it are unaffected. Each complete line is decoded on its own, lossily.
 */
export function splitStdoutLines(
  onLine: (line: string) => void,
  onOverflow: () => void,
  maxBytes = MAX_CHILD_LINE_BYTES,
): StdoutLines {
  let parts: Buffer[] = [];
  let size = 0;
  let discarding = false;

  const emit = (segment: Buffer) => {
    const bytes = parts.length ? Buffer.concat([...parts, segment]) : segment;
    parts = [];
    size = 0;
    const hasCarriageReturn = bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN;
    onLine(bytes.subarray(0, hasCarriageReturn ? bytes.length - 1 : bytes.length).toString("utf8"));
  };

  const overflow = () => {
    parts = [];
    size = 0;
    onOverflow();
  };

  return {
    push(chunk) {
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf(NEWLINE, start);
        const segment = chunk.subarray(start, newline === -1 ? chunk.length : newline);
        if (discarding) {
          if (newline === -1) return;
          discarding = false;
        } else if (size + segment.length > maxBytes) {
          if (newline === -1) {
            discarding = true;
            overflow();
            return;
          }
          overflow();
        } else if (newline === -1) {
          parts.push(segment);
          size += segment.length;
          return;
        } else {
          emit(segment);
        }
        start = newline + 1;
      }
    },
    end() {
      if (!discarding && size > 0) emit(Buffer.alloc(0));
      parts = [];
      size = 0;
      discarding = false;
    },
  };
}
