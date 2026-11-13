import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withTimeout } from "../../../src/shared/lib/withTimeout";

/** Resolve only the stable Chrome default user-data directory, never enumerate profiles. */
export function chromeDiscoveryFile(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  if (platform === "win32") {
    if (!env.LOCALAPPDATA) throw new Error("Chrome discovery is unavailable on this host.");
    return join(env.LOCALAPPDATA, "Google", "Chrome", "User Data", "DevToolsActivePort");
  }
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort");
  if (platform === "linux")
    return join(
      env.CHROME_CONFIG_HOME || env.XDG_CONFIG_HOME || join(home, ".config"),
      "google-chrome",
      "DevToolsActivePort",
    );
  throw new Error("Chrome discovery is unsupported on this host.");
}

/** The endpoint is a local secret. Never expose it through RPC, errors, or logs. */
export function discoverChromeEndpoint(file = chromeDiscoveryFile()): Promise<string> {
  return withTimeout(readChromeEndpoint(file), 3000, "Chrome discovery");
}

async function readChromeEndpoint(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(1025);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 1024) throw new Error("invalid");
    const [port, path, ...extra] = buffer
      .subarray(0, bytesRead)
      .toString("ascii")
      .trim()
      .split(/\r?\n/);
    if (
      !/^\d{1,5}$/.test(port ?? "") ||
      Number(port) < 1 ||
      Number(port) > 65535 ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path ?? "") ||
      extra.length
    )
      throw new Error("invalid");
    return `ws://127.0.0.1:${Number(port)}${path}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM")
      throw new Error("Permission to read Chrome discovery was denied.");
    throw new Error(
      "Chrome session unavailable. Enable remote debugging in chrome://inspect/#remote-debugging and try again.",
    );
  } finally {
    await handle?.close();
  }
}
