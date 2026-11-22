import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";

/** The paired Host and registered project that own a remote configuration. */
export type RemoteMcpConfigTarget = {
  machineId: string;
  environmentId?: string;
  projectId?: string;
};

export function invokeMcpConfig<T>(
  command: string,
  params: Record<string, unknown>,
  remote?: RemoteMcpConfigTarget,
  refresh = false,
): Promise<T> {
  if (!remote) return invoke<T>(command, params);
  const { cwd: _cwd, globalOnly: _globalOnly, ...args } = params;
  const request = {
    projectId: remote.projectId,
    command,
    args,
  };
  const mutation =
    command !== "mcp_discover" &&
    command !== "mcp_server_config_read" &&
    command !== "codex_mcp_list";
  return remoteRequest<T>(
    remote.machineId,
    "mcp.config.call",
    request,
    refresh,
    mutation || refresh,
    remote.environmentId,
  );
}
