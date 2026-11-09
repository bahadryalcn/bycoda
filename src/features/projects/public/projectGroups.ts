/** Public projects contract; exports stay explicit to preserve load isolation. */
export {
  assignProjectsToNamedGroup,
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupWorkspaceRoot,
} from "../model/projectGroups";
export type { ProjectGroup } from "../model/projectGroups";
