import { t } from "../../../shared/i18n";
import { TimeoutError } from "../../../shared/lib/withTimeout";

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
const OUTDATED =
  /Unsupported (host method|remote operation|workspace command)|Update bycoda Host in (?:Connections|Machines) settings/i;
const UNSUPPORTED = /isn.t available for projects on another machine/i;
/**
 * HTTP failures from `remote.rs`: the deadline passed or the answer was not a host's. A read
 * whose owner moved while it ran (`SessionReadError("source-changed")`) answers on the next read.
 */
const TEMPORARY =
  /\[RPC_TIMEOUT\]|\[RPC_PROTOCOL\]|^Invalid host response$|Host read capacity is busy|Host pending (read request|control queue) limit reached|Session read owner changed; retry/;

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
  return remoteErrorText(error).match(/^(?:Error: )?(RPC_WS_[A-Z_]+):/)?.[1];
}

/** Sorts a rejected remote request into what the user can do about it. The
 * original text is kept as the message, minus the host's own prefix. */
export function classifyRemoteError(error: unknown): RemoteFailure {
  const text = remoteErrorText(error);
  const message = text.replace(/^Host rejected request:\s*/i, "").trim() || text;
  const code = nativeConnectionFailureCode(error);
  if (code === "RPC_WS_IDENTITY") return { kind: "identity", message };
  if (code === "RPC_WS_UNSUPPORTED") return { kind: "outdated", message };
  // CANCELLED never reached the Host (its window or issuer was replaced mid-reconnect).
  if (
    code &&
    ["RPC_WS_DEADLINE", "RPC_WS_OVERLOAD", "RPC_WS_DETACHED", "RPC_WS_CANCELLED"].includes(code)
  )
    return { kind: "temporary", message };
  // A local bounded wait (e.g. Host discovery) elapsed; the same request can be sent again.
  if (error instanceof TimeoutError) return { kind: "temporary", message };
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
  // A Host rejection proves transport worked. Its operation may mention SSH or
  // another service being unreachable; that is not this machine's connection.
  if (/^Host rejected request:/i.test(text)) {
    if (OUTDATED.test(text)) return { kind: "outdated", message };
    if (TEMPORARY.test(text)) return { kind: "temporary", message };
    return { kind: "other", message };
  }
  if (SUPERSEDED.test(text) || LOCAL_TIMEOUT.test(text)) return { kind: "temporary", message };
  if (UNREACHABLE.test(text)) return { kind: "unreachable", message };
  if (OUTDATED.test(text)) return { kind: "outdated", message };
  if (UNSUPPORTED.test(text)) return { kind: "unsupported", message };
  if (TEMPORARY.test(text)) return { kind: "temporary", message };
  return { kind: "other", message };
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
export function presentRemoteError(error: unknown, options: { explicit: true }): string;
export function presentRemoteError(
  error: unknown,
  options?: { explicit?: boolean },
): string | undefined;
export function presentRemoteError(
  error: unknown,
  options: { explicit?: boolean } = {},
): string | undefined {
  if (!isTransientTransportError(error))
    // An error with no text still needs a visible message.
    return (
      localizeRemoteMessage(classifyRemoteError(error).message) ||
      t("Something went wrong. Try again.")
    );
  if (!options.explicit) return undefined;
  if (SUPERSEDED.test(remoteErrorText(error)))
    return t(
      "The connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.",
    );
  // An action is never replayed on its own, since it could apply twice: tell the
  // user to repeat it once the link is back instead of showing transport text.
  return classifyRemoteError(error).kind === "unreachable"
    ? t("Waiting for the connection to this computer. Try again once it is back.")
    : t("This computer is busy right now. Try again in a moment.");
}

/** How long to wait before asking an unreachable machine again, given how
 * many requests in a row have failed. Each ask can cost an SSH attempt. */
export function unreachablePollDelay(failures: number): number {
  return failures <= 1 ? 15_000 : 30_000;
}
