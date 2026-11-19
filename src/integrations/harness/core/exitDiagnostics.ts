import { stripAnsi } from "../../../shared/lib/ansi";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

/** Lines of a provider CLI's stderr kept to explain an exit nobody asked for. */
export const EXIT_STDERR_LINES = 3;
/** Longest stderr line kept, after redaction. */
export const EXIT_STDERR_LINE_MAX = 300;
/** Longest raw line looked at; a longer one is cut before any pattern runs on it. */
const EXIT_STDERR_RAW_MAX = 4096;

const SECRET_MASK = "…";

// Order matters: a scheme-prefixed header value is masked as one unit before the generic
// `name=value` rule could swallow only its scheme word.
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{6,}/gi, `$1 ${SECRET_MASK}`],
  [/(:\/\/)[^\s/@:]+:[^\s/@]+@/g, `$1${SECRET_MASK}@`],
  [
    /([?&](?:access_token|refresh_token|id_token|token|key|api_?key|secret|password|code)=)[^&\s]+/gi,
    `$1${SECRET_MASK}`,
  ],
  [
    /\b([\w-]*(?:token|secret|passw(?:or)?d|passphrase|api[_-]?key|authorization|credential)[\w-]*)(["']?\s*[=:]\s*)(?!(?:Bearer|Basic)\s|…)("[^"]*"|'[^']*'|[^\s,}]+)/gi,
    `$1$2${SECRET_MASK}`,
  ],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, SECRET_MASK],
  [/\b(?:sk|xai|pk|rk|ghp|gho|ghs|github_pat|glpat|AIza|AKIA)[-_A-Za-z0-9]{16,}/g, SECRET_MASK],
];

/**
 * One stderr line made safe to show: terminal control bytes (a Windows pseudo-terminal wraps
 * output in colors and ends lines with CRLF) are dropped and credentials are masked. Redaction
 * runs on the whole bounded line before it is shortened, so a cut can never leave half a secret.
 */
export function redactExitStderrLine(line: string): string {
  let text = stripAnsi(
    line.length > EXIT_STDERR_RAW_MAX ? line.slice(0, EXIT_STDERR_RAW_MAX) : line,
  );
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return truncateGraphemes(text.trim(), EXIT_STDERR_LINE_MAX);
}

/**
 * Keeps the last few non-empty stderr lines, redacted and bounded, in `tail`. A progress
 * rewrite (`\r`) counts as its own line, so it cannot grow one entry without limit.
 */
export function pushExitStderrTail(tail: string[], line: string): void {
  for (const part of stripAnsi(
    line.length > EXIT_STDERR_RAW_MAX ? line.slice(0, EXIT_STDERR_RAW_MAX) : line,
  ).split("\n")) {
    const text = redactExitStderrLine(part);
    if (text) tail.push(text);
  }
  if (tail.length > EXIT_STDERR_LINES) tail.splice(0, tail.length - EXIT_STDERR_LINES);
}

/** The error a turn in flight fails with when its provider process ends: label, code, last stderr. */
export function providerExitError(
  label: string,
  code: number | null | undefined,
  stderrTail: readonly string[],
): Error {
  const status = code == null ? "" : ` (exit code ${code})`;
  const detail = stderrTail.join("\n");
  return new Error(detail ? `${label} exited${status}:\n${detail}` : `${label} exited${status}.`);
}
