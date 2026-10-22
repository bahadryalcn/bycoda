import { describe, expect, it } from "vitest";
import { classifySshFailure, parseSshStartFailure, type SshFailureKind } from "./sshFailure";

/** Real OpenSSH wording, untranslated (the desktop runs ssh with LC_ALL=C).
 * Windows OpenSSH and macOS differ in a few places; both are covered. */
const SAMPLES: {
  name: string;
  stderr: string;
  exitCode?: number;
  reachable?: boolean;
  kind: SshFailureKind;
}[] = [
  // Sign-in
  {
    name: "publickey only",
    stderr: "me@mini: Permission denied (publickey).",
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "publickey, password",
    stderr: "me@mini: Permission denied (publickey,password,keyboard-interactive).",
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "retry wording",
    stderr: "Permission denied, please try again.",
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "too many attempts",
    stderr:
      "Received disconnect from 10.0.0.2 port 22:2: Too many authentication failures\nDisconnected from 10.0.0.2 port 22",
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "passphrase, no agent",
    stderr:
      'Load key "/Users/me/.ssh/id_ed25519": incorrect passphrase supplied to decrypt private key\nme@mini: Permission denied (publickey).',
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "agent could not sign",
    stderr:
      'sign_and_send_pubkey: signing failed for ED25519 "/home/me/.ssh/id_ed25519" from agent: agent refused operation',
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "no mutual signature algorithm",
    stderr: "send_pubkey_test: no mutual signature algorithm",
    exitCode: 255,
    kind: "needs-auth",
  },
  {
    name: "batch mode on Windows",
    stderr: "C:\\Users\\me/.ssh/id_rsa: Permission denied (publickey).",
    exitCode: 255,
    kind: "needs-auth",
  },
  // Host key
  {
    name: "host key unknown in batch mode",
    stderr: "Host key verification failed.",
    exitCode: 255,
    kind: "host-key",
  },
  {
    name: "host key changed",
    stderr:
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nOffending ECDSA key in /Users/me/.ssh/known_hosts:4\nHost key verification failed.",
    exitCode: 255,
    kind: "host-key",
  },
  {
    name: "no matching host key type",
    stderr:
      "Unable to negotiate with 10.0.0.2 port 22: no matching host key type found. Their offer: ssh-rsa",
    exitCode: 255,
    kind: "host-key",
  },
  // Network
  {
    name: "refused (macOS/Linux)",
    stderr: "ssh: connect to host mini port 22: Connection refused",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "timed out (Linux/Windows)",
    stderr: "ssh: connect to host mini port 22: Connection timed out",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "timed out (macOS)",
    stderr: "ssh: connect to host mini port 22: Operation timed out",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "no route",
    stderr: "ssh: connect to host 10.0.0.9 port 22: No route to host",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "resolve (Linux)",
    stderr: "ssh: Could not resolve hostname mini: Name or service not known",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "resolve (macOS)",
    stderr: "ssh: Could not resolve hostname mini: nodename nor servname provided, or not known",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "resolve (Windows)",
    stderr: "ssh: Could not resolve hostname mini: No such host is known.",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "network down",
    stderr: "ssh: connect to host mini port 22: Network is unreachable",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "server closed early",
    stderr:
      "kex_exchange_identification: Connection closed by remote host\nConnection closed by 10.0.0.2 port 22",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "reset",
    stderr: "kex_exchange_identification: read: Connection reset by peer",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "keepalive gave up",
    stderr: "Timeout, server mini not responding.",
    exitCode: 255,
    kind: "unreachable",
  },
  {
    name: "established link closed",
    stderr: "Connection to mini closed by remote host.",
    exitCode: 255,
    kind: "unreachable",
  },
  // No wording: the exit status and the port check decide
  { name: "silent, port answers", stderr: "", exitCode: 255, reachable: true, kind: "needs-auth" },
  { name: "silent, port silent", stderr: "", exitCode: 255, reachable: false, kind: "unreachable" },
  { name: "silent, port unchecked", stderr: "", exitCode: 255, kind: "unreachable" },
  {
    name: "unknown wording, port answers",
    stderr: "something new",
    exitCode: 255,
    reachable: true,
    kind: "needs-auth",
  },
  { name: "killed, no status", stderr: "", kind: "unreachable" },
  {
    name: "not an ssh failure status",
    stderr: "",
    exitCode: 1,
    reachable: true,
    kind: "unreachable",
  },
  // Wording beats the port check
  {
    name: "denied although port check failed",
    stderr: "Permission denied (publickey).",
    exitCode: 255,
    reachable: false,
    kind: "needs-auth",
  },
  {
    name: "refused although port check passed",
    stderr: "Connection refused",
    exitCode: 255,
    reachable: true,
    kind: "unreachable",
  },
];

describe("classifySshFailure", () => {
  it.each(SAMPLES)("$name", ({ name: _name, kind, ...input }) => {
    expect(classifySshFailure(input).kind).toBe(kind);
  });

  it("explains each state with something to do", () => {
    const hint = (stderr: string) => classifySshFailure({ stderr }).hint;
    expect(hint("Permission denied (publickey).")).toMatch(/Sign in and reconnect/);
    expect(hint('Load key "k": incorrect passphrase supplied')).toMatch(/passphrase/);
    expect(hint("REMOTE HOST IDENTIFICATION HAS CHANGED")).toMatch(/do not connect/);
    expect(hint("REMOTE HOST IDENTIFICATION HAS CHANGED")).toMatch(/known_hosts/);
    expect(hint("Host key verification failed.")).toMatch(/review/);
    expect(hint("Connection timed out")).toMatch(/off, asleep or offline/);
  });
});

describe("parseSshStartFailure", () => {
  it("reads the exit status and port check the desktop adds", () => {
    expect(
      parseSshStartFailure(
        "SSH connection failed (exit 255, host reachable): Permission denied. Open Settings → Connections",
      ),
    ).toMatchObject({ exitCode: 255, reachable: true });
    expect(
      parseSshStartFailure("SSH connection failed (exit 255, host unreachable): x"),
    ).toMatchObject({
      exitCode: 255,
      reachable: false,
    });
    expect(parseSshStartFailure("SSH connection failed: Connection refused")).toEqual({
      exitCode: undefined,
      reachable: undefined,
      stderr: "Connection refused",
    });
    expect(parseSshStartFailure("Machine is unreachable.")).toBeUndefined();
  });
});
