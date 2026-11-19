/**
 * Added in 0.9.0. Diagnostic log reports: with the user's consent a client uploads its own
 * application logs, redacted on the device, after a crash, together with feedback, on request
 * or periodically. Logs never contain conversation content on purpose, but they can contain
 * technical details (file names, command names, error text), which is why every upload needs a
 * consent the user can see and change, and why the redaction below runs on the client and again
 * on the server.
 */
import { z } from "zod";
import { EntityId, IsoDateTime } from "./common.ts";
import { FeedbackContext } from "./models.ts";

export const DIAGNOSTIC_TRIGGERS = ["crash", "feedback", "manual", "periodic"] as const;
export const DiagnosticTrigger = z.enum(DIAGNOSTIC_TRIGGERS);
export type DiagnosticTrigger = z.infer<typeof DiagnosticTrigger>;

/** Server keeps reports this many days, then deletes them. Clients show it in consent copy. */
export const DIAGNOSTIC_RETENTION_DAYS = 90;
/** Minimum days between two `periodic` uploads from one installation. */
export const DIAGNOSTIC_PERIODIC_INTERVAL_DAYS = 7;
/** Maximum characters of composed log text a client uploads (before compression). */
export const DIAGNOSTIC_TEXT_MAX_CHARS = 1_000_000;
/** Maximum base64 characters of a gzip upload (about 1 MB of compressed data). */
export const DIAGNOSTIC_GZIP_MAX_BASE64 = 1_400_000;
/** Maximum decompressed bytes the server accepts from a gzip upload. */
export const DIAGNOSTIC_MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024;

/** Maximum log sources in one report. */
export const DIAGNOSTIC_MAX_SOURCES = 16;

/** Machine-readable name of one log source, e.g. `host`, `host-previous`, `native`, `ui`, `mobile`. */
export const DiagnosticSourceName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const DiagnosticSource = z.strictObject({
  name: DiagnosticSourceName,
  /** Lines of this source included in the upload. */
  lines: z.number().int().min(0).max(10_000_000),
  /** True when older lines were dropped to stay under the size limit. */
  truncated: z.boolean(),
});
export type DiagnosticSource = z.infer<typeof DiagnosticSource>;

/**
 * Composed log text, always gzip-compressed and base64-encoded. The server rejects anything that
 * is not valid gzip of UTF-8 text, strips terminal control sequences and re-compresses it.
 */
export const DiagnosticLogContent = z.strictObject({
  encoding: z.literal("gzip-base64"),
  data: z.base64().min(1).max(DIAGNOSTIC_GZIP_MAX_BASE64),
});
export type DiagnosticLogContent = z.infer<typeof DiagnosticLogContent>;

/** Request body for `POST /v1/diagnostics/reports` and its anonymous twin. */
export const DiagnosticReportCreate = z.strictObject({
  trigger: DiagnosticTrigger,
  /** When the crash happened or the report was assembled. */
  occurredAt: IsoDateTime,
  context: FeedbackContext,
  /** The feedback this report belongs to (trigger `feedback`). */
  feedbackId: EntityId.optional(),
  /** One redacted line, e.g. the crash message. */
  summary: z.string().trim().min(1).max(500).optional(),
  /** What the user typed about the problem, if anything. */
  note: z.string().trim().min(1).max(2000).optional(),
  sources: z.array(DiagnosticSource).min(1).max(DIAGNOSTIC_MAX_SOURCES),
  content: DiagnosticLogContent,
});
export type DiagnosticReportCreate = z.infer<typeof DiagnosticReportCreate>;

export const DiagnosticReportReceipt = z.object({ id: EntityId, createdAt: IsoDateTime });
export type DiagnosticReportReceipt = z.infer<typeof DiagnosticReportReceipt>;

