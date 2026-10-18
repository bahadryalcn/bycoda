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
  /** The machine answered with an error of its own (a git failure, a bad path). */
  | "other";

export type RemoteFailure = { kind: RemoteFailureKind; message: string };

/** Messages from `remote.rs`, `remote_ssh.rs`, `remoteCommands.ts` and the host. */
const UNREACHABLE =
  /RPC_HOST_UNAVAILABLE|RPC_CONNECTION_INTERRUPTED|RPC_DNS|RPC_PROXY|Machine is unreachable|Host is not running on the machine|SSH connection failed|SSH timed out|Could not start OpenSSH|Machine is no longer connected|machine isn.t connected on this computer|Connect this project.s machine/i;
const OUTDATED =
  /Unsupported (host method|remote operation|workspace command)|Update bycoda Host in Connections settings/i;
const UNSUPPORTED = /isn.t available for projects on another machine/i;

export function remoteErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : String(error);
}

/** Sorts a rejected remote request into what the user can do about it. The
 * original text is kept as the message, minus the host's own prefix. */
export function classifyRemoteError(error: unknown): RemoteFailure {
  const text = remoteErrorText(error);
  const message = text.replace(/^Host rejected request:\s*/i, "").trim() || text;
  if (/Host identity changed\. Add this machine again before continuing\./i.test(text))
    return { kind: "identity", message };
  if (UNREACHABLE.test(text)) return { kind: "unreachable", message };
  if (OUTDATED.test(text)) return { kind: "outdated", message };
  if (UNSUPPORTED.test(text)) return { kind: "unsupported", message };
  return { kind: "other", message };
}

/** The machine itself cannot be asked right now, as opposed to one command failing. */
export const isConnectionFailure = (failure: RemoteFailure) =>
  failure.kind === "unreachable" || failure.kind === "outdated" || failure.kind === "identity";

/** How long to wait before asking an unreachable machine again, given how
 * many requests in a row have failed. Each ask can cost an SSH attempt. */
export function unreachablePollDelay(failures: number): number {
  return failures <= 1 ? 15_000 : 30_000;
}
