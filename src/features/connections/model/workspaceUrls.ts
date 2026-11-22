import { invoke } from "@tauri-apps/api/core";
import { openExternal } from "../../../platform/tauri/openExternal";
import { featureHost } from "./hostFeatureClient";
import { remoteRequest, remoteSessionFor } from "./connections";
import { parseRemotePath } from "./remoteProjects";
import type { DevServer, DevServerEndpoint, DevServerScan } from "../../host-tools/devServerTypes";

function developmentHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$|\.$/g, "");
}

function isLoopbackDevelopmentHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    ["::1", "::", "0.0.0.0"].includes(host) ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function loopbackUrl(url: URL): string {
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  return url.href;
}

export function isHostDevelopmentUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = developmentHostname(url);
    return (
      isLoopbackDevelopmentHost(host) ||
      /^10(?:\.\d{1,3}){3}$/.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(host) ||
      /^192\.168(?:\.\d{1,3}){2}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host) ||
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
  if (!parseRemotePath(cwd)) return loopbackUrl(url);
  const { machine, projectId } = await featureHost(cwd, "dev.servers.private-access");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  let match = selected;
  if (!match) {
    const scan = await remoteRequest<DevServerScan>(machine.id, "devServers.list", { projectId });
    if (scan.status !== "ok") throw new Error(scan.error || "Development server discovery failed.");
    const host = developmentHostname(url);
    const loopback = isLoopbackDevelopmentHost(host);
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

/**
 * Opens a private remote chat link on the project's Host. The transcript's
 * composer ID resolves to a Host session, which owns the browser page.
 */
export async function openWorkspaceUrl(
  cwd: string | undefined,
  input: string,
  composerSessionId?: string,
) {
  if (!cwd || !isHostDevelopmentUrl(input)) return openExternal(input);

  const url = new URL(input);
  if (url.username || url.password)
    throw new Error("Choose an HTTP or HTTPS development server URL without credentials.");
  if (parseRemotePath(cwd)) {
    const sessionId = composerSessionId ? remoteSessionFor(composerSessionId) : undefined;
    const missingSession = "Open a session on this Host before using project tools.";
    if (composerSessionId && !sessionId) throw new Error(missingSession);
    await featureHost(cwd, "browser.shared");
    const { openHostToolsWindow } = await import("../../host-tools/ToolsWorkspace");
    if (composerSessionId && remoteSessionFor(composerSessionId) !== sessionId)
      throw new Error(missingSession);
    const initialUrl = loopbackUrl(url);
    await openHostToolsWindow({
      cwd,
      sessionId: sessionId ?? "",
      composerSessionId,
      title: url.host,
      initialTab: "browser",
      initialMachine: "project",
      initialUrl,
    });
    return;
  }
  await openExternal(await accessibleDevelopmentUrl(cwd, input));
}
