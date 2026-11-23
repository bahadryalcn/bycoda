import { t } from "../../../shared/i18n/core";
import { TimeoutError } from "../../../shared/lib/withTimeout";
import { actionableUnreachableReason, sanitizeConnectionError } from "./connectionReason";

/** Why a request to a connected machine failed, as far as the user can act on it. */
export type RemoteFailureKind =
  /** The machine or its SSH tunnel is down, or this computer is not connected to it. */
  | "unreachable"
  /** The saved host identity was refused; the owner must pair this machine again. */
  | "identity"
  /** The host is too old to know this command. */
  | "outdated"
  /** This app does not offer the command for projects on another machine. */
  | "unsupported"
  /** The machine is busy or a request timed out; the same request can be sent again. */
  | "temporary"
  /** The owner turned this machine off here: native admission refused the request locally, so
   * nothing was sent. It is no answer and no outage; it says nothing about the machine. */
  | "disabled"
  /** The machine answered with an error of its own (a git failure, a bad path). */
  | "other";

export type RemoteFailure = { kind: RemoteFailureKind; message: string };

/** Messages from `remote.rs`, `remote_ssh.rs`, `remoteCommands.ts` and the host. */
const UNREACHABLE =
  /RPC_HOST_UNAVAILABLE|RPC_CONNECTION_INTERRUPTED|RPC_DNS|RPC_PROXY|Machine is unreachable|Host is not running on the machine|SSH connection failed|SSH timed out|Could not start OpenSSH|Machine is no longer connected|machine isn.t connected on this computer|Connect this project.s machine|Connection ?(reset|aborted)|ConnectionReset|ConnectionAborted|ConnectionRefused|TimedOut|forcibly closed|os error 10(053|054|060)|Broken pipe/i;
/** A request whose connection was replaced mid-flight: not an outage, its outcome is unknown. */
const SUPERSEDED = /Connection changed while the request was running/;
/** `TimeoutError` after it was turned into text (`String(error)`). */
const LOCAL_TIMEOUT = /TimeoutError: .*timed out after \d+ ?ms/i;
/** `account_routes.rs` refused the request because the machine is switched off on this computer. */
const MACHINE_DISABLED = /^(?:Error: )?(?:RPC_WS_DISABLED:\s*)?Machine connection is disabled\.?$/;
const OUTDATED =
  /Unsupported (host method|remote operation|workspace command)|Update bycoda Host in (?:Connections|Machines) settings/i;
const UNSUPPORTED = /isn.t available for projects on another machine/i;
/**
 * HTTP failures from `remote.rs`: the deadline passed or the answer was not a host's. A read
 * whose owner moved while it ran (`SessionReadError("source-changed")`) answers on the next read.
 */
const TEMPORARY =
  /\[RPC_TIMEOUT\]|\[RPC_PROTOCOL\]|^Invalid host response$|Host read capacity is busy|Host pending (read request|control queue) limit reached|Session read owner changed; retry/;
const HOST_RESTART_CODE = /^(?:HOST_STOPPING|HOST_DB_CLOSING)$/;
const HOST_RESTART_TEXT = /^(?:Host is stopping|Host database is (?:closing|closed))\.?$/i;
const TRANSIENT_CODE =
  /^(?:ABORT_ERR|REQUEST_CANCELLED|RPC_CANCELLED|HOST_RPC_DEADLINE|RPC_TIMEOUT|RPC_PROTOCOL|RPC_WS_(?:DEADLINE|OVERLOAD|DETACHED|CANCELLED|RETRYABLE))$/;
const TRANSIENT_TEXT =
  /^(?:Request cancell?ed|AbortError(?::.*)?|Host did not answer .+ within \d+ s)\.?$/i;
const PERMANENT_CODE =
  /^(?:EACCES|EPERM|ENOENT|FILE_CHANGED|FORBIDDEN|NOT_FOUND|INVALID_(?:INPUT|PARAMS|ARGUMENT)|RPC_(?:AUTHORIZATION|VALIDATION|NOT_FOUND)|RPC_WS_(?:VALIDATION|RESOURCE_RETIRED))$/;
