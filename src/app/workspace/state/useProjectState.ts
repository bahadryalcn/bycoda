import { useMemo, useState } from "react";
import { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { visibleProjects } from "../../../features/group-lock/model/lockState";
import {
  lastProjectPath,
  loadRecents,
  looksLikeProject,
  rememberProject,
} from "../../../features/projects/model/recents";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ResumedWorkspace } from "../../model/appLifecycle";

export interface ProjectStateDeps {
  toolWindow: ToolWindow | null;
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
}

/** Current project folder, the recents list and the group-lock filtered view. */
export function useProjectState({ toolWindow, windowTransfer, resumed }: ProjectStateDeps) {
  const [projectCwd, setProjectCwd] = useState(
    () =>
      toolWindow?.cwd ??
      windowTransfer?.projectCwd ??
      resumed?.projectCwd ??
      lastProjectPath() ??
      "~",
  );
  const [recents, setRecents] = useState(() =>
    resumed?.projectCwd && looksLikeProject(resumed.projectCwd)
      ? rememberProject(resumed.projectCwd)
      : loadRecents(),
  );
  // What is not behind a locked group. The rail itself gets the full list, so
  // it can keep the saved order and pins of projects that are hidden.
  const lockSnapshot = useLockSnapshot();
  const visibleRecents = useMemo(
    () => visibleProjects(lockSnapshot, recents, (project) => project.path),
    [lockSnapshot, recents],
  );
  return { projectCwd, setProjectCwd, recents, setRecents, lockSnapshot, visibleRecents };
}
