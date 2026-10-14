import { classifyRemoteError, remoteErrorText } from "./remoteFailure";
import { classifySshFailure, parseSshStartFailure } from "./sshFailure";

/** What this computer last learned about one remote machine, from the outcome
 * of every request any view made to it. */
export type RemoteConnectionStatus =
  /** The machine answered its latest request. */
  | "connected"
  /** Not known yet, or a reconnect is under way. */
  | "connecting"
  /** The machine or its SSH tunnel did not answer. */
  | "unreachable"
  /** SSH needs a password or passphrase a background attempt cannot give. */
  | "needs-auth"
  /** The machine's host key is unknown, changed or unusable; only the user can decide. */
  | "host-key"
  /** SSH works, but Bycoda Host is not listening on the machine. */
  | "host-not-running"
  /** The host answered, but is too old for something the app asked. */
  | "outdated-host";

export type RemoteConnectionState = {
  status: RemoteConnectionStatus;
  /** Why the machine is not connected, in words fit for the user. */
  error?: string;
  /** When the machine last answered, in this session of the app. */
  lastSeen?: number;
};

export const INITIAL_CONNECTION: RemoteConnectionState = { status: "connecting" };

export type RemoteConnectionEvent =
  | { type: "ok"; at: number }
  | { type: "failure"; error: unknown; at: number }
  /** The SSH process behind the machine's tunnel ended by itself. */
  | { type: "tunnel-exit"; exitCode?: number | null; stderr: string; at: number }
  /** A reconnect worked, or Update Host finished: forget any problem. */
  | { type: "recovered"; at: number }
  /** The machine's address was edited: what was learned about the old one no
   * longer applies, and a connection to the new one is being made. */
  | { type: "reset" };

/** Takes anything secret or machine-sized out of an error before it is shown:
 * bearer tokens, key=value credentials and whole `ssh …` command lines. */