const PERMANENT_TEXT =
  /^(?:permission denied|access denied|unauthori[sz]ed|forbidden|invalid (?:input|argument|params?|request)|validation failed|(?:[\w -]+ )?not found|no such file)(?:\b|$)/i;

export function remoteErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return String(error);
}

/** Whether the Host refused this computer's credential (`Host rejected request [RPC_AUTHORIZATION]`). */
export function isHostAuthorizationRefusal(error: unknown): boolean {
  return /\[RPC_AUTHORIZATION\]/.test(remoteErrorText(error));
}

/** Native failures retain a code; persisted view errors may retain only its prefix. */
export function nativeConnectionFailureCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^RPC_WS_[A-Z_]+$/.test(code)) return code;
  const message = remoteErrorText(error).replace(
    /^(?:Error: )?(?:Host rejected request:\s*)?/i,
    "",
  );
  return message
    .match(/^(?:\[(RPC_WS_[A-Z_]+)\]|(RPC_WS_[A-Z_]+):)/)
    ?.slice(1)
    .find(Boolean);
}

function failureCode(error: unknown, message: string): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string"
    ? code
    : (message
        .match(/^(?:\[([A-Z][A-Z_]+)\]|([A-Z][A-Z_]+):)/)
        ?.slice(1)
        .find(Boolean) ?? "");
}

export function isHostRestartFailure(error: unknown): boolean {
  const message = remoteErrorText(error).replace(
    /^(?:Error: )?(?:Host rejected request:\s*)?/i,
    "",
  );
  return (
    HOST_RESTART_CODE.test(failureCode(error, message)) ||
    HOST_RESTART_TEXT.test(message.replace(/^RPC_WS_INTERRUPTED:\s*/, ""))
  );
}

/** Sorts a rejected remote request into what the user can do about it. The
 * original text is kept as the message, minus the host's own prefix. */
export function classifyRemoteError(error: unknown): RemoteFailure {
  const text = remoteErrorText(error);
  // Checkpoint review errors carry a typed marker for programs; people never need to read it.
  const message =
    text
      .replace(/^(?:Error: )?(?:Host rejected request:\s*)?/i, "")
      .replace(/\s*\[CHECKPOINT_(?:RECORDING|FAILED)\]/g, "")
      .trim() || text;
  const code = nativeConnectionFailureCode(error);
  if (code === "RPC_WS_DISABLED" || MACHINE_DISABLED.test(text.trim()))
    return { kind: "disabled", message };
  if (code === "RPC_WS_IDENTITY") return { kind: "identity", message };
  if (code === "RPC_WS_UNSUPPORTED") return { kind: "outdated", message };
  if (
    code &&
    [
      "RPC_WS_BLOCKED",
      "RPC_WS_SCHEMA",
      "RPC_WS_TLS",
      "RPC_WS_UNAVAILABLE",
      "RPC_WS_INTERRUPTED",
    ].includes(code)
  )
    return { kind: "unreachable", message };
  // A 401 from the Host means its device row for this computer is gone: only pairing again helps.
  if (
    /Host identity changed\. Add this machine again before continuing\.|\[RPC_AUTHORIZATION\]/i.test(
      text,
    )
  )
    return { kind: "identity", message };
  if (OUTDATED.test(text)) return { kind: "outdated", message };
  if (UNSUPPORTED.test(text)) return { kind: "unsupported", message };
  const operationCode = failureCode(error, message);
  const operationText = message.replace(
    /^(?:(?:RPC_WS_REMOTE|ETIMEDOUT):\s*|\[RPC_WS_RETRYABLE\]\s*)/,
    "",
  );
  if (PERMANENT_CODE.test(operationCode) || PERMANENT_TEXT.test(operationText))
    return { kind: "other", message };
  if (/^RPC_(?:HOST_UNAVAILABLE|CONNECTION_INTERRUPTED|DNS|PROXY)$/.test(operationCode))
    return { kind: "unreachable", message };
  if (
    isHostRestartFailure(error) ||
    isGitStartTimeout(error) ||
    TRANSIENT_CODE.test(operationCode) ||
    TRANSIENT_TEXT.test(operationText) ||
    error instanceof TimeoutError ||
    (error !== null &&
      typeof error === "object" &&
      (("name" in error && error.name === "AbortError") ||
        ("retryable" in error && error.retryable === true)))
  )
    return { kind: "temporary", message };
  // A Host rejection proves transport worked. Its operation may mention SSH or
  // another service being unreachable; that is not this machine's connection.
  if (/^(?:Error: )?Host rejected request:/i.test(text)) {
    if (TEMPORARY.test(operationText)) return { kind: "temporary", message };
    return { kind: "other", message };
  }
  if (SUPERSEDED.test(text) || LOCAL_TIMEOUT.test(text)) return { kind: "temporary", message };
  // The native SSH slot has a dial in progress; no remote operation or failed dial occurred.
  if (message === "Machine is unreachable right now: a connection attempt is in progress.")
    return { kind: "temporary", message };
  if (UNREACHABLE.test(text)) return { kind: "unreachable", message };
  if (TEMPORARY.test(text)) return { kind: "temporary", message };
  return { kind: "other", message };
}

