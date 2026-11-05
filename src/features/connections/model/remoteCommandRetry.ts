import { nativeConnectionFailureCode, remoteErrorText } from "./remoteFailure";

/**
 * What a failed remote command tells about the Host.
 *
 * - `definitive`: the Host looked at the request and refused it (or its id is too old).
 *   Nothing ran, and sending the same command again will not change that.
 * - `not-sent`: the request never reached the Host (no connection, overload, deadline
 *   before the socket write, a blocked lane). Sending it again is safe.
 * - `uncertain`: the request may have reached the Host. Only its command receipt can say
 *   whether it ran, so it is checked before the same command is sent again.
 */
export type CommandFailureClass = "definitive" | "not-sent" | "uncertain";

/** Codes the Host or the native lane produce for a request it refused before running it. */
const DEFINITIVE_CODES = new Set([
  "RPC_WS_VALIDATION",
  "RPC_WS_IDENTITY",
  "RPC_WS_UNSUPPORTED",
  "RPC_WS_RESOURCE_RETIRED",
]);
/** The request never left this computer, or the lane refused it before dispatch. */
const NOT_SENT_CODES = new Set([
  "RPC_WS_DEADLINE",
  "RPC_WS_OVERLOAD",
  "RPC_WS_DETACHED",
  "RPC_WS_UNAVAILABLE",
  "RPC_WS_BLOCKED",
  "RPC_WS_SCHEMA",
  "RPC_WS_TLS",
]);
const DEFINITIVE_TEXT = /Host rejected request:|REQUEST_EXPIRED|older than 30 days/i;
const UNCERTAIN_TEXT = /outcome is unknown|RPC_CONNECTION_INTERRUPTED|RPC_WS_INTERRUPTED/;
const NOT_SENT_TEXT =
  /RPC_HOST_UNAVAILABLE|RPC_DNS|RPC_PROXY|Machine is unreachable|Machine is no longer connected|isn.t connected on this computer|not answering|SSH connection failed|SSH timed out|Could not start OpenSSH|Host is not running on the machine/i;

/** Sorts a failed command into definitive, not-sent or uncertain. Anything not
 * recognised is treated as uncertain, the only class that needs a receipt check. */
export function classifyCommandFailure(error: unknown): CommandFailureClass {
  const text = remoteErrorText(error);
  const code = nativeConnectionFailureCode(error);
  if (DEFINITIVE_TEXT.test(text) || (code !== undefined && DEFINITIVE_CODES.has(code)))
    return "definitive";
  // A native failure marks itself uncertain when the Host may have received it.
  if (
    (typeof error === "object" &&
      error !== null &&
      "uncertain" in error &&
      error.uncertain === true) ||
    UNCERTAIN_TEXT.test(text)
  )
    return "uncertain";
  if (code !== undefined && NOT_SENT_CODES.has(code)) return "not-sent";
  if (NOT_SENT_TEXT.test(text)) return "not-sent";
  return "uncertain";
}

/** The wait after the first failed check of one pending command. */
export const COMMAND_RETRY_FIRST_DELAY_MS = 2_000;
/** Waits never grow past this, however many checks have failed. */
export const COMMAND_RETRY_MAX_DELAY_MS = 30_000;

/** Failed checks, with the machine answering, before a pending command stops being
 * retried on its own. About ten minutes at the longest wait; the Retry button stays. */
export const COMMAND_RETRY_AUTOMATIC_LIMIT = 20;

/** The wait before the next attempt after `failures` failed attempts: none before
 * the first, then 2 s, doubling up to 30 s. */
export function commandRetryDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(
    COMMAND_RETRY_MAX_DELAY_MS,
    COMMAND_RETRY_FIRST_DELAY_MS * 2 ** Math.min(failures - 1, 30),
  );
}

export type CommandRetryBackoff = {
  /** Failed attempts since the last reset. */
  readonly failures: number;
  /** Milliseconds until the next attempt is due; 0 when it is due now. */
  remainingMs(): number;
  /** Records a failed attempt and sets the wait before the next one. */
  failed(): void;
  /** Forgets earlier failures, for example once the Host has confirmed the command. */
  reset(): void;
};

/** Backoff for one pending command. `now` is injected so tests need no real time. */
export function createCommandRetryBackoff(now: () => number = Date.now): CommandRetryBackoff {
  let failures = 0;
  let nextAt = 0;
  return {
    get failures() {
      return failures;
    },
    remainingMs: () => Math.max(0, nextAt - now()),
    failed() {
      failures += 1;
      nextAt = now() + commandRetryDelay(failures);
    },
    reset() {
      failures = 0;
      nextAt = 0;
    },
  };
}
