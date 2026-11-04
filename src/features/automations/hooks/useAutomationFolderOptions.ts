import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getLocale, t } from "../../../shared/i18n";
import {
  loadSessionFolders,
  subscribeSessionFolders,
  type SessionFolder,
} from "../../sessions/model/sessionFolders";
import { organizationFoldersForProject } from "../../sessions/model/sessionOrganizationOperations";
import { cachedSessionOrganization, NATIVE_SESSION_ORGANIZATION_ACTIVE, subscribeSessionOrganization } from "../../sessions/model/sessionOrganizationStore";

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
): { options: FolderOption[]; loading: boolean; error: string | null } {
  const subscribe = useCallback((onChange: () => void) => subscribeFolders(cwd, onChange), [cwd]);
  const getSnapshot = useCallback(() => folderSnapshot(cwd), [cwd]);
  const legacyFolders = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [native, setNative] = useState<{ cwd: string; folders: SessionFolder[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) return;
    setNative(null);
    return subscribeSessionOrganization(() => {
      const snapshot = cachedSessionOrganization();
      if (!snapshot) return;
      try { setNative({ cwd, folders: organizationFoldersForProject(snapshot, cwd), error: null }); }
      catch (error) { setNative((previous) => ({ cwd, folders: previous?.cwd === cwd ? previous.folders : [], error: String(error) })); }
    }, (error) => setNative((previous) => ({ cwd, folders: previous?.cwd === cwd ? previous.folders : [], error: String(error) })));
  }, [cwd]);
  const loading = NATIVE_SESSION_ORGANIZATION_ACTIVE && (!native || native.cwd !== cwd);
  const error = NATIVE_SESSION_ORGANIZATION_ACTIVE && native?.cwd === cwd ? native.error : null;
  const sessionFolders = NATIVE_SESSION_ORGANIZATION_ACTIVE ? (native?.cwd === cwd ? native.folders : []) : legacyFolders;
  // Labels are read lazily; a locale change still replaces the array.
  const locale = getLocale();
  const options = useMemo(() => {
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
    if (!loading && !error && sessionFolderId && !sessionFolders.some((folder) => folder.id === sessionFolderId)) {
      options.push({
        value: sessionFolderId,
        get label() {
          return t("Removed folder");
        },
        keywords: sessionFolderId,
      });
    }
    return options;
  }, [locale, sessionFolderId, sessionFolders, loading, error]);
  return { options, loading, error };
}
