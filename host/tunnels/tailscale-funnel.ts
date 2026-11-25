import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { FUNNEL_PORTS } from "../../src/integrations/external-tunnels";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";

export async function tailscaleExecutable(): Promise<string | undefined> {
  const executable = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  const candidates = [
    ...(process.platform === "win32"
      ? [join(process.env.ProgramFiles ?? "C:\Program Files", "Tailscale", executable)]
      : [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          "/usr/local/bin/tailscale",
          "/opt/homebrew/bin/tailscale",
          "/usr/bin/tailscale",
        ]),
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .map((directory) => directory.replace(/^"|"$/g, ""))
      .filter(Boolean)
      .map((directory) => join(directory, executable)),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next native binary. */
    }
  }
  return undefined;
}

type ObjectValue = Record<string, unknown>;
const objectValue = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};

/**
 * The first Funnel port the user's Serve/Funnel configuration does not already use, or
 * undefined when all three are taken. Existing configuration is only read, never changed.
 */
export function availableFunnelPort(value: unknown): number | undefined {
  const config = objectValue(value);
  const tcp = objectValue(config.TCP);
  const webKeys = Object.keys(objectValue(config.Web));
  const funnelKeys = Object.keys(objectValue(config.AllowFunnel));
  return FUNNEL_PORTS.find(
    (port) =>
      !(String(port) in tcp) &&
      !webKeys.some((key) => key.endsWith(`:${port}`)) &&
      !funnelKeys.some((key) => key.endsWith(`:${port}`)),
  );
}

/** Reads the node's current Serve and Funnel configuration for the port choice. */
export async function readServeConfig(program: string): Promise<unknown> {
  const { stdout } = await execFileAsync(program, ["serve", "status", "--json"], {
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 512 * 1024,
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : {};
}
