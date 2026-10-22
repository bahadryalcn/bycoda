/** What a failed SSH connection attempt means for the user, decided from ssh's
 * exit status, its (untranslated, `LC_ALL=C`) stderr and, when the desktop
 * could tell, whether the SSH server's port accepted a TCP connection. */
export type SshFailureKind =
  /** A password or key passphrase is needed, or the key is not accepted. */
  | "needs-auth"
  /** The host key is unknown, changed, or of a type this ssh will not use. */
  | "host-key"
  /** The machine or network did not answer. */
  | "unreachable";

export type SshFailure = {
  kind: SshFailureKind;
  /** One sentence for the user: what happened and what to do. */
  hint: string;
};

export type SshFailureInput = {
  /** ssh's exit status: 255 for its own failures. Unknown when absent. */
  exitCode?: number | null;
  stderr: string;
  /** Whether the SSH server's TCP port answered, when that was checked. */
  reachable?: boolean;
};

const HOST_KEY_CHANGED =
  /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .+ has changed|Offending (?:\w+ )?key in/i;
const HOST_KEY_ALGORITHM = /no matching host key type found/i;
const HOST_KEY_UNKNOWN = /Host key verification failed/i;
const KEY_ALGORITHM = /no mutual signature algorithm/i;
const PASSPHRASE =
  /Load key .*: incorrect passphrase|Load key .*: bad passphrase|sign_and_send_pubkey: signing failed|Enter passphrase|Bad passphrase/i;
const AUTH =
  /Permission denied|Too many authentication failures|Authentication failed|No more authentication methods|Authentication refused/i;
const NETWORK =
  /Connection refused|Connection timed out|Operation timed out|No route to host|Could not resolve hostname|Network is unreachable|Connection closed by|closed by remote host|Connection reset|kex_exchange_identification|Timeout, server .* not responding|Broken pipe|Host is down|Name or service not known|nodename nor servname|No such host is known|ssh: connect to host/i;

/** Sorts one failure. Order matters: what the user can fix by signing in or
 * trusting a key comes first, then network wording; with no wording at all,
 * ssh's own exit status 255 plus a server that answers means the sign-in or the
 * host key was refused, and anything else is treated as the machine not
 * answering, which only ever retries quietly. */
export function classifySshFailure({ exitCode, stderr, reachable }: SshFailureInput): SshFailure {
  if (HOST_KEY_CHANGED.test(stderr))
    return {
      kind: "host-key",
      hint: "The machine's SSH host key changed. If you did not expect that, do not connect. Otherwise remove its old entry from known_hosts, then sign in and reconnect.",
    };
  if (HOST_KEY_ALGORITHM.test(stderr))
    return {
      kind: "host-key",
      hint: "SSH and the machine share no host key type. Update the machine's SSH server or your SSH config (HostKeyAlgorithms).",
    };
  if (HOST_KEY_UNKNOWN.test(stderr))
    return {
      kind: "host-key",
      hint: "SSH does not trust this machine's host key yet. Sign in and reconnect to review it.",
    };
  if (KEY_ALGORITHM.test(stderr))
    return {
      kind: "needs-auth",
      hint: "The machine does not accept your SSH key's signature type. Use another key or update the machine's SSH server.",
    };
  if (PASSPHRASE.test(stderr))
    return {
      kind: "needs-auth",
      hint: "Your SSH key is protected by a passphrase that no agent holds. Sign in and reconnect.",
    };
  if (AUTH.test(stderr))
    return {
      kind: "needs-auth",
      hint: "SSH needs your password or key. Sign in and reconnect.",
    };
  if (NETWORK.test(stderr) || reachable === false)
    return {
      kind: "unreachable",
      hint: "The machine did not answer. It may be off, asleep or offline.",
    };
  if (exitCode === 255 && reachable === true)
    return {
      kind: "needs-auth",
      hint: "The machine is reachable but SSH could not sign in. Sign in and reconnect.",
    };
  return { kind: "unreachable", hint: "SSH could not connect." };
}

/** The pieces `remote_ssh.rs` puts in a failed start's message:
 * `SSH connection failed (exit 255, host reachable): <stderr>. Open Settings…`. */
export function parseSshStartFailure(
  text: string,
): { exitCode?: number; reachable?: boolean; stderr: string } | undefined {
  const match = /SSH connection failed(?: \(([^)]*)\))?:\s*([\s\S]*)/i.exec(text);
  if (!match) return undefined;
  const tag = match[1] ?? "";
  const exit = /exit (\d+)/.exec(tag);
  return {
    exitCode: exit ? Number(exit[1]) : undefined,
    reachable: /host unreachable/.test(tag) ? false : /host reachable/.test(tag) ? true : undefined,
    stderr: match[2],
  };
}
