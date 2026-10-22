import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { featureHost } from "./hostFeatureClient";
import { remoteRequest } from "./connections";
import { parseRemotePath } from "./remoteProjects";
import type { DevServer, DevServerEndpoint, DevServerScan } from "../../host-tools/devServerTypes";

export function isHostDevelopmentUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      host === "::" ||
      host === "0.0.0.0" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^(fc|fd)[a-f0-9]{2}:/.test(host)
    );
  } catch {
    return false;
  }
}

/** Returns a URL on the viewing computer; saved owner identity is never guessed from a hostname. */
export async function accessibleDevelopmentUrl(
  cwd: string,
  input: string,
  selected?: { server: DevServer; endpoint: DevServerEndpoint },
): Promise<string> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Choose an HTTP or HTTPS development server URL.");
  if (!parseRemotePath(cwd)) {
    if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
    if (url.hostname === "[::]") url.hostname = "[::1]";
    return url.href;
  }
  const { machine, projectId } = await featureHost(cwd, "dev.servers.private-access");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  let match = selected;
  if (!match) {
    const scan = await remoteRequest<DevServerScan>(machine.id, "devServers.list", { projectId });
    if (scan.status !== "ok") throw new Error(scan.error || "Development server discovery failed.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const loopback =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.startsWith("127.") ||
      ["::1", "::", "0.0.0.0"].includes(host);
    const matches = scan.servers
      .filter((server) => server.projectId === projectId && server.association !== "uncertain")
      .flatMap((server) =>
        server.endpoints
          .filter(
            (endpoint) =>
              endpoint.port === port &&
              (loopback
                ? ["0.0.0.0", "::", "::1"].includes(endpoint.address) ||
                  endpoint.address.startsWith("127.")
                : endpoint.address === host),
          )
          .map((endpoint) => ({ server, endpoint })),
      );
    if (!matches.length)
      throw new Error(
        "No running development server in this project matches the link. Open Development servers and refresh.",
      );
    // Duplicate IPv4/IPv6 listeners of one process are equivalent; different processes are not.
    if (new Set(matches.map((entry) => entry.server.id)).size > 1)
      throw new Error(
        "More than one development server matches this link. Choose its endpoint in Development servers.",
      );
    match = matches[0];
  }
  if (!match.server.process || match.server.projectId !== projectId || match.endpoint.port !== port)
    throw new Error(
      "The development server must belong to this project and its process identity must match.",
    );
  return await invoke<string>("remote_dev_server_url", {
    machineId: machine.id,
    environmentId: machine.environmentId,
    projectId,
    serverId: match.server.id,
    identity: { pid: match.server.process.pid, startedAt: match.server.process.startedAt },
    port: match.endpoint.port,
    address: match.endpoint.address,
    url: input,
  });
}

export async function openWorkspaceUrl(cwd: string | undefined, input: string) {
  if (
    cwd &&
    parseRemotePath(cwd) &&
    isHostDevelopmentUrl(input) &&
    new URL(input).protocol === "https:"
  ) {
    await featureHost(cwd, "browser.shared");
    const { openHostToolsWindow } = await import("../../host-tools/ToolsWorkspace");
    await openHostToolsWindow({
      cwd,
      sessionId: "",
      title: new URL(input).host,
      initialTab: "browser",
      initialUrl: input,
    });
    return;
  }
  const url =
    cwd && isHostDevelopmentUrl(input) ? await accessibleDevelopmentUrl(cwd, input) : input;
  await openUrl(url);
}
