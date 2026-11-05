/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  MAX_FOLDER_DEPTH,
  addSessionToFolder,
  arrangeFolderSessions,
  canMoveFolder,
  createFolderWithSessions,
  folderDepth,
  loadSessionFolders,
  moveFolder,
  rebaseSessionFolderSettings,
  removeSessionFromFolder,
  renameFolder,
  reorderSessionFolders,
  saveSessionFolders,
} from "../model/sessionFolders";
export type { FolderMoveTarget, SessionFolder } from "../model/sessionFolders";
