import { t } from "../../../shared/i18n/core";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { RemoteConnectionStatus } from "./remoteConnection";
import { classifySshFailure, parseSshStartFailure } from "./sshFailure";

/** Takes anything secret or machine-sized out of an error before it is shown:
 * bearer tokens, key=value credentials and whole `ssh …` command lines. */
export function sanitizeConnectionError(text: string): string {
  const cleaned = text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer …")
    .replace(/\b(token|password|passphrase|secret)\s*[=:]\s*\S+/gi, "$1 …")
    .replace(/\bssh(?:\.exe)?\s+-\S.*/gi, "")
    .replace(/\s*Open Settings → (?:Machines|Connections) and reconnect[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 200 ? truncateGraphemes(cleaned, 198) : cleaned;
}

/** The machine answered 403 for its route: a proxy or origin header, not the pairing. */
export const ROUTE_REJECTED =
  "A proxy or origin header in front of the machine was refused. Check the route to it.";

/** The machine answered 401: its device row for this computer is gone, so only pairing again helps. */
export const PAIRING_REFUSED =
  "This machine no longer accepts this computer’s pairing. Add it again in Connections.";

/** A short reason for a status, for banners and tooltips. */
export function connectionReason(status: RemoteConnectionStatus, raw: string): string {
  if (status === "outdated-host") return "bycoda Host on the machine needs an update.";
  if (status === "identity-mismatch" && /\[RPC_AUTHORIZATION\]/.test(raw)) return PAIRING_REFUSED;
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

/** `connectionReason` in the user's language, for the fixed sentences it returns. */
export function localizeConnectionReason(reason: string): string {
  const known: Record<string, string> = {
    "bycoda Host on the machine needs an update.": t("bycoda Host on the machine needs an update."),
    "The machine is reachable, but bycoda Host is not running there. Start it, then reconnect.": t(
      "The machine is reachable, but bycoda Host is not running there. Start it, then reconnect.",
    ),
    "The machine did not answer. It may be off, asleep or offline.": t(
      "The machine did not answer. It may be off, asleep or offline.",
    ),
    "This machine is not connected on this computer.": t(
      "This machine is not connected on this computer.",
    ),
    [ROUTE_REJECTED]: t(
      "A proxy or origin header in front of the machine was refused. Check the route to it.",
    ),
    [PAIRING_REFUSED]: t(
      "This machine no longer accepts this computer’s pairing. Add it again in Connections.",
    ),
    "SSH could not connect.": t("SSH could not connect."),
    "The machine did not answer.": t("The machine did not answer."),
  };
  return known[reason] ?? reason;
}

/**
 * Why an explicit action on an unreachable machine failed, when the cause is one the user can
 * fix (a mistyped address, a broken proxy, a stopped Host, an SSH sign-in or host-key refusal).
 * `undefined` for a plain outage, where waiting is the right advice. Fixed sentences only: the
 * raw text never reaches the message.
 */
export function actionableUnreachableReason(text: string): string | undefined {
  if (/\[RPC_DNS\]/.test(text))
    return t("The machine address could not be resolved. Check the saved connection address.");
  if (/\[RPC_PROXY\]/.test(text))
    return t("The network proxy could not connect. Check the proxy and machine connection.");
  if (/Host is not running on the machine/i.test(text))
    return localizeConnectionReason(connectionReason("host-not-running", text));
  if (
    /no longer connected|isn.t connected on this computer|Connect this project.s machine/i.test(
      text,
    )
  )
    return localizeConnectionReason(connectionReason("unreachable", text));
  const start = parseSshStartFailure(text);
  if (!start) return undefined;
  const { kind } = classifySshFailure(start);
  if (kind === "needs-auth")
    return t(
      "SSH could not sign in to this machine. Sign in or check the SSH key, then reconnect.",
    );
  if (kind === "host-key")
    return t(
      "SSH does not trust this machine’s host key. Review it in Connections, then reconnect.",
    );
  return undefined;
}
