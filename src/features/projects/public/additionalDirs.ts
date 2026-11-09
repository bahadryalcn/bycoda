/** Public projects contract; exports stay explicit to preserve load isolation. */
export {
  additionalDirsForSession,
  loadAdditionalDirs,
  loadSessionAdditionalDirs,
  removeSessionAdditionalDirs,
  saveSessionAdditionalDirs,
  subscribeSessionAdditionalDirs,
} from "../model/additionalDirs";
