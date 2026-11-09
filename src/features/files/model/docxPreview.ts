/** Expanded preview limits are independent of the compressed document read limit. */
export const MAX_DOCX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_DOCX_HTML_CHARACTERS = 4 * 1024 * 1024;
export const MAX_DOCX_ELEMENTS = 20_000;
const MAX_DOCX_ENTRIES = 10_000;

const TOO_LARGE = "Document content is too large to preview. Open it in the default app instead.";

/** Check ZIP central-directory sizes before asking the converter to inflate XML/images. */
export function checkDocxExpansion(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65_535);
  while (end >= earliest) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
    end -= 1;
  }
  if (end < earliest) throw new Error("The document is not a readable DOCX archive.");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + directorySize;
  if (count > MAX_DOCX_ENTRIES || directoryEnd !== end) throw new Error(TOO_LARGE);
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("The document archive is incomplete.");
    expanded += view.getUint32(offset + 24, true);
    if (expanded > MAX_DOCX_EXPANDED_BYTES) throw new Error(TOO_LARGE);
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (offset > directoryEnd) throw new Error("The document archive is incomplete.");
  }
  if (offset !== directoryEnd) throw new Error("The document archive directory is inconsistent.");
}

/** Bound sanitizer/DOM work even for a small archive containing highly repetitive text. */
export function checkDocxHtml(html: string) {
  if (html.length > MAX_DOCX_HTML_CHARACTERS) throw new Error(TOO_LARGE);
  const tags = /<[a-z][a-z0-9:-]*(?=[\s/>])/gi;
  let count = 0;
  while (tags.exec(html)) if (++count > MAX_DOCX_ELEMENTS) throw new Error(TOO_LARGE);
}
