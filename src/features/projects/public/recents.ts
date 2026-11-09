/** Public projects contract; exports stay explicit to preserve load isolation. */
export {
  REMOTE_PROJECT_PREFIX,
  isLocalProject,
  isRemoteProjectPath,
  loadArchivedProjects,
  loadRecents,
  looksLikeProject,
  normalizeProjectPath,
  readArchivedProjects,
  rememberProject,
  rememberImportedProjects,
  sameProjectPath,
  subscribeArchivedProjects,
  subscribeProjectPathsChanged,
} from "../model/recents";
export type { RecentProject, ArchivedProject } from "../model/recents";
