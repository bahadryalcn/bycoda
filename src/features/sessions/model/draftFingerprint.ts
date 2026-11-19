/**
 * Compact stand-in for a large string (an attachment's base64 or a serialized
 * draft row), so the draft store can ask "is this the same content?" without
 * keeping a second copy of the content alive.
 *
 * Equal strings always give equal fingerprints. Different strings of the same
 * length collide with odds around 2^-64.
 */
// shortcut: non-cryptographic; a collision would reuse one stale spilled file or skip one
// identical-length autosave. Move to a streamed SHA-256 if drafts ever cross a trust boundary.
export function draftFingerprint(text: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `fp:${text.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}
