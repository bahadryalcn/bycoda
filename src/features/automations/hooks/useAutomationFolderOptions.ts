import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getLocale, t } from "../../../shared/i18n";
import {
  loadSessionFolders,
  subscribeSessionFolders,
  type SessionFolder,
} from "../../sessions/model/sessionFolders";

// `loadSessionFolders` returns a fresh clone per call, so the store snapshot
// is cached per project and replaced only when the stored folders change.
const snapshots = new Map<string, SessionFolder[]>();

function folderSnapshot(cwd: string): SessionFolder[] {
  let snapshot = snapshots.get(cwd);
  if (!snapshot) {
    snapshot = loadSessionFolders(cwd);
    snapshots.set(cwd, snapshot);
  }
  return snapshot;
}

function refreshSnapshot(cwd: string) {
  const next = loadSessionFolders(cwd);
  const previous = snapshots.get(cwd);
  if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) snapshots.set(cwd, next);
}

function subscribeFolders(cwd: string, onChange: () => void): () => void {
  // Writes made while nothing listened are picked up here.
  refreshSnapshot(cwd);
  const unsubscribe = subscribeSessionFolders(cwd, () => {
    refreshSnapshot(cwd);
    onChange();
  });
  return () => {
    unsubscribe();
    snapshots.delete(cwd);
  };
}

export type FolderOption = { value: string; label: string; keywords?: string };

/**
 * Session-folder choices for an automation's project: "None", the project's
 * folders and, when the draft points at a folder that no longer exists, a
 * "Removed folder" entry so the stored id stays visible.
 */
export function useAutomationFolderOptions(
  cwd: string,
  sessionFolderId: string | undefined,
): FolderOption[] {
  const subscribe = useCallback((onChange: () => void) => subscribeFolders(cwd, onChange), [cwd]);
  const getSnapshot = useCallback(() => folderSnapshot(cwd), [cwd]);
  const sessionFolders = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Labels are read lazily; a locale change still replaces the array.
  const locale = getLocale();
  return useMemo(() => {
    const options: FolderOption[] = [
      {
        value: "",
        get label() {
          return t("None");
        },
      },
      ...sessionFolders.map((folder) => ({
        value: folder.id,
        label: folder.name,
        keywords: folder.name,
      })),
    ];
    if (sessionFolderId && !sessionFolders.some((folder) => folder.id === sessionFolderId)) {
      options.push({
        value: sessionFolderId,
        get label() {
          return t("Removed folder");
        },
        keywords: sessionFolderId,
      });
    }
    return options;
  }, [locale, sessionFolderId, sessionFolders]);
}
