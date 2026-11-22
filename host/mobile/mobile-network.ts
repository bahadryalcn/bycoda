import { createSocket } from "node:dgram";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
// oxlint-disable-next-line no-restricted-imports -- the one shared, cached adapter reader
import { networkInterfaces } from "node:os";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";

export type NetworkInterfaces = ReturnType<typeof networkInterfaces>;

/** `os.networkInterfaces()` is a synchronous adapter query (~20 ms on Windows, more
 * under load) and status reads call it per address on every poll, so it blocked the
 * Host event loop for seconds at a time. Share one snapshot as long as the route probe
 * (a profile still showed this read at ~100 ms every 5 s under load). */
const INTERFACES_CACHE_MS = 30_000;
let interfaces: { value: ReturnType<typeof networkInterfaces>; at: number } | undefined;
export function currentNetworkInterfaces(): ReturnType<typeof networkInterfaces> {
  if (!interfaces || elapsedSince(interfaces.at) >= INTERFACES_CACHE_MS)
    interfaces = { value: networkInterfaces(), at: monotonicNow() };
  return interfaces.value;
}

/** Changes when an adapter gains, loses or changes an external IPv4 address: a Wi-Fi
 * switch, a VPN or Tailscale coming up or going down. Cached probes key on it. */
export function networkFingerprint(value = currentNetworkInterfaces()): string {
  return Object.entries(value)
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => !entry.internal && entry.family === "IPv4")
        .map((entry) => `${name}=${entry.address}`),
    )
    .sort()
    .join("|");
}

let routeAddress: string | undefined;
let routeProbe: Promise<string | undefined> | undefined;
let routeProbedAt = 0;
/** Networks change (Wi-Fi switch, VPN on/off); re-probe after this long. */
const NETWORK_CACHE_MS = 30_000;

/** Resolve routing locally; UDP connect selects an interface without sending data. */
export function defaultRouteAddress(): Promise<string | undefined> {
  if (routeProbe && Date.now() - routeProbedAt > NETWORK_CACHE_MS) routeProbe = undefined;
  if (!routeProbe) routeProbedAt = Date.now();
  return (routeProbe ??= new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (address?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      routeAddress = address;
      resolve(address);
    };
    const timer = setTimeout(() => finish(), 500);
    socket.on("error", () => finish());
    try {
      socket.connect(53, "1.1.1.1", () => {
        if (!settled) finish(socket.address().address);
      });
    } catch {
      finish();
    }
  }));
}

export function knownDefaultRouteAddress(): string | undefined {
  void defaultRouteAddress().catch(() => {});
  return routeAddress;
}

const PUBLIC_NETWORK_HINT =
  "Windows treats this network as Public, which can block your phone. Set it to Private in Windows network settings.";

/** Starting PowerShell blocks the Host event loop, so the answer is reused until the
 * adapters change. A switch to Private does not change the adapters, so while the
 * answer still shows a Public network it is refreshed every 30 s (the hint clears
 * soon after the owner fixes it), otherwise every few minutes. Missing cmdlets,
 * timeouts and policy failures mean unknown. */
const PROFILE_CACHE_MS = 5 * 60_000;
export function createWindowsNetworkHint(
  platform = process.platform,
  network: () => string = networkFingerprint,
) {
  let profiles: Promise<Record<string, string>> | undefined;
  let queriedAt = 0;
  let queriedNetwork = "";
  let sawPublic = false;
  return async (interfaceName?: string): Promise<string | undefined> => {
    if (platform !== "win32" || !interfaceName) return undefined;
    const current = network();
    const ttl = sawPublic ? NETWORK_CACHE_MS : PROFILE_CACHE_MS;
    if (profiles && (elapsedSince(queriedAt) > ttl || current !== queriedNetwork))
      profiles = undefined;
    if (!profiles) {
      queriedAt = monotonicNow();
      queriedNetwork = current;
    }
    // Through the Host's process worker: launching PowerShell took ~2 s of main-thread time
    // on Windows, a full event-loop stall on every profile refresh.
    profiles ??= execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; if ((Get-NetFirewallProfile -Name Public).Enabled) { $profiles = @{}; Get-NetConnectionProfile | ForEach-Object { $profiles[$_.InterfaceAlias] = [string]$_.NetworkCategory }; ConvertTo-Json -Compress -InputObject $profiles }",
      ],
      { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024, encoding: "buffer" },
    ).then(
      ({ stdout }) => {
        try {
          // PowerShell emits one compact JSON line. Decode that line lossily.
          const newline = stdout.indexOf(10);
          const parsed: unknown = JSON.parse(
            stdout
              .subarray(0, newline < 0 ? stdout.length : newline)
              .toString("utf8")
              .replace(/^\uFEFF/, ""),
          );
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
          return Object.fromEntries(
            Object.entries(parsed).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          );
        } catch {
          return {};
        }
      },
      () => ({}),
    );
    const answer = await profiles;
    sawPublic = Object.values(answer).includes("Public");
    return answer[interfaceName] === "Public" ? PUBLIC_NETWORK_HINT : undefined;
  };
}

export const windowsNetworkHint = createWindowsNetworkHint();
