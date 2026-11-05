import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import type { HarnessId } from "../../sessions/model/session";
import { t } from "../../../shared/i18n";
import { useTaskMachineProjects } from "./TaskFormFields";

/** The machine a draft targets: the one the owner chose, else the machine that
 * owns the project, else this computer. Nothing writes this default back into
 * the draft; every reader resolves it through here. */
export function resolveTaskMachineId(
  machines: readonly RemoteMachine[],
  cwd: string,
  machineId?: string,
): string {
  return (
    machineId ??
    backgroundMachineFor(machines, cwd)?.id ??
    machines.find(isLocalSyncMachine)?.id ??
    ""
  );
}

/** Machine and project choices shared by the task and goal forms. `cwd` is the
 * draft's first project; `discover` turns host project discovery on or off. */
export function useTaskTargetMachine({
  machines,
  machineId,
  cwd,
  discover = true,
}: {
  machines: RemoteMachine[];
  machineId?: string;
  cwd: string;
  discover?: boolean;
}) {
  const lock = useLockSnapshot();
  const targetId = resolveTaskMachineId(machines, cwd, machineId);
  const target = machines.find((entry) => entry.id === targetId);
  const projectState = useTaskMachineProjects(target, discover);
  const usable = (path: string, id: string) =>
    looksLikeProject(path) &&
    !isProjectLockedIn(lock, path) &&
    backgroundMachineFor(machines, path)?.id === id;
  /** Account to preselect for `harness`; only this computer has local accounts. */
  const defaultAccountFor = (harness: HarnessId, id = targetId) =>
    machines.some((entry) => entry.id === id && isLocalSyncMachine(entry)) &&
    supportsProviderAccounts(harness)
      ? defaultProviderAccountId(harness)
      : undefined;
  return {
    targetId,
    target,
    projectState,
    machineOptions: machines.map((entry) => ({
      value: entry.id,
      label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
    })),
    defaultAccountFor,
    /** Recent and discovered projects that belong to the target machine. */
    projectChoices: (
      recents: readonly RecentProject[],
      { include, exclude }: { include?: string; exclude?: readonly string[] } = {},
    ) =>
      [
        ...(include === undefined ? [] : [{ path: include, openedAt: 0 }]),
        ...recents,
        ...projectState.projects,
      ].filter(
        (entry, index, entries) =>
          usable(entry.path, targetId) &&
          !exclude?.includes(entry.path) &&
          entries.findIndex((other) => other.path === entry.path) === index,
      ),
    /** The first recent project of `id`, for when the owner switches machine. */
    firstProjectOn: (recents: readonly RecentProject[], id: string) =>
      recents.find((entry) => usable(entry.path, id))?.path ?? "",
  };
}
