import { useEffect, useState } from "react";
import { projectKey, projectName } from "../../shared/lib/paths";
import { subscribeProjectPathsChanged } from "../../features/projects/model/recents";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  loadRailBackgrounds,
  railBackgroundColor,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";

/** The same saved project identity as the rail, independent of the execution worktree. */
export function useSessionProjectAppearance(cwd: string) {
  const [, refresh] = useState(0);
  useEffect(() => subscribeProjectPathsChanged(() => refresh((value) => value + 1)), []);
  const logos = useTabGroupLogos();
  const key = projectKey(cwd);
  const seed = projectName(cwd);
  const color = resolveTabGroupColor(key, loadTabGroupColors(), loadTabGroupCustomColors(), seed);
  const logo = resolveTabGroupLogo(key, logos);
  return {
    name: resolveTabGroupLabel(key, loadTabGroupLabels(), seed),
    backgroundColor: railBackgroundColor(loadRailBackgrounds(key).header),
    icon: logo ? (
      <ProjectLogoIcon path={logo} className="icon-xs rounded-sm" imageClassName="icon-xs" />
    ) : (
      <ProjectMascot
        project={seed}
        color={color}
        name={resolveTabGroupMascot(key, loadTabGroupMascots())}
        className="icon-xs"
      />
    ),
  };
}
