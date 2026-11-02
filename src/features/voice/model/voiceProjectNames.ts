import { projectKey, projectName } from "../../../shared/lib/paths";
import { loadTabGroupLabels } from "../../workspace/model/tabGroups";
import { projectDisplayName } from "../../projects/model/projectNames";
import { sameProjectPath } from "../../projects/model/recents";
import type { VoiceWorkspaceProject } from "./voiceWorkspaceActions";

/** Only project paths supplied by the current visible/unlocked directory enter here. */
export function voiceProjectNames(projects: readonly VoiceWorkspaceProject[]): VoiceWorkspaceProject[] {
  const labels = loadTabGroupLabels();
  return projects.map(project => {
    const folderName = projectName(project.path);
    const name = labels[projectKey(project.path)]?.trim()
      ? projectDisplayName(project.path, labels)
      : project.name?.trim() || folderName;
    return { ...project, name, folderName, aliases: [...new Set([name, folderName])] };
  });
}

/** A name discovers candidates; only an exact canonical path targets an action. */
export function resolveVoiceProjects(projects: readonly VoiceWorkspaceProject[], query: string) {
  const key = query.trim().toLocaleLowerCase();
  const exact = projects.filter(project => sameProjectPath(project.path, query));
  const matches = exact.length ? exact : projects.filter(project =>
    [project.name, project.folderName, ...(project.aliases ?? [])].some(name => name?.trim().toLocaleLowerCase() === key),
  );
  return { projects: matches.slice(0, 200), ambiguous: matches.length > 1, total: matches.length, truncated: matches.length > 200 };
}
