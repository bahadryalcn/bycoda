import type { HostProject, HostProjectDirectory } from "../src/features/connections/model/protocol";
import { normalizeProjectPath } from "./desktopSessions";

/** Display metadata never changes registration, execution cwd or authority. */
export function projectDisplayNames(
  registered: readonly HostProject[],
  directory: HostProjectDirectory,
): HostProject[] {
  const visible = new Map(
    directory.privacyReady ? directory.projects.map((project) => [project.id, project]) : [],
  );
  return registered.map((project) => {
    const display = visible.get(project.id);
    return display && normalizeProjectPath(display.cwd) === normalizeProjectPath(project.cwd)
      ? { ...project, name: display.name }
      : { ...project };
  });
}
