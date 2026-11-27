import { Heading } from "../../../shared/ui/Heading";
import { useT } from "../../../shared/i18n";
import { type ReactNode, useSyncExternalStore } from "react";
import { basename } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import { machineLabel, useRemoteMachines } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { looksLikeProject } from "../../projects/public/recents";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled } from "../../settings/public/settings";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { CrewScene } from "./crewSurface";
import { DraftProjectPicker } from "./DraftProjectPicker";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { BrandMark } from "../../../shared/ui/BrandMark";
import { isProjectlessCwd } from "../model/recentSessions";
import "./BycodaSession.css";

type Props = {
  cwd: string;
  composer?: ReactNode;
  hasChatBackground?: boolean;
  /** Draft sessions only: the heading becomes a project picker that retargets the session. */
  onProjectChange?: (path: string) => void;
  /** The machine of a remote draft, so its project picker lists that machine's projects. */
  environmentId?: string;
};

export function EmptySession({
  cwd,
  composer,
  hasChatBackground,
  onProjectChange,
  environmentId,
}: Props) {
  const t = useT();
  const hasProject = looksLikeProject(cwd) && !isProjectlessCwd(cwd);
  const remote = hasProject ? parseRemotePath(cwd) : null;
  const { machines } = useRemoteMachines(!!remote);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : undefined;
  const projectLocation = remote
    ? `${machine ? machineLabel(machines, machine) : t("Remote computer")} · ${remote.hostPath}`
    : cwd;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const crewEnabled = useSyncExternalStore(
    subscribeCrewSceneEnabled,
    loadCrewSceneEnabled,
    () => true,
  );
  const project = useSyncExternalStore(
    subscribeTabGroupLabels,
    () =>
      hasProject
        ? resolveTabGroupLabel(projectKey(cwd), loadTabGroupLabels(), basename(cwd))
        : null,
    () =>
      hasProject
        ? resolveTabGroupLabel(projectKey(cwd), loadTabGroupLabels(), basename(cwd))
        : null,
  );
  return (
    <div
      ref={lockOverscroll}
      className="bycoda-empty relative flex h-full min-h-0 overflow-y-auto overscroll-none"
    >
      {composer ? (
        // Same box as the docked composer (max-w-4xl, p-1.5), so the input
        // keeps its width when the first message docks it.
        // z-10: in-pane stacking above sibling layers; no in-pane layer scale exists, so the literal stays.
        <div
          data-popover-anchor-layout
          className="bycoda-entry-workbench pointer-events-none relative z-(--layer-pane-sheet) mx-auto flex w-full flex-1 flex-col"
        >
          <div className="bycoda-entry-heading">
            <div className="bycoda-wordmark" role="img" aria-label={PRODUCT_IDENTITY.displayName}>
              <BrandMark />
              <BrandMark variant="wordmark" className="bycoda-brand-lettering" />
            </div>
            {onProjectChange ? (
              <div className="bycoda-task-brief pointer-events-auto">
                <Heading size="page">
                  <DraftProjectPicker
                    cwd={hasProject ? cwd : ""}
                    environmentId={environmentId}
                    onProjectChange={onProjectChange}
                  />
                </Heading>
                {project ? <p className="bycoda-task-path">{projectLocation}</p> : null}
              </div>
            ) : project ? (
              <div className="bycoda-task-brief pointer-events-auto">
                <Heading size="page">{project}</Heading>
                <p className="bycoda-task-path">{projectLocation}</p>
              </div>
            ) : null}
          </div>

          <div className="bycoda-entry-composer pointer-events-auto w-full">{composer}</div>
          {crewEnabled && !hasChatBackground ? <CrewScene /> : null}
        </div>
      ) : null}
    </div>
  );
}
