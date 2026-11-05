/** Public files contract; exports stay explicit to preserve load isolation. */
export {
  invalidateProjectFiles,
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  resolveFileOpenRequest,
  subscribeProjectFiles,
} from "../model/fileIndex";