/** The queue's deadline expired before a Git child process could run. */
export function isGitStartTimeout(error: unknown): boolean {
  const message = remoteErrorText(error).replace(
    /^(?:Error: )?(?:Host rejected request:\s*)?/i,
    "",
  );
  return (
    failureCode(error, message) === "GIT_START_TIMEOUT" ||
    /^(?:(?:RPC_WS_REMOTE|ETIMEDOUT):\s*)?Command timed out before launch\.?$/i.test(message)
  );
}

/** A request ended because its deadline passed, as opposed to a busy or replaced
 * connection. One proves nothing; a run of them with no answer in between means
 * the machine is not answering at all. */
export function isTimeoutFailure(error: unknown): boolean {
  if (classifyRemoteError(error).kind !== "temporary") return false;
  return (
    error instanceof TimeoutError ||
    nativeConnectionFailureCode(error) === "RPC_WS_DEADLINE" ||
    /\[RPC_TIMEOUT\]/.test(remoteErrorText(error)) ||
    LOCAL_TIMEOUT.test(remoteErrorText(error))
  );
}

/** The fixed messages thrown in English (they are matched above) shown in the user's language. */
function localizeRemoteMessage(message: string): string {
  const text = message.replace(/^Host rejected request:\s*/i, "");
  const known: Record<string, string> = {
    "Update bycoda Host in Machines settings to use this on projects on another machine.": t(
      "Update bycoda Host in Machines settings to use this on projects on another machine.",
    ),
    "Update bycoda Host in Machines settings to use this project’s files.": t(
      "Update bycoda Host in Machines settings to use this project’s files.",
    ),
    "Update bycoda Host in Machines settings to browse folders outside projects.": t(
      "Update bycoda Host in Machines settings to browse folders outside projects.",
    ),
    "The other machine’s bycoda Host needs updating to copy skills. Update it in Machines settings.":
      t(
        "The other machine’s bycoda Host needs updating to copy skills. Update it in Machines settings.",
      ),
    "The other machine’s bycoda Host needs updating to delete skills. Update it in Machines settings.":
      t(
        "The other machine’s bycoda Host needs updating to delete skills. Update it in Machines settings.",
      ),
    "Update bycoda Host in Machines settings before controlling this desktop turn.": t(
      "Update bycoda Host in Machines settings before controlling this desktop turn.",
    ),
    "This isn’t available for projects on another machine yet.": t(
      "This isn’t available for projects on another machine yet.",
    ),
  };
  return known[text] ?? message;
}

/** The machine itself cannot be asked right now, as opposed to one command failing. */
export const isConnectionFailure = (failure: RemoteFailure) =>
  failure.kind === "unreachable" || failure.kind === "outdated" || failure.kind === "identity";

/** The request cannot succeed by being sent again: the Host is too old to know the command, or this
 * app does not offer it for another machine. Retry buttons stay hidden for these. */
export function isUnsupportedRemoteRoute(error: unknown): boolean {
  const kind = classifyRemoteError(error).kind;
  return kind === "outdated" || kind === "unsupported";
}

