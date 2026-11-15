import { t } from "../../../shared/i18n";
import { RECONNECT_GRACE_MS, type RemoteConnectionState } from "./remoteConnection";

export type MachineStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "offline"
  | "update"
  | "disabled";

/** What this page's own check learned about a machine. */
export type MachineProbeResult = "connected" | "provider" | "update" | "offline";

export type MachineRouteKind = "lan" | "tailscale" | "tunnel" | "ssh" | "url";

const DOWN = new Set<RemoteConnectionState["status"]>([
  "unreachable",
  "needs-auth",
  "host-key",
  "identity-mismatch",
  "connection-blocked",
  "host-not-running",
]);

/** The one status a machine row shows. "Reconnecting" is the shared notion: the
 * machine did not answer, background reconnecting is on, and it either is being
 * retried now or went quiet less than the shared grace (`RECONNECT_GRACE_MS`)
 * ago, the same window the workspace outage notice waits. States that need the
 * owner (sign-in, host key, identity, blocked) are Offline at once. */
export function machineStatus(input: {
  enabled: boolean;
  connection: RemoteConnectionState;
  reconnecting: boolean;
  autoReconnect: boolean;
  probed?: MachineProbeResult;
  now: number;
}): MachineStatus {
  const { connection, probed } = input;
  if (!input.enabled) return "disabled";
  if (connection.status === "outdated-host" || probed === "update") return "update";
  if (DOWN.has(connection.status) || probed === "offline") {
    const quiet = connection.status === "unreachable" || connection.status === "host-not-running";
    const recent =
      connection.lastSeen !== undefined && input.now - connection.lastSeen < RECONNECT_GRACE_MS;
    if (quiet && input.autoReconnect && (input.reconnecting || recent)) return "reconnecting";
    return "offline";
  }
  if (connection.status === "connecting" && probed === undefined) return "connecting";
  return "connected";
}

/** When the status turns from "reconnecting" to "offline" on its own, as ms from `now`. */
export function reconnectingEndsIn(connection: RemoteConnectionState, now: number) {
  if (connection.lastSeen === undefined) return undefined;
  const left = connection.lastSeen + RECONNECT_GRACE_MS - now;
  return left > 0 ? left : undefined;
}

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  connected: "Connected",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  offline: "Offline",
  update: "Update required",
  disabled: "Disabled",
};

export const ROUTE_KIND_LABEL: Record<MachineRouteKind, string> = {
  lan: "LAN",
  tailscale: "Tailscale",
  tunnel: "Tunnel",
  ssh: "SSH",
  url: "Host URL",
};

/** Which way in an address is, from the address alone. */
export function routeKindOfAddress(address: string): MachineRouteKind {
  const host = address
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^[^@/]*@/, "")
    .replace(/[:/].*$/, "")
    .toLowerCase();
  if (host.endsWith(".trycloudflare.com")) return "tunnel";
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part < 256)
  ) {
    const [a, b] = parts as [number, number];
    if (a === 100 && b >= 64 && b <= 127) return "tailscale";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127)
      return "lan";
  }
  if (host.endsWith(".ts.net")) return "tailscale";
  return host === "localhost" ? "lan" : "ssh";
}

export type MachineSummaryPart = { id: "kind" | "status" | "version"; text: string };

/** `<route kind> · <status> · <version, only when it differs> · N routes`, as the
 * parts of one line. The route count is returned separately: the row makes it the
 * button that opens the routes panel. */
export function machineSummary(input: {
  routeKind?: MachineRouteKind;
  status: MachineStatus;
  /** The machine's build, and this desktop's; shown only when both are known and differ. */
  version?: string;
  desktopVersion?: string;
  routeCount?: number;
}): { parts: MachineSummaryPart[]; routes?: string } {
  const parts: MachineSummaryPart[] = [];
  if (input.routeKind) parts.push({ id: "kind", text: t(ROUTE_KIND_LABEL[input.routeKind]) });
  parts.push({ id: "status", text: t(MACHINE_STATUS_LABEL[input.status]) });
  if (input.version && input.desktopVersion && input.version !== input.desktopVersion)
    parts.push({ id: "version", text: input.version });
  const count = input.routeCount ?? 0;
  return {
    parts,
    routes: count > 0 ? (count === 1 ? t("1 route") : t("{p0} routes", { p0: count })) : undefined,
  };
}

/** The summary as plain text, for the row's accessible description. */
export const machineSummaryText = (summary: ReturnType<typeof machineSummary>) =>
  [...summary.parts.map((part) => part.text), ...(summary.routes ? [summary.routes] : [])].join(
    " · ",
  );

export const MACHINE_STATUS_TONE: Record<
  MachineStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  connected: "success",
  connecting: "neutral",
  reconnecting: "warning",
  offline: "danger",
  update: "warning",
  disabled: "neutral",
};
