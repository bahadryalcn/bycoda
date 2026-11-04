import { useSyncExternalStore } from "react";
import { projectKey, projectName } from "../../shared/lib/paths";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import {
  railBackgroundColor,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import {
  getSessionProjectAppearanceServerSnapshot,
  getSessionProjectAppearanceSnapshot,
  getSessionProjectBackground,
  subscribeSessionProjectAppearance,
} from "./sessionProjectAppearanceStore";

/** The same saved project identity as the rail, independent of the execution worktree. */
export function useSessionProjectAppearance(cwd: string) {
  const appearance = useSyncExternalStore(
    subscribeSessionProjectAppearance,
    getSessionProjectAppearanceSnapshot,
    getSessionProjectAppearanceServerSnapshot,
  );
  const key = projectKey(cwd);
  const seed = projectName(cwd);
  const color = resolveTabGroupColor(key, appearance.colors, appearance.customColors, seed);
  const logo = resolveTabGroupLogo(key, appearance.logos);
  return {
    name: resolveTabGroupLabel(key, appearance.labels, seed),
    backgroundColor: railBackgroundColor(getSessionProjectBackground(appearance, key)),
    icon: logo ? (
      <ProjectLogoIcon path={logo} className="icon-xs rounded-sm" imageClassName="icon-xs" />
    ) : (
      <ProjectMascot
        project={seed}
        color={color}
        name={resolveTabGroupMascot(key, appearance.mascots)}
        className="icon-xs"
      />
    ),
  };
}
