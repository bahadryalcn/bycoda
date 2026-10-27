import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BuildIdentity } from "./workspace-contracts";

/** Development acceptance only. Capabilities can be hidden, never invented.
 * Re-read on every describe so a reconnect can exercise an older/newer Host
 * without restarting providers or modifying any installed Host state. */
export async function devAdvertisedCapabilities(
  capabilities: string[],
  identity: BuildIdentity | null,
  hostDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if (
    identity?.channel !== "dev" ||
    !env.BYCODA_DEV_PROFILE_ID ||
    !env.BYCODA_DEV_RUN_ID ||
    !env.BYCODA_DESKTOP_DATA_DIR ||
    !env.BYCODA_HOST_DIR ||
    resolve(env.BYCODA_HOST_DIR) !== resolve(hostDataPath)
  )
    return capabilities;

  let source: string;
  try {
    source = await readFile(join(hostDataPath, "dev-capabilities.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return capabilities;
    throw error;
  }
  const config: unknown = JSON.parse(source);
  if (
    !config ||
    typeof config !== "object" ||
    !("disabled" in config) ||
    !Array.isArray(config.disabled) ||
    !config.disabled.every((entry) => typeof entry === "string")
  )
    throw new Error("Development capabilities require { disabled: string[] }");
  const disabled = new Set(config.disabled);
  return capabilities.filter((capability) => !disabled.has(capability));
}