export function sanitizeConnectionError(text: string): string {
  const cleaned = text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer …")
    .replace(/\b(token|password|passphrase|secret)\s*[=:]\s*\S+/gi, "$1 …")
    .replace(/\bssh(?:\.exe)?\s+-\S.*/gi, "")
    .replace(/\s*Open Settings → Connections and reconnect[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned;
}

/** A short reason for a status, for banners and tooltips. */
export function connectionReason(status: RemoteConnectionStatus, raw: string): string {
  if (status === "outdated-host") return "bycoda Host on the machine needs an update.";
  if (status === "host-not-running")
    return "The machine is reachable, but bycoda Host is not running there. Start it, then reconnect.";
  if (/Machine is unreachable/i.test(raw))
    return "The machine did not answer. It may be off, asleep or offline.";
  if (
    /no longer connected|isn.t connected on this computer|Connect this project.s machine/i.test(raw)
  )
    return "This machine is not connected on this computer.";
  if (/SSH connection failed/i.test(raw)) {
    const detail = sanitizeConnectionError(raw.replace(/^.*?SSH connection failed[^:]*:\s*/i, ""));
    return detail ? `SSH could not connect: ${detail}` : "SSH could not connect.";
  }
  return sanitizeConnectionError(raw) || "The machine did not answer.";
}

/** Which status a failed request means. `connected` when the machine itself
 * answered, even if with an error of its own. `specific` is false for the bare
 * "did not answer" that every failed request ends in, which must not replace a
 * more precise reason that is already known. */
export function connectionOutcome(error: unknown): {
  status: RemoteConnectionStatus;
  error?: string;
  specific?: boolean;
} {
  const failure = classifyRemoteError(error);
  if (failure.kind === "outdated")
    return { status: "outdated-host", error: connectionReason("outdated-host", failure.message) };
  if (failure.kind !== "unreachable") return { status: "connected" };
  const text = remoteErrorText(error);
  if (/Host is not running on the machine/i.test(text))
    return {
      status: "host-not-running",
      error: connectionReason("host-not-running", text),
      specific: true,
    };
  const start = parseSshStartFailure(text);
  if (start) {
    const { kind, hint } = classifySshFailure(start);
    if (kind !== "unreachable") return { status: kind, error: hint, specific: true };
  }
  return {
    status: "unreachable",
    error: connectionReason("unreachable", failure.message),
    specific: !/Machine is unreachable/i.test(text),
  };
}

/** What a tunnel that died tells about the machine. */
function tunnelExitOutcome(event: { exitCode?: number | null; stderr: string }) {
  const { kind, hint } = classifySshFailure(event);
  if (kind !== "unreachable") return { status: kind, error: hint };
  const detail = sanitizeConnectionError(event.stderr.split("\n").filter(Boolean).pop() ?? "");
  return {
    status: "unreachable" as const,
    error: detail ? `The SSH connection dropped: ${detail}` : "The SSH connection dropped.",
  };
}

/** The state after one event. Returns the same object when nothing changed. */
export function reduceConnection(
  state: RemoteConnectionState,
  event: RemoteConnectionEvent,
): RemoteConnectionState {
  switch (event.type) {
    case "reset":
      return state === INITIAL_CONNECTION ? state : INITIAL_CONNECTION;
    case "recovered":
      return { status: "connected", lastSeen: event.at };
    case "ok":
      // An old host keeps answering what it knows, so only a reconnect or an
      // update clears that notice.
      if (state.status === "outdated-host") return state;
      return { status: "connected", lastSeen: event.at };
    case "failure": {
      const outcome = connectionOutcome(event.error);
      if (outcome.status === "connected")
        return reduceConnection(state, { type: "ok", at: event.at });
      const sameReason = state.error === outcome.error || (!!state.error && !outcome.specific);
      if (state.status === outcome.status && sameReason) return state;
      return { status: outcome.status, error: outcome.error, lastSeen: state.lastSeen };
    }
    case "tunnel-exit": {
      // A state that already waits for the user stays as it is.
      if (!["connected", "connecting", "outdated-host", "unreachable"].includes(state.status))
        return state;
      const outcome = tunnelExitOutcome(event);
      if (state.status === outcome.status && state.error === outcome.error) return state;
      return { ...outcome, lastSeen: state.lastSeen };
    }
  }
}

/** Delays between background reconnect attempts after a drop, then every minute. */
export const AUTO_RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Background attempts stop once the window has been hidden this long. */
export const HIDDEN_RETRY_LIMIT_MS = 10 * 60_000;

/** The wait before background attempt number `attempt` (0 is the first). */
export function autoRetryDelay(attempt: number): number {
  return AUTO_RETRY_DELAYS[Math.min(Math.max(attempt, 0), AUTO_RETRY_DELAYS.length - 1)];
}

/** Whether to try again without asking the user: only a machine that did not
 * answer (or whose host is not running yet), never one that needs a password or
 * a host-key decision, not for a window nobody looks at, and not at all when
 * the user turned automatic reconnecting off. */
export function shouldAutoRetry(
  status: RemoteConnectionStatus,
  hiddenSince: number | undefined,
  now: number,
  enabled = true,
): boolean {
  if (!enabled || (status !== "unreachable" && status !== "host-not-running")) return false;
  return hiddenSince === undefined || now - hiddenSince <= HIDDEN_RETRY_LIMIT_MS;
}

/** Whether a message cannot reach the machine right now. */
export const blocksSending = (status: RemoteConnectionStatus) =>
  status === "unreachable" ||
  status === "needs-auth" ||
  status === "host-key" ||
  status === "host-not-running";

/** Whether only a sign-in, answered in Connections settings, can fix it. */
export const needsSignIn = (status: RemoteConnectionStatus) =>
  status === "needs-auth" || status === "host-key";

/** How a project row marks its machine: a dot colour and a tooltip. `down`
 * rows can be clicked to reconnect. */
export function connectionIndicator(
  state: RemoteConnectionState,
  reconnecting: boolean,
): { tone: "connected" | "connecting" | "down"; label: string } {
  if (reconnecting) return { tone: "connecting", label: "Reconnecting" };
  switch (state.status) {
    case "connected":
      return { tone: "connected", label: "Connected" };
    case "outdated-host":
      return { tone: "connected", label: `Connected. ${state.error ?? ""}`.trim() };
    case "connecting":
      return { tone: "connecting", label: "Connecting" };
    default:
      return { tone: "down", label: `Not connected. ${state.error ?? ""}`.trim() };
  }
}

export type ReconnectOutcome = { ok: true } | { ok: false; error: string };

/** Sends a message through a connection that may have dropped. A message
 * never leaves the composer for good unless `send` accepts it: when
 * reconnecting fails, nothing is sent and the reason comes back for display.
 * `ready` resolves once the view has caught up with the machine again. */
export async function sendAfterReconnect(options: {
  status: RemoteConnectionStatus;
  reconnect: () => Promise<ReconnectOutcome>;
  ready: () => Promise<boolean>;
  send: () => boolean;
}): Promise<{ sent: boolean; failure?: "reconnect" | "offline"; error?: string }> {
  if (blocksSending(options.status)) {
    const result = await options.reconnect();
    if (!result.ok) return { sent: false, failure: "reconnect", error: result.error };
  }
  if (!(await options.ready()))
    return { sent: false, failure: "offline", error: "The machine is still not answering." };
  return { sent: options.send() };
}
