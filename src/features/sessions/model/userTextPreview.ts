export type UserTextPart = {
  text: string;
  kind: "text" | "json";
  compact: boolean;
};

function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function part(text: string, json = isJson(text)): UserTextPart {
  return {
    text,
    kind: json ? "json" : "text",
    compact: json || text.length > 600 || text.split("\n").length > 8,
  };
}

/** Presentation only: every part retains the exact source, including fences. */
export function userTextParts(text: string): UserTextPart[] {
  const parts: UserTextPart[] = [];
  const fences = /(^|\n)([ \t]*```(?:json)?[ \t]*\r?\n)([\s\S]*?)(\r?\n[ \t]*```(?=\r?\n|$))/g;
  let cursor = 0;
  for (const match of text.matchAll(fences)) {
    if (!isJson(match[3])) continue;
    const start = match.index! + match[1].length;
    if (start > cursor) parts.push(part(text.slice(cursor, start), false));
    const end = match.index! + match[0].length;
    parts.push(part(text.slice(start, end), true));
    cursor = end;
  }
  if (cursor < text.length) parts.push(part(text.slice(cursor)));
  return parts;
}

export function boundedTextPreview(text: string, characters = 1200, lines = 16): string {
  const preview = text.slice(0, characters).split("\n").slice(0, lines).join("\n");
  return preview.length < text.length ? `${preview}\n…` : preview;
}
