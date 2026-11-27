/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  parseRemotePath,
  remotePath,
  remoteProjectsOn,
  remoteProjectFor,
  rememberRemoteProject,
} from "../model/remoteProjects";
export { useRemoteProjectsOn } from "../model/useRemoteProject";
