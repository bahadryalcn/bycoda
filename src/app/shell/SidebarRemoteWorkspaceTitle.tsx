import { useT } from "../../shared/i18n";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import type { RemoteProjectSessions } from "../../features/connections/model/connections";
import { RemoteDataStatus } from "../../features/connections/ui/RemoteDataStatus";

/** The same machine action accompanies both the title and the retained project picker. */
export function SidebarRemoteWorkspaceStatus({
  cwd,
  remote,
  connectionIssueHandled,
}: {
  cwd: string;
  remote: RemoteProjectSessions;
  connectionIssueHandled: boolean;
}) {
  const t = useT();
  return (
    <RemoteDataStatus
      cwd={cwd}
      presentation="indicator"
      state={remote.dataState}
      machineName={remote.machine?.name ?? parseRemotePath(cwd)?.environmentId ?? t("Remote")}
      connectionIssueHandled={connectionIssueHandled}
      label={remote.machine ? t("sessions from {p0}", { p0: remote.machine.name }) : t("sessions")}
      onRefresh={remote.refresh}
      disabled={!remote.machine && !remote.dataState.error}
    />
  );
}
