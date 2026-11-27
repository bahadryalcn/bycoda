/** The document surface the incremental count needs; a CodeMirror `Text` satisfies it. */
type SizedDocument = { readonly length: number; sliceString(from: number, to: number): string };
/** The change surface the incremental count needs; a CodeMirror `ChangeSet` satisfies it. */
type SizedChanges = {
  iterChanges(
    f: (
      fromA: number,
      toA: number,
      fromB: number,
      toB: number,
      inserted: { toString(): string },
    ) => void,
  ): void;
};

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * UTF-8 size of `text` exactly as `TextEncoder` encodes it (a lone surrogate is U+FFFD,
 * three bytes), without allocating the encoded buffer.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      isHighSurrogate(code) &&
      index + 1 < text.length &&
      isLowSurrogate(text.charCodeAt(index + 1))
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The exact UTF-8 size of the document after `changes`, from its size before them, in time
 * proportional to the edit rather than the document. Returns null when the edit is not a single
 * range (multi-cursor edits, replace-all), so the caller counts the whole new document instead.
 */
export function nextDocumentBytes(
  startDoc: SizedDocument,
  changes: SizedChanges,
  startBytes: number,
): number | null {
  let count = 0;
  let fromA = 0;
  let toA = 0;
  let insertedText = "";
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    count += 1;
    if (count > 1) return;
    fromA = from;
    toA = to;
    insertedText = inserted.toString();
  });
  if (count === 0) return startBytes;
  if (count > 1) return null;
  // A surrogate pair split by the edit changes how its halves encode, so widen both sides of the
  // edit to the neighbouring half; unchanged text on either side then cannot pair across it.
  let before = "";
  let after = "";
  if (fromA > 0) {
    const previous = startDoc.sliceString(fromA - 1, fromA);
    if (isHighSurrogate(previous.charCodeAt(0))) before = previous;
  }
  if (toA < startDoc.length) {
    const following = startDoc.sliceString(toA, toA + 1);
    if (isLowSurrogate(following.charCodeAt(0))) after = following;
  }
  const removed = before + startDoc.sliceString(fromA, toA) + after;
  const added = before + insertedText + after;
  return startBytes - utf8ByteLength(removed) + utf8ByteLength(added);
}
