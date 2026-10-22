import type { SshEndpoint } from "./serverInventory";

export const MAX_SSH_JUMP_HOSTS = 8;
export function validHttpProxyHost(value: string): boolean {
  if (!value || value.length > 253) return false;
  if (value.includes(":")) {
    if (!/^[a-fA-F0-9:.]+$/.test(value)) return false;
    try {
      return new URL(`http://[${value}]/`).hostname.startsWith("[");
    } catch {
      return false;
    }
  }
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
    );
}
export function sshJumpChain(endpoint: SshEndpoint): readonly string[] {
  if (endpoint.jumpPolicies?.length)
    return endpoint.jumpPolicies.map(
      (hop) =>
        `${hop.user ? `${hop.user}@` : ""}${hop.host.includes(":") && !hop.host.startsWith("[") ? `[${hop.host}]` : hop.host}:${hop.port}`,
    );
  return endpoint.jumpHosts ?? (endpoint.jumpHost ? [endpoint.jumpHost] : []);
}
function validJumpHost(value: string): boolean {
  if (!value || value === "none" || value.startsWith("-") || !/^[a-zA-Z0-9._:@[\]-]+$/.test(value))
    return false;
  const parts = value.split("@");
  if (parts.length > 2 || (parts.length === 2 && (!parts[0] || /[:[\]]/.test(parts[0]))))
    return false;
  const address = parts[parts.length - 1];
  let host = address;
  let port: string | undefined;
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    if (end < 2) return false;
    host = address.slice(1, end);
    const tail = address.slice(end + 1);
    if (tail) {
      if (!tail.startsWith(":")) return false;
      port = tail.slice(1);
    }
  } else if (address.includes(":")) {
    const separator = address.lastIndexOf(":");
    host = address.slice(0, separator);
    port = address.slice(separator + 1);
    if (host.includes(":")) return false;
  }
  return (
    !!host &&
    !host.startsWith("-") &&
    !/[[\]]/.test(host) &&
    (port === undefined || (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535))
  );
}

/** Mirrors the canonical import guard; identity and jump routes are significant. */
export function sameSshEndpoint(left: SshEndpoint, right: SshEndpoint): boolean {
  return (
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.user === right.user &&
    left.port === right.port &&
    (left.identityFile ?? undefined) === (right.identityFile ?? undefined) &&
    (left.certificateFile ?? undefined) === (right.certificateFile ?? undefined) &&
    sameHttpProxy(left.httpProxy, right.httpProxy) &&
    JSON.stringify(left.jumpPolicies ?? []) === JSON.stringify(right.jumpPolicies ?? []) &&
    JSON.stringify(sshJumpChain(left)) === JSON.stringify(sshJumpChain(right))
  );
}
function sameHttpProxy(left: SshEndpoint["httpProxy"], right: SshEndpoint["httpProxy"]) {
  return !left || !right
    ? left === right
    : left.host === right.host &&
        left.port === right.port &&
        (left.scheme ?? "http") === (right.scheme ?? "http");
}
export function sshEndpointPreview(endpoint: SshEndpoint): string {
  const host =
    endpoint.host.includes(":") && !endpoint.host.startsWith("[")
      ? `[${endpoint.host}]`
      : endpoint.host;
  return `${endpoint.user ? `${endpoint.user}@` : ""}${host}:${endpoint.port}`;
}
/** Friendly client guard only; native validation remains authoritative. */
export function validSshEndpointPreview(endpoint: SshEndpoint): boolean {
  const policies = endpoint.jumpPolicies ?? [];
  if (endpoint.httpProxy) {
    const proxy = endpoint.httpProxy;
    if (
      !validHttpProxyHost(proxy.host) ||
      (proxy.scheme !== undefined && !["http", "https"].includes(proxy.scheme)) ||
      !Number.isInteger(proxy.port) ||
      proxy.port < 1 ||
      proxy.port > 65535 ||
      endpoint.jumpHost != null ||
      endpoint.jumpHosts?.length ||
      policies.length
    )
      return false;
  }
  if (
    policies.length > MAX_SSH_JUMP_HOSTS ||
    (policies.length && (endpoint.jumpHost != null || endpoint.jumpHosts?.length))
  )
    return false;
  if (
    policies.some(
      (hop) =>
        !validSshEndpointPreview(hop) ||
        [hop.identityFile, hop.certificateFile, hop.knownHostsFile].some(
          (path) =>
            // oxlint-disable-next-line no-control-regex -- configuration references cannot contain expansion or controls
            path != null && (!path.trim() || path.length > 4096 || /[\x00-\x1f\x7f%$"]/.test(path)),
        ),
    )
  )
    return false;
  const atom = (value: string) =>
    !!value && !value.startsWith("-") && /^[a-zA-Z0-9._:@[\]-]+$/.test(value);
  // oxlint-disable-next-line no-control-regex -- public file references must not carry terminal controls or percent expansion.
  const reference = (value: string) => value.length <= 4096 && !/[\x00-\x1f\x7f%]/.test(value);
  return (
    atom(endpoint.host) &&
    !endpoint.host.includes("@") &&
    Number.isInteger(endpoint.port) &&
    endpoint.port > 0 &&
    endpoint.port <= 65535 &&
    (!endpoint.user || (atom(endpoint.user) && !/[@:[\]]/.test(endpoint.user))) &&
    !(endpoint.jumpHost != null && endpoint.jumpHosts != null) &&
    sshJumpChain(endpoint).length <= MAX_SSH_JUMP_HOSTS &&
    sshJumpChain(endpoint).every(validJumpHost) &&
    (!endpoint.identityFile || reference(endpoint.identityFile)) &&
    (!endpoint.certificateFile ||
      (reference(endpoint.certificateFile) && !endpoint.certificateFile.includes('"')))
  );
}
