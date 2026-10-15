import type { RemoteMachine } from "./protocol";

/** The fields of a saved SSH machine that can be edited, as the form holds them.
 * The machine's id and environment id are not among them: projects, sessions and
 * drafts are keyed by those, so an edit never changes them. */
export type MachineDraft = {
  name: string;
  target: string;
  port: string;
  /** Host service port, independent of the SSH server port. */
  remotePort?: string;
  /** A second address for the same machine; blank for none. */
  alternate?: string;
};

export type ParsedMachineDraft = {
  name: string;
  target: string;
  port: number | null;
  remotePort?: number;
  /** Absent from callers that predate second addresses: then none. */
  alternate?: string | null;
};

export function draftFromMachine(machine: RemoteMachine): MachineDraft {
  return {
    name: machine.name,
    target: machine.ssh?.target ?? "",
    port: machine.ssh?.port ? String(machine.ssh.port) : "",
    remotePort: String(machine.ssh?.remotePort ?? 3776),
    alternate: machine.ssh?.alternate ?? "",
  };
}

const validTarget = (target: string) =>
  !!target && target.length <= 255 && !target.startsWith("-") && TARGET.test(target);

/** The same rules as the desktop's `validate_target`, which has the last word. */
const TARGET = /^[A-Za-z0-9._\-:[\]]+(@[A-Za-z0-9._\-:[\]]+)?$/;

export function parseMachineDraft(
  draft: MachineDraft,
): { ok: true; value: ParsedMachineDraft } | { ok: false; error: string } {
  const target = draft.target.trim();
  if (!validTarget(target))
    return {
      ok: false,
      error: "Enter an SSH hostname or alias, such as user@my-mac-mini, and a valid port.",
    };
  const other = draft.alternate?.trim() ?? "";
  if (other && !validTarget(other))
    return {
      ok: false,
      error: "Enter the other address like the first, such as user@100.64.0.5.",
    };
  const text = draft.port.trim();
  const port = text ? Number(text) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
    return { ok: false, error: "The SSH port must be a number from 1 to 65535." };
  const remotePort = draft.remotePort === undefined ? undefined : Number(draft.remotePort.trim());
  if (
    remotePort !== undefined &&
    (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)
  )
    return { ok: false, error: "The Host port must be a number from 1 to 65535." };
  return {
    ok: true,
    value: {
      name: draft.name.trim(),
      target,
      port,
      ...(remotePort !== undefined ? { remotePort } : {}),
      alternate: other && other !== target ? other : null,
    },
  };
}

/** What saving `next` must do for a machine that currently has `machine`'s
 * definition. A new address or port needs a fresh connection (and closes the
 * old one); a new name alone does not touch the connection. */
export function editImpact(
  machine: RemoteMachine,
  next: ParsedMachineDraft,
): { changed: boolean; reconnect: boolean } {
  const reconnect =
    next.target !== machine.ssh?.target ||
    next.port !== (machine.ssh?.port ?? null) ||
    (next.remotePort !== undefined && next.remotePort !== machine.ssh?.remotePort) ||
    (next.alternate ?? null) !== (machine.ssh?.alternate ?? null);
  // A blank name keeps the saved one.
  const renamed = next.name !== "" && next.name !== machine.name;
  return { changed: reconnect || renamed, reconnect };
}

/** The host part of `user@host`, without the brackets of an IPv6 address. */
export function sshHost(target: string): string {
  const host = target.trim().slice(target.trim().lastIndexOf("@") + 1);
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Whether an SSH address names a machine by number (IPv4 or IPv6), which goes
 * stale when the network hands the machine another one. */
export function isRawIpAddress(target: string): boolean {
  const host = sshHost(target);
  const octets = host.split(".");
  if (octets.length === 4)
    return octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  return host.includes(":") && /^[0-9A-Fa-f:.]+$/.test(host);
}

/** A hostname that can replace the raw IP in `target`, taken from the name the
 * machine's host reported when it was added (stored as the machine's name).
 * Only a dotted, hostname-shaped name qualifies, such as a Mac's
 * `Name.local`; a label like "Home Mac" or a bare `ubuntu` does not. */
export function hostnameSuggestion(target: string, machineName: string): string | undefined {
  const name = machineName.trim();
  if (!isRawIpAddress(target) || name.length > 253) return undefined;
  if (
    !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      name,
    )
  )
    return undefined;
  const at = target.trim().lastIndexOf("@");
  return `${at > 0 ? target.trim().slice(0, at + 1) : ""}${name}`;
}
