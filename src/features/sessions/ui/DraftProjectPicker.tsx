import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { pickFolders } from "../../../platform/tauri/fs";
import { PROJECTLESS_SESSIONS_CAPABILITY } from "../../../shared/model/host-contracts/projectless-sessions";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  useRemoteMachines,
} from "../../connections/public/connections";
import { pickFolderOnMachine } from "../../connections/public/machineFolderPick";
import { parseRemotePath, useRemoteProjectsOn } from "../../connections/public/remoteProjects";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { isLocalProject, useRecents, type RecentProject } from "../../projects/public/recents";

/** The projects of one machine: those on the rail and those the machine's registry remembers. */
function machineProjects(
  environmentId: string,
  recents: readonly RecentProject[],
  remembered: readonly { key: string }[],
): RecentProject[] {
  const projects = new Map<string, RecentProject>();
  for (const item of recents)
    if (parseRemotePath(item.path)?.environmentId === environmentId) projects.set(item.path, item);
  for (const project of remembered)
    if (!projects.has(project.key)) projects.set(project.key, { path: project.key, openedAt: 0 });
  return [...projects.values()];
}

/**
 * The folder the owner picks for the draft: through the machine's folder browser for a remote
 * draft, the native dialog otherwise. Undefined when cancelled or the folder belongs elsewhere;
 * "not-local" for a local folder that cannot be a project. Outside the component so its throw
 * stays out of render code.
 */
async function pickProjectPath(
  environmentId: string | undefined,
  machineId: string | undefined,
  title: string,
): Promise<string | "not-local" | undefined> {
  if (environmentId) {
    if (!machineId) throw new Error("The machine is not connected.");
    const key = await pickFolderOnMachine({ kind: "remote", machineId });
    return key && parseRemotePath(key)?.environmentId === environmentId ? key : undefined;
  }
  const [path] = await pickFolders(title, false);
  if (!path) return undefined;
  return isLocalProject(path) ? path : "not-local";
}

/**
 * The project of a draft session, chosen from its heading: known projects, "Add project…" and
 * "No project" (a scratch workspace). With `environmentId` the draft lives on that machine: it
 * lists that machine's projects, adds a project through the machine's folder browser and offers
 * "No project" only when the machine's Host supports projectless sessions.
 * @use The hero heading of a blank session that may still change project.
 * @avoid Started sessions: their project is fixed.
 */
export function DraftProjectPicker({
  cwd,
  environmentId,
  onProjectChange,
}: {
  cwd: string;
  /** The machine of a remote draft; absent for a draft on this computer. */
  environmentId?: string;
  onProjectChange: (path: string) => void;
}) {
  const t = useT();
  const recents = useRecents();
  const remembered = useRemoteProjectsOn(environmentId);
  const [problem, setProblem] = useState<string>();
  const { machines } = useRemoteMachines(!!environmentId);
  const machineId = environmentId
    ? machines.find((machine) => machine.environmentId === environmentId)?.id
    : undefined;
  const [scratchEnvironment, setScratchEnvironment] = useState<string>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- learn whether the machine's Host offers sessions without a project
  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    void loadRemoteCapabilities(environmentId)
      .then((capabilities) => {
        if (live && capabilities?.includes(PROJECTLESS_SESSIONS_CAPABILITY))
          setScratchEnvironment(environmentId);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [environmentId]);
  const remoteScratch =
    !!environmentId &&
    (scratchEnvironment === environmentId ||
      !!cachedRemoteCapabilities(environmentId)?.includes(PROJECTLESS_SESSIONS_CAPABILITY));
  const addProject = async () => {
    setProblem(undefined);
    try {
      const picked = await pickProjectPath(environmentId, machineId, t("Add project…"));
      if (picked === "not-local")
        setProblem(t("Choose a local project folder rather than your home or drive root."));
      else if (picked) onProjectChange(picked);
    } catch {
      setProblem(t("Could not open the folder picker. Please try again."));
    }
  };
  return (
    <>
      <SearchableProjectPicker
        cwd={cwd}
        recents={environmentId ? machineProjects(environmentId, recents, remembered) : recents}
        localOnly={!environmentId}
        chooseLabel={t("Choose project")}
        actionLabel={t("Switch project")}
        buttonClassName="[font:inherit]"
        onSelectProject={onProjectChange}
        onOpenProject={environmentId && !machineId ? undefined : () => void addProject()}
        openProjectLabel={t("Add project…")}
        onSelectNoProject={!environmentId || remoteScratch ? () => onProjectChange("~") : undefined}
      />
      {problem ? (
        <InlineError live="off" className="pointer-events-auto">
          {problem}
        </InlineError>
      ) : null}
    </>
  );
}