/** Options for {@link redactDiagnosticText}. */
export interface RedactOptions {
  /** Absolute home or user directories to replace with `~` (any slash style, any case). */
  homeDirs?: readonly string[];
  /** Exact values (for example the signed-in email) to replace with `<redacted>`. */
  values?: readonly string[];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest line {@link redactDiagnosticText} keeps; longer lines are cut so work stays bounded. */
const MAX_LINE_CHARS = 8192;
const LINE_TRUNCATED = " <line-truncated>";
const PRIVATE_KEY_PLACEHOLDER = "<private-key>";

// Every pattern below starts at a boundary character group instead of an unanchored run of
// word characters, and uses bounded whitespace, so a long run without a match is scanned once
// per start instead of once per character (no quadratic backtracking).
const SECRET_KEY_WORDS =
  "token|secret|password|passwd|api[_-]?key|apikey|cookie|session[_-]?id|private[_-]?key|client[_-]?secret|signature|sig|authorization";
const SECRET_KEY_HEAD = String.raw`(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]*(?:${SECRET_KEY_WORDS})(?:\\?["'])?\s{0,20}[:=]\s{0,20}`;
// `key: "multi word value"`, `"key": "a b"` and the JSON-escaped `\"key\": \"a b\"`. The value
// runs to its closing quote, or to the end of the line when the quote is missing (a cut line).
const QUOTED_SECRET_PATTERN = new RegExp(
  String.raw`${SECRET_KEY_HEAD}(\\?["']))((?:(?!\3)(?:\\[^\r\n]|[^\\\r\n]))+)\\?(\3|(?=[\r\n]|$))`,
  "gi",
);
const UNQUOTED_SECRET_PATTERN = new RegExp(
  // A backslash that opens a JSON-escaped quote (`\"`) ends the value, so it stays in the text.
  String.raw`${SECRET_KEY_HEAD}(?:\\?["'])?)(?:[^\s"',;&}\\]|\\(?!["']))+`,
  "gi",
);

const REDACTIONS: readonly [RegExp, string | ((substring: string, ...args: string[]) => string)][] =
  [
    // Authorization headers and bearer tokens.
    [
      /(^|[^A-Za-z0-9_])(authorization\s{0,20}[:=]\s{0,20})(?:(?:bearer|basic|token)\s{0,20})?[^\s"',;]+/gi,
      "$1$2<redacted>",
    ],
    [/\bbearer\s{1,20}[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>"],
    // JSON Web Tokens.
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>"],
    // Well-known API key and token shapes.
    [
      /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
      "<secret>",
    ],
    // key=value / "key": "value" with a secret-looking key.
    [
      QUOTED_SECRET_PATTERN,
      (_all, boundary, head, _quote, _body, close) => `${boundary}${head}<redacted>${close}`,
    ],
    [UNQUOTED_SECRET_PATTERN, "$1$2<redacted>"],
    // Query parameters that usually carry credentials.
    [
      /([?&](?:code|token|key|sig|signature|access_token|refresh_token|auth)=)[^&\s"']+/gi,
      "$1<redacted>",
    ],
    // URLs with inline credentials.
    [/(^|[^A-Za-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1$2<redacted>@"],
    // E-mail addresses.
    [/(^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "$1<email>"],
    // User names inside common home-directory shapes.
    [/\b([A-Za-z]:[\\/]+Users[\\/]+)(?!<user>)[^\\/\s"':]+/gi, "$1<user>"],
    [/(\/(?:Users|home)\/)(?!<user>)[^/\s"':]+/g, "$1<user>"],
  ];

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const KEY_BODY_TEXT = /^(?:[A-Za-z0-9+/=]*|(?:Proc-Type|DEK-Info):.*)$/;
const KEY_BODY_TEXT_STRICT = /^(?:[A-Za-z0-9+/=]{16,}|(?:Proc-Type|DEK-Info):.*)$/;

/**
 * A line that can sit inside a PEM body: base64 text or a legacy encryption header (a blank
 * line too, unless `strict`). Strict is for lines before an orphan END marker, so ordinary
 * short lines stay. Trimmed first so long whitespace runs never backtrack.
 */
function isKeyBodyLine(line: string, strict = false): boolean {
  return (strict ? KEY_BODY_TEXT_STRICT : KEY_BODY_TEXT).test(line.trim());
}

function findFrom(pattern: RegExp, text: string, from: number): RegExpExecArray | null {
  pattern.lastIndex = from;
  return pattern.exec(text);
}

/** Start of the trailing run of key-body characters (base64 and JSON-escaped newlines). */
function keyRunStart(text: string): number {
  let index = text.length;
  while (index > 0 && /[A-Za-z0-9+/=\\]/.test(text[index - 1]!)) index -= 1;
  return index;
}

/**
 * Replaces private key blocks with a placeholder. Handles blocks whose END line is missing
 * (everything after BEGIN that still looks like key material) and blocks whose BEGIN line was
 * cut off by log tailing (an END marker without BEGIN replaces the base64 lines before it).
 */
function redactPrivateKeyBlocks(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inKey = false;
  for (const line of lines) {
    let pos = 0;
    if (inKey) {
      const close = findFrom(PRIVATE_KEY_END, line, 0);
      if (close) {
        inKey = false;
        pos = close.index + close[0].length;
        if (line.slice(pos).trim() === "") continue;
      } else if (isKeyBodyLine(line)) {
        continue;
      } else {
        inKey = false;
      }
    }
    let result = "";
    let begin = findFrom(PRIVATE_KEY_BEGIN, line, pos);
    let end = findFrom(PRIVATE_KEY_END, line, pos);
    while (begin || end) {
      if (begin && (!end || begin.index < end.index)) {
        result += line.slice(pos, begin.index) + PRIVATE_KEY_PLACEHOLDER;
        if (!end) {
          inKey = true;
          pos = line.length;
          break;
        }
        pos = end.index + end[0].length;
      } else if (end) {
        const head = line.slice(pos, end.index);
        result += head.slice(0, keyRunStart(head));
        if (result.trim() === "") {
          // The key started on earlier lines that the log tail cut: drop their base64 body.
          // The line right before END may be a short last base64 line; earlier ones are full.
          let strict = false;
          while (out.length > 0 && out[out.length - 1]!.trim() !== "") {
            if (!isKeyBodyLine(out[out.length - 1]!, strict)) break;
            out.pop();
            strict = true;
          }
        }
        result += PRIVATE_KEY_PLACEHOLDER;
        pos = end.index + end[0].length;
      }
      if (begin && begin.index < pos) begin = findFrom(PRIVATE_KEY_BEGIN, line, pos);
      if (end && end.index < pos) end = findFrom(PRIVATE_KEY_END, line, pos);
    }
    out.push(result + line.slice(pos));
  }
  return out;
}

const isLineDelimiter = (char: string | undefined) =>
  char === undefined || /[\s"'`,;(){}[\]<>]/.test(char);

/** Cuts a too long line without leaving a half token (a secret fragment) at the cut. */
function capLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  let end = MAX_LINE_CHARS - LINE_TRUNCATED.length;
  if (!isLineDelimiter(line[end])) {
    while (end > 0 && !isLineDelimiter(line[end - 1])) end -= 1;
  }
  return `${line.slice(0, end)}${LINE_TRUNCATED}`;
}

/**
 * Best-effort redaction of secrets and personal data from log text. Clients run it before
 * upload and the server runs it again before storage, so it must be idempotent. Work is
 * linear in the text size: lines longer than {@link MAX_LINE_CHARS} are cut before the
 * patterns run, and the patterns avoid quadratic backtracking.
 */
export function redactDiagnosticText(text: string, options: RedactOptions = {}): string {
  let result = text;
  for (const value of options.values ?? []) {
    if (value.trim().length < 3) continue;
    result = result.replace(new RegExp(escapeRegExp(value), "gi"), "<redacted>");
  }
  const homes = [...(options.homeDirs ?? [])]
    .map((dir) => dir.replace(/[\\/]+$/, ""))
    .filter((dir) => dir.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const home of homes) {
    const pattern = home
      .split(/[\\/]+/)
      .map(escapeRegExp)
      .join("[\\\\/]+");
    result = result.replace(new RegExp(`${pattern}(?=$|[\\\\/\\s"':])`, "gi"), "~");
  }
  result = redactPrivateKeyBlocks(result.split("\n")).map(capLine).join("\n");
  for (const [pattern, replacement] of REDACTIONS) {
    result =
      typeof replacement === "string"
        ? result.replace(pattern, replacement)
        : result.replace(pattern, replacement);
  }
  return result;
}

/** Drops leading base64-only lines: the body of a private key whose BEGIN line was cut off. */
function dropLeadingKeyBody(text: string): string {
  let pos = 0;
  while (pos < text.length) {
    const newline = text.indexOf("\n", pos);
    const line = newline < 0 ? text.slice(pos) : text.slice(pos, newline);
    if (!isKeyBodyLine(line, true)) break;
    if (newline < 0) return "";
    pos = newline + 1;
  }
  return text.slice(pos);
}

/**
 * Newest whole lines of `text` within `limit` characters. A line the cut lands in is dropped
 * so the section never starts on a fragment.
 */
function tailLines(text: string, limit: number): { text: string; cut: boolean } {
  if (text.length <= limit) return { text, cut: false };
  let start = text.length - limit;
  if (text[start - 1] !== "\n") {
    const newline = text.indexOf("\n", start);
    start = newline < 0 ? text.length : newline + 1;
  }
  return { text: text.slice(start), cut: true };
}

/** One log source handed to {@link composeDiagnosticLog}, oldest line first. */
export interface DiagnosticSection {
  name: string;
  text: string;
  /** The caller already dropped older lines (for example it read only the file tail). */
  truncated?: boolean;
}

export interface ComposedDiagnosticLog {
  text: string;
  sources: DiagnosticSource[];
}

/**
 * Redacts each section, keeps the newest lines so the whole text fits `maxChars`, and joins
 * the sections under `===== <name> =====` headers. Empty sections are skipped; at most
 * {@link DIAGNOSTIC_MAX_SOURCES} sections are kept, in the given order.
 */
export function composeDiagnosticLog(
  sections: readonly DiagnosticSection[],
  options: RedactOptions & { maxChars?: number } = {},
): ComposedDiagnosticLog {
  const maxChars = Math.min(
    options.maxChars ?? DIAGNOSTIC_TEXT_MAX_CHARS,
    DIAGNOSTIC_TEXT_MAX_CHARS,
  );
  // Cut to the newest lines first and redact only that window, so a huge source costs no more
  // than a small one. The window is twice the budget because redaction shrinks the text.
  const usable: DiagnosticSection[] = [];
  for (const section of sections) {
    if (usable.length >= DIAGNOSTIC_MAX_SOURCES) break;
    if (!DiagnosticSourceName.safeParse(section.name).success) continue;
    const window = tailLines(section.text, maxChars * 2);
    // A section that starts mid-file may start inside a private key body.
    const raw =
      window.cut || section.truncated === true ? dropLeadingKeyBody(window.text) : window.text;
    const text = redactDiagnosticText(raw, options).trimEnd();
    if (text.length === 0) continue;
    usable.push({ name: section.name, text, truncated: window.cut || section.truncated === true });
  }
  const headerCost = (name: string) => name.length + 14;
  const budget = Math.max(
    0,
    maxChars - usable.reduce((sum, section) => sum + headerCost(section.name), 0),
  );
  // Give every section an equal share; unused share flows to the larger sections.
  const shares = new Map<number, number>();
  let remaining = budget;
  const pending = usable
    .map((_, index) => index)
    .sort((a, b) => usable[a]!.text.length - usable[b]!.text.length);
  while (pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const index = pending.shift()!;
    const take = Math.min(usable[index]!.text.length, share);
    shares.set(index, take);
    remaining -= take;
  }
  const parts: string[] = [];
  const sources: DiagnosticSource[] = [];
  for (const [index, section] of usable.entries()) {
    const keep = shares.get(index) ?? 0;
    let text = section.text;
    let truncated = section.truncated === true;
    if (text.length > keep) {
      text = text.slice(text.length - keep);
      const newline = text.indexOf("\n");
      text = newline >= 0 ? text.slice(newline + 1) : "";
      truncated = true;
    }
    if (text.length === 0) continue;
    parts.push(`===== ${section.name} =====\n${text}`);
    sources.push({ name: section.name, lines: text.split("\n").length, truncated });
  }
  return { text: parts.join("\n"), sources };
}

/**
 * Shared log line format for every bycoda process (desktop native, Host, desktop UI, mobile):
 * `<ISO-8601 UTC> <LEVEL padded to 5> [<category>] <message>[ key=value ...]`, one event per
 * line. Continuation lines of a multi-line message (stack traces) are indented by two spaces.
 */
export const DIAGNOSTIC_LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type DiagnosticLogLevel = (typeof DIAGNOSTIC_LOG_LEVELS)[number];
export type DiagnosticLogFields = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/;
const FIELD_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/;

function formatFieldValue(value: string | number | boolean | null): string {
  const text = String(value);
  return /^[^\s"=]{1,200}$/.test(text) ? text : JSON.stringify(text.slice(0, 2000));
}

/** Formats one log event in the shared line format. Invalid categories become `app`. */
export function formatDiagnosticLine(
  at: Date,
  level: DiagnosticLogLevel,
  category: string,
  message: string,
  fields: DiagnosticLogFields = {},
): string {
  const safeCategory = CATEGORY_PATTERN.test(category) ? category : "app";
  const pairs = Object.entries(fields)
    .filter(([key, value]) => value !== undefined && FIELD_KEY_PATTERN.test(key))
    .map(([key, value]) => `${key}=${formatFieldValue(value as string | number | boolean | null)}`);
  const body = message.replace(/\r\n?/g, "\n").trimEnd().split("\n").join("\n  ");
  const time = Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString();
  const suffix = pairs.length ? ` ${pairs.join(" ")}` : "";
  return `${time} ${level.toUpperCase().padEnd(5)} [${safeCategory}] ${body}${suffix}`;
}

export interface ParsedDiagnosticLine {
  at: string;
  level: DiagnosticLogLevel;
  category: string;
  /** Message and fields as written (the rest of the line). */
  text: string;
}

const LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (DEBUG|INFO|WARN|ERROR|FATAL) +\[([^\]]{1,48})\] ?(.*)$/;

/** Parses a line in the shared format; null for continuation lines, headers and foreign text. */
export function parseDiagnosticLine(line: string): ParsedDiagnosticLine | null {
  const match = LINE_PATTERN.exec(line);
  if (!match) return null;
  return {
    at: match[1]!,
    level: match[2]!.toLowerCase() as DiagnosticLogLevel,
    category: match[3]!,
    text: match[4]!,
  };
}

export interface DiagnosticLevelCounts {
  warn: number;
  /** `error` and `fatal` lines. */
  error: number;
}

/** Counts warning and error lines of composed log text in the shared format. */
export function countDiagnosticLevels(text: string): DiagnosticLevelCounts {
  const counts = { warn: 0, error: 0 };
  for (const line of text.split("\n")) {
    const level = parseDiagnosticLine(line)?.level;
    if (level === "warn") counts.warn += 1;
    else if (level === "error" || level === "fatal") counts.error += 1;
  }
  return counts;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Stable grouping key for "the same problem": the trigger plus the summary with volatile parts
 * (URLs, UUIDs, paths, quoted text, hex ids, numbers) replaced. Null without a summary.
 */
export function diagnosticFingerprint(
  trigger: DiagnosticTrigger,
  summary: string | null | undefined,
): string | null {
  if (!summary?.trim()) return null;
  const normalized = summary
    .toLowerCase()
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/(?:[a-z]:)?(?:[\\/][^\\/\s:"']+){2,}/g, "<path>")
    .replace(/(["'`])[^"'`]*\1/g, "<str>")
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return `${fnv1a(`${trigger}|${normalized}`, 0x811c9dc5)}${fnv1a(`${normalized}|${trigger}`, 0x01000193)}`;
}
