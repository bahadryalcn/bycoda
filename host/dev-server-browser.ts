import { isIP } from "node:net";
import { execFileAsync } from "../src/shared/lib/processExecution.node";

/** Open the OS browser on the owning host. Remote loopback is never local loopback. */
export async function openDevServerBrowser(
  input: string,
  platform = process.platform,
  run = execFileAsync,
) {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (!isIP(hostname) && hostname !== "localhost")
  )
    throw new Error("Choose a discovered development server URL");
  const [file, args] =
    platform === "win32"
      ? (["rundll32.exe", ["url.dll,FileProtocolHandler", url.href]] as const)
      : platform === "darwin"
        ? (["open", [url.href]] as const)
        : (["xdg-open", [url.href]] as const);
  await run(file, [...args], { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 });
  return { url: url.href };
}
