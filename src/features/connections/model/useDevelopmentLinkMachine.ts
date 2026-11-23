import { useRemoteMachines } from "./connections";
import { machineLabel } from "./machineIdentity";
import { parseRemotePath } from "./remoteProjects";
import { isHostDevelopmentUrl } from "./workspaceUrls";

/** Saved machine label for a private development link in its owning conversation. */
export function useDevelopmentLinkMachine(cwd?: string, href?: string): string | undefined {
  const owner = cwd && parseRemotePath(cwd)?.environmentId;
  const enabled = Boolean(owner && href && isHostDevelopmentUrl(href));
  const { machines } = useRemoteMachines(enabled);
  const machine = enabled && machines.find((entry) => entry.environmentId === owner);
  return machine ? machineLabel(machines, machine) : undefined;
}
