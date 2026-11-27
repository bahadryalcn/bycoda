/** Public projects contract; exports stay explicit to preserve load isolation. */
export {
  assignProjectsToNamedGroup,
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupIncludesWorkspaceRoot,
  projectGroupWorkspaceRoot,
  reorderProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../model/projectGroups";
export type { ProjectGroup } from "../model/projectGroups";
