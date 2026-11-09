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

const REDACTIONS: readonly [RegExp, string][] = [
  // Authorization headers and bearer tokens.
  [/\b(authorization\s*[:=]\s*)(?:bearer|basic|token)?\s*[^\s"',;]+/gi, "$1<redacted>"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>"],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>"],
  // Well-known API key and token shapes.
  [
    /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
    "<secret>",
  ],
  // key=value / "key": "value" with a secret-looking key.
  [
    /\b((?:[A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|apikey|cookie|session[_-]?id|private[_-]?key|client[_-]?secret|signature|sig))["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
    "$1<redacted>",
  ],
  // Query parameters that usually carry credentials.
  [
    /([?&](?:code|token|key|sig|signature|access_token|refresh_token|auth)=)[^&\s"']+/gi,
    "$1<redacted>",
  ],
  // URLs with inline credentials.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1<redacted>@"],
  // Private key blocks.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<private-key>"],
  // E-mail addresses.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
  // User names inside common home-directory shapes.
  [/\b([A-Za-z]:[\\/]+Users[\\/]+)(?!<user>)[^\\/\s"':]+/gi, "$1<user>"],
  [/(\/(?:Users|home)\/)(?!<user>)[^/\s"':]+/g, "$1<user>"],
];

/**
 * Best-effort redaction of secrets and personal data from log text. Clients run it before
 * upload and the server runs it again before storage, so it must be idempotent.
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
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  return result;
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
  const usable = sections
    .filter((section) => DiagnosticSourceName.safeParse(section.name).success)
    .map((section) => ({ ...section, text: redactDiagnosticText(section.text, options).trimEnd() }))
    .filter((section) => section.text.length > 0)
    .slice(0, DIAGNOSTIC_MAX_SOURCES);
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
