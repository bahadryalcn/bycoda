import type { ReactNode } from "react";
import { useT } from "../../shared/i18n";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import type { RemoteProjectSessions } from "../../features/connections/model/connections";
import { RemoteDataStatus } from "../../features/connections/ui/RemoteDataStatus";
import { Text } from "../../shared/ui/Text";
import { useSessionProjectAppearance } from "./useSessionProjectAppearance";

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

/** Remote projects keep the rail identity, with machine and freshness beside it. */
export function SidebarRemoteWorkspaceTitle(props: { cwd: string; status: ReactNode }) {
  const project = useSessionProjectAppearance(props.cwd);
  return (
    <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region="false">
      <span className="inline-flex shrink-0" aria-hidden>
        {project.icon}
      </span>
      <Text size="inherit" weight="medium" tone="inherit" truncate>
        {project.name}
      </Text>
      {props.status}
    </div>
  );
}
