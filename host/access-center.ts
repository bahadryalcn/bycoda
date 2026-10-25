import type { MobileAccessStatus } from "../src/integrations/mobile-access";
import {
  TUNNEL_ISSUES,
  TUNNEL_PROVIDERS,
  tunnelLocalUrl,
  tunnelPublicUrl,
  type TunnelOverview,
} from "../src/integrations/external-tunnels";
export type HostAccessReport = {
  environmentId: string;
  sampledAt: number;
  devices: { id: string; name: string; isCurrent: boolean }[];
  devicesTruncated: boolean;
  lan: { state: MobileAccessStatus["state"] };
  privateNetwork: { state: MobileAccessStatus["state"] };
  tunnels: Omit<TunnelOverview, "environmentId" | "hostLocalUrl"> | null;
};
type Dependencies = {
  devices: () =>
    | { devices: HostAccessReport["devices"]; devicesTruncated: boolean }
    | Promise<{ devices: HostAccessReport["devices"]; devicesTruncated: boolean }>;
  lan: () => Promise<MobileAccessStatus>;
  privateNetwork: () => Promise<MobileAccessStatus>;
  tunnels: () => Promise<TunnelOverview>;
};
const ACCESS_STATES = [
  "ready",
  "setup-required",
  "install-required",
  "sign-in-required",
  "offline",
  "approval-required",
  "permission-required",
  "unavailable",
];
const safeStatus = async (read: Dependencies["lan"]) => {
  try {
    const value = await read();
    return { state: ACCESS_STATES.includes(value.state) ? value.state : ("unavailable" as const) };
  } catch {
    return { state: "unavailable" as const };
  }
};
/** Project before transport; keys, pairing tickets, vault values, approval links and diagnostic errors stay on the host. */
export async function readHostAccess(
  environmentId: string,
  dependencies: Dependencies,
  now = Date.now,
): Promise<HostAccessReport> {
  const devices = await dependencies.devices();
  if (
    !environmentId ||
    environmentId.length > 256 ||
    devices.devices.length > 256 ||
    new Set(devices.devices.map((row) => row.id)).size !== devices.devices.length ||
    devices.devices.some(
      (row) =>
        !row.id ||
        row.id.length > 128 ||
        typeof row.name !== "string" ||
        row.name.length > 160 ||
        typeof row.isCurrent !== "boolean",
    )
  )
    throw new Error("Invalid host access metadata");
  const [lan, privateNetwork, tunnels] = await Promise.all([
    safeStatus(dependencies.lan),
    safeStatus(dependencies.privateNetwork),
    (async () => {
      try {
        const value = await dependencies.tunnels();
        if (
          value.environmentId !== environmentId ||
          value.providers.length > 2 ||
          value.tunnels.length > 32
        )
          return null;
        const providers = value.providers.map((row) => {
          if (
            !TUNNEL_PROVIDERS.includes(row.provider) ||
            !["saved", "missing", "unavailable", "not-required"].includes(row.credential) ||
            typeof row.installed !== "boolean"
          )
            throw new Error();
          return { provider: row.provider, installed: row.installed, credential: row.credential };
        });
        const records = value.tunnels.map((row) => {
          if (
            !row.id ||
            row.id.length > 128 ||
            !TUNNEL_PROVIDERS.includes(row.provider) ||
            !["host", "dev-server"].includes(row.target) ||
            !["starting", "ready", "stopping", "stopped", "error", "interrupted"].includes(
              row.state,
            ) ||
            !Number.isSafeInteger(row.startedAt) ||
            row.startedAt < 0 ||
            (row.issue && !TUNNEL_ISSUES.includes(row.issue))
          )
            throw new Error();
          const publicUrl = row.publicUrl
            ? tunnelPublicUrl(row.provider, row.publicUrl)
            : undefined;
          if (row.publicUrl && !publicUrl) throw new Error();
          return {
            id: row.id,
            provider: row.provider,
            target: row.target,
            state: row.state,
            startedAt: row.startedAt,
            localUrl: tunnelLocalUrl(row.localUrl),
            canStop: row.canStop === true,
            ...(publicUrl ? { publicUrl } : {}),
            ...(row.issue ? { issue: row.issue } : {}),
          };
        });
        if (
          new Set(providers.map((row) => row.provider)).size !== providers.length ||
          new Set(records.map((row) => row.id)).size !== records.length
        )
          throw new Error();
        return { providers, tunnels: records, publicReachability: "unverified" as const };
      } catch {
        return null;
      }
    })(),
  ]);
  return {
    environmentId,
    sampledAt: now(),
    devices: devices.devices.map(({ id, name, isCurrent }) => ({ id, name, isCurrent })),
    devicesTruncated: devices.devicesTruncated,
    lan,
    privateNetwork,
    tunnels,
  };
}
