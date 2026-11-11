/** Minimal TOML reader for the subset Codex writes for `[mcp_servers.*]` tables:
 * tables, arrays of tables, dotted and quoted keys, strings, numbers, booleans,
 * arrays and inline tables.
 * Unsupported syntax throws so the caller can skip the file instead of guessing. */
type Json = string | number | boolean | Json[] | { [key: string]: Json };

export function parseTomlSubset(text: string): Record<string, Json> {
  const root: Record<string, Json> = {};
  let table = root;
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`TOML ${what} at offset ${i}`);
  };
  const skipSpace = (lines = false) => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || (lines && c === "\n")) i++;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else break;
    }
  };
  const parseString = (): string => {
    const quote = text[i];
    if (text.startsWith(quote.repeat(3), i)) fail("multi-line strings are unsupported");
    i++;
    let out = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\n") fail("unterminated string");
      if (quote === "'" || text[i] !== "\\") {
        out += text[i++];
        continue;
      }
      const escape = text[i + 1];
      const map: Record<string, string> = {
        b: "\b",
        t: "\t",
        n: "\n",
        f: "\f",
        r: "\r",
        '"': '"',
        "\\": "\\",
      };
      if (escape === "u" || escape === "U") {
        const size = escape === "u" ? 4 : 8;
        const code = Number.parseInt(text.slice(i + 2, i + 2 + size), 16);
        if (!Number.isFinite(code)) fail("bad unicode escape");
        out += String.fromCodePoint(code);
        i += 2 + size;
        continue;
      }
      if (!(escape in map)) fail("bad escape");
      out += map[escape];
      i += 2;
    }
    if (text[i] !== quote) fail("unterminated string");
    i++;
    return out;
  };
  const parseKey = (): string => {
    skipSpace();
    if (text[i] === '"' || text[i] === "'") return parseString();
    const start = i;
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
    if (start === i) fail("expected key");
    return text.slice(start, i);
  };
  const parseDottedKey = (): string[] => {
    const parts = [parseKey()];
    skipSpace();
    while (text[i] === ".") {
      i++;
      skipSpace();
      parts.push(parseKey());
      skipSpace();
    }
    return parts;
  };
  const parseValue = (): Json => {
    skipSpace();
    const c = text[i];
    if (c === '"' || c === "'") return parseString();
    if (c === "[") {
      i++;
      const items: Json[] = [];
      for (;;) {
        skipSpace(true);
        if (text[i] === "]") {
          i++;
          return items;
        }
        items.push(parseValue());
        skipSpace(true);
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("expected , or ]");
      }
    }
    if (c === "{") {
      i++;
      const object: Record<string, Json> = {};
      skipSpace();
      if (text[i] === "}") {
        i++;
        return object;
      }
      for (;;) {
        const path = parseDottedKey();
        skipSpace();
        if (text[i] !== "=") fail("expected =");
        i++;
        assign(object, path, parseValue());
        skipSpace();
        if (text[i] === ",") i++;
        else if (text[i] === "}") {
          i++;
          return object;
        } else fail("expected , or }");
      }
    }
    const match = /^[^\s,\]}#\n]+/.exec(text.slice(i));
    if (!match) return fail("expected value");
    const token = match[0];
    i += token.length;
    if (token === "true" || token === "false") return token === "true";
    const number = Number(token.replaceAll("_", ""));
    if (Number.isFinite(number)) return number;
    fail("unsupported value");
    return "";
  };
  const assign = (target: Record<string, Json>, path: string[], value: Json) => {
    let current = target;
    for (const part of path.slice(0, -1)) {
      const next = current[part] ?? (current[part] = {});
      if (typeof next !== "object" || Array.isArray(next)) fail(`key ${part} is not a table`);
      current = next as Record<string, Json>;
    }
    const last = path[path.length - 1];
    if (Object.prototype.hasOwnProperty.call(current, last)) fail(`duplicate key ${last}`);
    current[last] = value;
  };
  while (i < text.length) {
    skipSpace(true);
    if (i >= text.length) break;
    if (text[i] === "[") {
      const arrayTable = text[i + 1] === "[";
      i += arrayTable ? 2 : 1;
      const path = parseDottedKey();
      skipSpace();
      if (text[i] !== "]") fail("expected ]");
      i++;
      if (arrayTable) {
        if (text[i] !== "]") fail("expected ]]");
        i++;
      }
      table = root;
      for (const [index, part] of path.entries()) {
        if (arrayTable && index === path.length - 1) {
          const items = table[part] ?? (table[part] = []);
          if (!Array.isArray(items)) fail(`table ${part} conflicts`);
          const entry = {};
          (items as Json[]).push(entry);
          table = entry;
          continue;
        }
        const next = table[part] ?? (table[part] = {});
        const current = Array.isArray(next) ? next.at(-1) : next;
        if (!current || typeof current !== "object" || Array.isArray(current))
          fail(`table ${part} conflicts`);
        table = current as Record<string, Json>;
      }
    } else {
      const path = parseDottedKey();
      skipSpace();
      if (text[i] !== "=") fail("expected =");
      i++;
      assign(table, path, parseValue());
    }
    skipSpace();
    if (i < text.length && text[i] !== "\n") fail("expected end of line");
  }
  return root;
}
