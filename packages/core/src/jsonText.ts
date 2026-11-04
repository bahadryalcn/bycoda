export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) escaping = false;
      else if (char === "\\") escaping = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }
  return null;
}

const GIT_TEXT_KEYS = ["subject", "title", "message", "body", "branch"] as const;

/** Memoized JSON grammar suffixes avoid extracting and parsing every overlapping brace.
 * Tables use 14 bytes/code unit on ordinary supported string lengths; no payload cap changes. */
function selectedJsonObject(raw: string): { start: number; end: number } | null {
  const length = raw.length;
  const IndexTable = length < 0xffff_ffff ? Uint32Array : Float64Array;
  const values = new IndexTable(length + 1);
  // Quote positions first hold string ends, then member-list ends. Digit positions hold run ends.
  const tokens = new IndexTable(length + 1);
  // Whitespace positions hold the next non-space index; other positions hold array-list ends.
  const tails = new IndexTable(length + 1);
  const seenKeys = new Uint8Array(length + 1);
  const stringKeys = new Uint8Array(length + 1);
  const bodies = new Array<number>(7).fill(0);
  const digit = (index: number) => raw.charCodeAt(index) >= 48 && raw.charCodeAt(index) <= 57;
  const space = (index: number) => {
    const code = raw.charCodeAt(index);
    return code === 32 || code === 9 || code === 10 || code === 13;
  };
  const hex = (index: number) => {
    const code = raw.charCodeAt(index);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
  };
  const skip = (index: number): number => (space(index) ? tails[index] : index);
  let digitEnd = 0;
  for (let index = length - 1; index >= 0; index--) {
    tails[index] = space(index) ? (space(index + 1) ? tails[index + 1] : index + 1) : index;
    if (digit(index)) {
      if (!digit(index + 1)) digitEnd = index + 1;
      tokens[index] = digitEnd;
    }
    const char = raw[index];
    let end = bodies[(index + 1) % 7];
    if (char === '"') {
      tokens[index] = end;
      end = index + 1;
    } else if (char === "\\") {
      const escaped = raw[index + 1];
      if (escaped && '"\\/bfnrt'.includes(escaped)) end = bodies[(index + 2) % 7];
      else if (
        escaped === "u" &&
        hex(index + 2) &&
        hex(index + 3) &&
        hex(index + 4) &&
        hex(index + 5)
      )
        end = bodies[(index + 6) % 7];
      else end = 0;
    } else if (raw.charCodeAt(index) < 32) end = 0;
    bodies[index % 7] = end;
  }
  const numberEnd = (start: number): number => {
    let index = raw[start] === "-" ? start + 1 : start;
    if (raw[index] === "0") index++;
    else if (digit(index)) index = tokens[index];
    else return 0;
    if (raw[index] === "." && digit(index + 1)) index = tokens[index + 1];
    if (raw[index] === "e" || raw[index] === "E") {
      let exponent = index + 1;
      if (raw[exponent] === "+" || raw[exponent] === "-") exponent++;
      if (digit(exponent)) index = tokens[exponent];
    }
    return index;
  };
  const keyBit = (start: number, end: number): number => {
    // An escaped Git key has at most seven six-character Unicode escapes.
    if (end - start > 44) return 0;
    const text = raw.slice(start + 1, end - 1);
    const key: unknown = text.includes("\\") ? JSON.parse(raw.slice(start, end)) : text;
    const index = GIT_TEXT_KEYS.findIndex((candidate) => candidate === key);
    return index < 0 ? 0 : 1 << index;
  };
  for (let index = length - 1; index >= 0; index--) {
    if (space(index)) continue;
    const char = raw[index];
    let end = 0;
    if (char === '"') end = tokens[index];
    else if (char === "{" || char === "[") {
      const first = skip(index + 1);
      const close = char === "{" ? "}" : "]";
      if (raw[first] === close) end = first + 1;
      else if (char === "[") end = tails[first];
      else if (raw[first] === '"') {
        end = tokens[first];
        seenKeys[index] = stringKeys[first] ? 1 : 0;
      }
    } else if (char === "-" || digit(index)) end = numberEnd(index);
    else if (raw.startsWith("true", index) || raw.startsWith("null", index)) end = index + 4;
    else if (raw.startsWith("false", index)) end = index + 5;
    values[index] = end;

    // A quoted key and its direct value followed by a complete object-member suffix.
    if (char === '"') {
      const colon = end ? skip(end) : length;
      const value = raw[colon] === ":" ? skip(colon + 1) : length;
      const after = values[value] ? skip(values[value]) : length;
      let suffix = 0,
        seen = 0,
        strings = 0;
      if (raw[after] === "}") suffix = after + 1;
      else if (raw[after] === ",") {
        const next = skip(after + 1);
        if (raw[next] === '"') {
          suffix = tokens[next];
          seen = seenKeys[next];
          strings = stringKeys[next];
        }
      }
      tokens[index] = suffix;
      if (suffix) {
        const bit = keyBit(index, end);
        seenKeys[index] = seen | bit;
        // JSON duplicate keys use the last value, including non-string replacements.
        stringKeys[index] = strings | (!(seen & bit) && raw[value] === '"' ? bit : 0);
      }
    }
    let tail = 0;
    if (end) {
      const after = skip(end);
      if (raw[after] === "]") tail = after + 1;
      else if (raw[after] === ",") {
        const next = skip(after + 1);
        if (values[next]) tail = tails[next];
      }
    }
    tails[index] = tail;
  }
  let fallback: { start: number; end: number } | null = null;
  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    const end = values[start];
    if (!end) continue;
    const candidate = { start, end };
    if (seenKeys[start]) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const selected = selectedJsonObject(trimmed);
  if (!selected) return null;
  try {
    return JSON.parse(trimmed.slice(selected.start, selected.end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function stringField(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}
