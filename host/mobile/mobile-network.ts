import { createSocket } from "node:dgram";
import { execFile } from "node:child_process";

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

/** Cached briefly so a switch to Private clears the hint without a Host restart.
 * Missing cmdlets, timeouts and policy failures mean unknown. */
export function createWindowsNetworkHint(platform = process.platform) {
  let profiles: Promise<Record<string, string>> | undefined;
  let queriedAt = 0;
  return async (interfaceName?: string): Promise<string | undefined> => {
    if (platform !== "win32" || !interfaceName) return undefined;
    if (profiles && Date.now() - queriedAt > NETWORK_CACHE_MS) profiles = undefined;
    if (!profiles) queriedAt = Date.now();
    profiles ??= new Promise((resolve) => {
      execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; if ((Get-NetFirewallProfile -Name Public).Enabled) { $profiles = @{}; Get-NetConnectionProfile | ForEach-Object { $profiles[$_.InterfaceAlias] = [string]$_.NetworkCategory }; ConvertTo-Json -Compress -InputObject $profiles }",
        ],
        { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024, encoding: "buffer" },
        (error, stdout) => {
          if (error) return resolve({});
          try {
            // PowerShell emits one compact JSON line. Decode that line lossily.
            const newline = stdout.indexOf(10);
            const parsed: unknown = JSON.parse(
              stdout
                .subarray(0, newline < 0 ? stdout.length : newline)
                .toString("utf8")
                .replace(/^\uFEFF/, ""),
            );
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return resolve({});
            resolve(
              Object.fromEntries(
                Object.entries(parsed).filter(([, value]) => typeof value === "string"),
              ),
            );
          } catch {
            resolve({});
          }
        },
      );
    });
    return (await profiles)[interfaceName] === "Public" ? PUBLIC_NETWORK_HINT : undefined;
  };
}

export const windowsNetworkHint = createWindowsNetworkHint();
