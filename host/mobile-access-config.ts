import type { MobileAccessStatus } from "../src/integrations/mobile-access";

type ObjectValue = Record<string, unknown>;
export const objectValue = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};

export function tailscaleIdentity(value: unknown): {
  state: MobileAccessStatus["state"];
  dns?: string;
  machineName?: string;
} {
  const status = objectValue(value);
  const self = objectValue(status.Self);
  if (status.BackendState === "NeedsLogin") return { state: "sign-in-required" };
  if (status.BackendState !== "Running" || self.Online === false) return { state: "offline" };
  const dns = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "").toLowerCase() : "";
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$/.test(dns)) return { state: "unavailable" };
  const machineName =
    typeof self.HostName === "string" ? self.HostName.trim().slice(0, 120) : dns.split(".")[0];
  return { state: "setup-required", dns, machineName };
}

/** A publicly forwarded port must never be offered as a private phone endpoint. */
function isPublicPort(config: ObjectValue, port: number): boolean {
  return Object.entries(objectValue(config.AllowFunnel)).some(
    ([key, enabled]) => enabled === true && key.endsWith(`:${port}`),
  );
}

export function existingMobileEndpoint(
  value: unknown,
  dns: string,
  hostPort: number,
): string | undefined {
  const config = objectValue(value);
  const tcp = objectValue(config.TCP);
  for (const [key, webValue] of Object.entries(objectValue(config.Web))) {
    const separator = key.lastIndexOf(":");
    const port = Number(key.slice(separator + 1));
    if (
      separator < 0 ||
      key.slice(0, separator).toLowerCase() !== dns ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      isPublicPort(config, port) ||
      objectValue(tcp[String(port)]).HTTPS !== true
    )
      continue;
    const handler = objectValue(objectValue(objectValue(webValue).Handlers)["/"]);
    if (
      handler.Proxy === `http://127.0.0.1:${hostPort}` ||
      handler.Proxy === `http://127.0.0.1:${hostPort}/`
    ) {
      return `https://${dns}${port === 443 ? "" : `:${port}`}`;
    }
  }
  return undefined;
}

/** Allocate a new port; never reset, replace or convert an existing Serve handler. */
export function availableMobilePort(value: unknown): number | undefined {
  const config = objectValue(value);
  const tcp = objectValue(config.TCP);
  const webKeys = Object.keys(objectValue(config.Web));
  return [443, ...Array.from({ length: 16 }, (_, index) => 8443 + index)].find(
    (port) =>
      !(String(port) in tcp) &&
      !webKeys.some((key) => key.endsWith(`:${port}`)) &&
      !isPublicPort(config, port),
  );
}

export function tailscaleApprovalUrl(output: string): string | undefined {
  for (const candidate of output.match(/https:\/\/[^\s<>"']+/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (
        url.hostname === "login.tailscale.com" &&
        !url.username &&
        !url.password &&
        url.port === ""
      ) {
        return url.href;
      }
    } catch {
      /* Untrusted process output is never passed to an external opener. */
    }
  }
  return undefined;
}