/** Codes of native failures the owner must act on; never treated as a passing outage. */
const HARD_WS_CODES = ["RPC_WS_BLOCKED", "RPC_WS_SCHEMA", "RPC_WS_TLS"];

/**
 * A request failed only because the link to the machine dropped or the machine
 * was busy. These usually clear within seconds, so the shared connection notice
 * (shown after a short grace period) covers them and screens stay quiet.
 */
export function isTransientTransportError(error: unknown): boolean {
  const failure = classifyRemoteError(error);
  if (failure.kind === "temporary") return true;
  if (failure.kind !== "unreachable") return false;
  const code = nativeConnectionFailureCode(error);
  return !(code && HARD_WS_CODES.includes(code));
}

/**
 * What a screen should show for a failed request: nothing (`undefined`) for a
 * transient transport error, otherwise the classified, human message. An
 * explicit user action passes `{ explicit: true }` to always get a message.
 */
export function presentRemoteError(
  error: unknown,
  options: { explicit: true } | { graceExpired: true },
): string;
export function presentRemoteError(
  error: unknown,
  options?: { explicit?: boolean; graceExpired?: boolean },
): string | undefined;
export function presentRemoteError(
  error: unknown,
  options: { explicit?: boolean; graceExpired?: boolean } = {},
): string | undefined {
  if (classifyRemoteError(error).kind === "disabled")
    return t("This machine is turned off. Turn it on in Machines settings.");
  if (!isTransientTransportError(error))
    // An error with no text still needs a visible message.
    return (
      localizeRemoteMessage(classifyRemoteError(error).message) ||
      t("Something went wrong. Try again.")
    );
  if (!options.explicit && !options.graceExpired) return undefined;
  if (SUPERSEDED.test(remoteErrorText(error)))
    return t(
      "The connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.",
    );
  if (classifyRemoteError(error).kind !== "unreachable")
    return t("This computer is busy right now. Try again in a moment.");
  // A cause the user can fix (address, proxy, stopped Host, SSH sign-in) is named, since
  // waiting never clears it. Only a plain outage gets the wait advice; an action is never
  // replayed on its own, as it could apply twice.
  return (
    actionableUnreachableReason(remoteErrorText(error)) ??
    t("Waiting for the connection to this computer. Try again once it is back.")
  );
}

/** A failed request as a screen shows it: the presented sentence and the raw text for Details. */
export type RemoteErrorView = { message: string; details: string };

/**
 * Presented message (always present, so an explicit action never fails silently) plus the raw
 * Host or transport text without the `Error:` and `Host rejected request:` prefixes. Show
 * `message`; keep `details` behind a Details disclosure and give it to the connection gate.
 */
export function describeRemoteError(error: unknown): RemoteErrorView {
  const failure = classifyRemoteError(error);
  return {
    message: presentRemoteError(error, { explicit: true }),
    // SSH and proxy failures can carry command lines or credentials: redact before display.
    details:
      failure.kind === "unreachable" ? sanitizeConnectionError(failure.message) : failure.message,
  };
}

/**
 * A local action's failure as the text a toast or inline notice shows: a translated `summary`
 * for the action, then the cause with the `Error:` prefix removed and secrets or command lines
 * redacted, so the user can still act on it. A machine that is off or cannot be reached gets its
 * fixed sentence instead of `summary`, and a turned-off machine shows no native text at all.
 */
export function describeLocalError(error: unknown, summary: string): string {
  const failure = classifyRemoteError(error);
  if (failure.kind === "disabled") return presentRemoteError(error, { explicit: true });
  const lead = actionableUnreachableReason(remoteErrorText(error)) ?? summary;
  const cause = sanitizeConnectionError(failure.message.replace(/^Error:\s*/, ""));
  return cause ? `${lead}\n\n${cause}` : lead;
}

/** How long to wait before asking an unreachable machine again, given how
 * many requests in a row have failed. Each ask can cost an SSH attempt. */
export function unreachablePollDelay(failures: number): number {
  return failures <= 1 ? 15_000 : 30_000;
}
