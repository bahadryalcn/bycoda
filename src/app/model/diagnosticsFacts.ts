import { invoke } from "@tauri-apps/api/core";
import type { EnvironmentFacts } from "../../features/diagnostics";
import { remoteRequest } from "../../features/connections/public/connections";
import { isLocalSyncMachine } from "../../features/connections/public/localSync";
import type { RemoteMachine } from "../../features/connections";
import { loadThemePreference } from "../../features/settings/model/appearance";
import { loadAppearancePreferences } from "../../features/settings/model/appearancePreferences";

/**
 * App-level facts for the diagnostic `ui-environment` section. Counts and setting names only:
 * no machine names, addresses, paths, project names or session titles.
 */
export function appDiagnosticsFacts(machines: readonly RemoteMachine[]): EnvironmentFacts {
  const local = machines.some(isLocalSyncMachine);
  return {
    theme: loadThemePreference(),
    density: loadAppearancePreferences().controlDensity,
    hostConnection: local ? "local" : "none",
    remoteHosts: machines.filter((machine) => !isLocalSyncMachine(machine)).length,
  };
}

/** The local Host's `resources.read` answer, or null when there is no local Host. */
export async function readLocalHostPerformance(): Promise<unknown> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  return machine ? remoteRequest(machine.id, "resources.read", {}) : null;
}

/** Connected remote Hosts (not this computer's own, whose files the native side reads). */
export const remoteHostLogSource = (machines: () => readonly RemoteMachine[]) => ({
  hosts: () =>
    machines()
      .filter((machine) => !isLocalSyncMachine(machine))
      .map((m) => m.id),
  request: (hostId: string, method: string) => remoteRequest(hostId, method, {}),
});
