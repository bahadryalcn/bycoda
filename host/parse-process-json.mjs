/** Preserve raw C0 characters in process argument strings from OS serializers.
 * Repair only JSON string contents; malformed structure still fails closed. */
export function parseProcessJson(input) {
  const text = input.trim().replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch (failure) {
    let quoted = false,
      escaped = false,
      start = 0;
    const parts = [];
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted && character.charCodeAt(0) < 32) {
        if (escaped) throw failure;
        parts.push(
          text.slice(start, index),
          `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
        );
        start = index + 1;
      }
      if (character === '"' && !escaped) quoted = !quoted;
      escaped = quoted && character === "\\" && !escaped;
    }
    if (!parts.length) throw failure;
    parts.push(text.slice(start));
    return JSON.parse(parts.join(""));
  }
}
