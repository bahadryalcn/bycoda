/** Public projects contract; exports stay explicit to preserve load isolation. */
export {
  additionalDirsForSession,
  loadAdditionalDirs,
  loadSessionAdditionalDirs,
  removeSessionAdditionalDirs,
  saveSessionAdditionalDirs,
  subscribeSessionAdditionalDirs,
  useSessionAdditionalDirs,
} from "../model/additionalDirs";
