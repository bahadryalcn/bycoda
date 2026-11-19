import { stripAnsi } from "../../../shared/lib/ansi";

/**
 * What a provider login CLI prints for the case where it cannot open a browser (a remote or
 * headless Host): the authorization link and, for device flows, a short one-time code. Only these
 * two extracted values ever leave this module; the raw CLI output is never stored, logged or shown.
 */
export type SignInInstructions = {
  readonly url?: string;
  readonly code?: string;
};

const MAX_LINE_LENGTH = 4096;
const MAX_URL_LENGTH = 2048;
const URL_PATTERN = /https:\/\/[^\s<>"'`]+/i;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
/** A link carrying one of these is a credential or a callback, never a sign-in instruction. */
const CREDENTIAL_PARAMETERS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "secret",
  "client_secret",
  "password",
  "api_key",
  "apikey",
  "key",
  "code",
]);

function safeSignInUrl(candidate: string): string | undefined {
  const text = candidate.replace(TRAILING_PUNCTUATION, "");
  if (!text || text.length > MAX_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  for (const name of url.searchParams.keys()) {
    if (CREDENTIAL_PARAMETERS.has(name.toLowerCase())) return undefined;
  }
  return url.href;
}

/** The sign-in link and device code one CLI output line carries, or null when it carries neither. */
export function parseSignInInstructionLine(line: string): SignInInstructions | null {
  if (line.length > MAX_LINE_LENGTH) return null;
  const text = stripAnsi(line).trim();
  if (!text) return null;
  const urlMatch = URL_PATTERN.exec(text);
  const url = urlMatch ? safeSignInUrl(urlMatch[0]) : undefined;
  // The code must be announced as one ("Enter the code: ABCD-EFGH") or stand alone on its line, so
  // a hyphenated identifier inside a log line is not mistaken for it.
  const rest = urlMatch ? text.replace(urlMatch[0], " ") : text;
  const codeMatch = DEVICE_CODE_PATTERN.exec(rest);
  const code =
    codeMatch && (rest.trim() === codeMatch[0] || /\bcode\b/i.test(rest))
      ? codeMatch[0]
      : undefined;
  if (!url && !code) return null;
  return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}

const current = new Map<string, SignInInstructions>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/** One key per provider account; the default account is the same with or without an id. */
export function signInInstructionsKey(harness: string, accountId?: string): string {
  return `${harness}:${accountId || "default"}`;
}

/** Offer a CLI output line. The first link and the first code of a run are kept. */
export function offerSignInInstructionLine(key: string, line: string): void {
  const found = parseSignInInstructionLine(line);
  if (!found) return;
  const existing = current.get(key);
  const url = existing?.url ?? found.url;
  const code = existing?.code ?? found.code;
  if (url === existing?.url && code === existing?.code) return;
  current.set(key, { ...(url ? { url } : {}), ...(code ? { code } : {}) });
  notify();
}

export function clearSignInInstructions(key: string): void {
  if (current.delete(key)) notify();
}

export function getSignInInstructions(key: string): SignInInstructions | undefined {
  return current.get(key);
}

export function subscribeSignInInstructions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
