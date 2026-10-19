import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { RemoteMachine } from "./protocol";
import { adoptRemoteMachineInventory } from "./connections";
import type { SshInheritance } from "./sshGroupDefaults";

export type SshJumpPolicy = {
  host: string;
  user?: string;
  port: number;
  identityFile?: string;
  certificateFile?: string;
  knownHostsFile?: string;
};
export type SshEndpoint = {
  host: string;
  user?: string;
  port: number;
  identityFile?: string;
  certificateFile?: string;
  jumpHost?: string;
  jumpHosts?: string[];
  jumpPolicies?: SshJumpPolicy[];
  /** Explicit HTTP CONNECT upstream. Credentials are never saved in this record. */
  httpProxy?: { host: string; port: number; scheme?: "http" | "https" };
};
export type ForwardRule = {
  id: string;
  name: string;
  /** Absent on existing records: a loopback local forward. */
  kind?: "local" | "dynamic";
  localPort: number;
  targetHost: string;
  targetPort: number;
};
export type ServerMetadata = {
  sshInheritance?: SshInheritance;
  group?: string;
  tags: string[];
  favorite: boolean;
  lastUsedAt?: number;
  forwards?: ForwardRule[];
  activity?: ServerActivity[];
};
export type ServerActivity = {
  id: string;
  at: number;
  kind: "terminal-opened";
  bookmarked: boolean;
};
export type ServerRecord = {
  id: string;
  name: string;
  kind: "host" | "ssh";
  machine?: RemoteMachine;
  sshEndpoint?: SshEndpoint;
  /** Current inherited destination; sshEndpoint retains the editable base overrides. */
  effectiveSshEndpoint?: SshEndpoint;
  metadata: ServerMetadata;
};
const CHANGE = "bycoda:server-inventory";
const HOST_CHANGE = "bycoda:remote-machines";
export const refreshServerInventory = () => window.dispatchEvent(new Event(CHANGE));
export async function saveSshConnection(input: {
  id?: string;
  name: string;
  endpoint: SshEndpoint;
  importOnly?: boolean;
}): Promise<ServerRecord> {
  const result = await invoke<ServerRecord>("server_ssh_save", { ...input, id: input.id ?? null });
  refreshServerInventory();
  return result;
}
/** Save a key binding without replacing endpoint or organization fields. */
export async function setServerSshIdentity(
  id: string,
  identityFile?: string,
): Promise<ServerRecord> {
  const result = await invoke<ServerRecord>("server_ssh_identity_set", {
    id,
    identityFile: identityFile ?? null,
  });
  refreshServerInventory();
  return result;
}
export async function updateServerMetadata(
  id: string,
  metadata: Partial<ServerMetadata>,
): Promise<void> {
  await invoke("server_metadata_update", { id, metadata });
  refreshServerInventory();
}
export async function removeSshConnection(id: string): Promise<void> {
  await invoke("server_ssh_remove", { id });
  refreshServerInventory();
}
export async function bookmarkServerActivity(
  id: string,
  eventId: string,
  bookmarked: boolean,
): Promise<void> {
  await invoke("server_activity_bookmark", { id, eventId, bookmarked });
  refreshServerInventory();
}
export function useServerInventory() {
  const [state, setState] = useState<{
    servers: ServerRecord[];
    loaded: boolean;
    loading: boolean;
    error?: string;
  }>({ servers: [], loaded: false, loading: true });
  useEffect(() => {
    let disposed = false;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      setState((previous) => ({ ...previous, loading: true }));
      void invoke<ServerRecord[]>("server_inventory_list")
        .then((servers) => {
          if (!disposed && current === version) {
            adoptRemoteMachineInventory(
              servers.flatMap((server) => (server.machine ? [server.machine] : [])),
            );
            setState({ servers, loaded: true, loading: false });
          }
        })
        .catch((error) => {
          if (!disposed && current === version)
            setState((previous) => ({ ...previous, loading: false, error: String(error) }));
        });
    };
    refresh();
    window.addEventListener(CHANGE, refresh);
    window.addEventListener(HOST_CHANGE, refresh);
    const native = listen("server-inventory-changed", refresh).catch(() => undefined);
    return () => {
      disposed = true;
      void native.then((unlisten) => unlisten?.());
      window.removeEventListener(CHANGE, refresh);
      window.removeEventListener(HOST_CHANGE, refresh);
    };
  }, []);
  return { ...state, refresh: refreshServerInventory };
}
