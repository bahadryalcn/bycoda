import { useEffect, useRef } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { listDir, readTextFile } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { watchFile } from "../../files/model/fileWatch";
import { parseCodeWorkspace } from "../model/codeWorkspace";
import { saveWorkspaceProjectNames } from "../../workspace/model/tabGroups";
import { reconcileLinkedWorkspace, setLinkedGroupStatus } from "../model/linkedWorkspace";
import {
  changeProjectGroupMembers,
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupMembers,
  updateProjectGroup,
} from "../model/projectGroups";
import { rememberImportedProjects, subscribeProjectPathsChanged } from "../model/recents";

export const REFRESH_LINKED_GROUP_EVENT = "bycoda:refresh-linked-group";

async function folderExists(path: string): Promise<boolean> {
  try {
    await listDir(path);
    return true;
  } catch {
    return false;
  }
}

const syncing = new Set<string>();

/**
 * Brings one linked group in line with its `.code-workspace` file. A missing
 * or unparsable file only sets a warning on the group. Folders added to the
 * file join the rail and the group; folders removed from it leave the group
 * but stay projects, since sessions may live there.
 */
export async function syncLinkedGroup(groupId: string, onProjectsAdded: () => void): Promise<void> {
  if (syncing.has(groupId)) return;
  syncing.add(groupId);
  try {
    const file = loadProjectGroups().find((item) => item.id === groupId)?.workspaceFile;
    if (!file) return;

    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      setLinkedGroupStatus(groupId, {
        state: "missing",
        message: `Workspace file not found or unreadable: ${file}`,
      });
      return;
    }
    let folders: string[];
    let names: Record<string, string>;
    try {
      // Remote entries come back as `unsupported` and are never members.
      const workspace = parseCodeWorkspace(text, file);
      folders = workspace.folders;
      names = workspace.folderNames;
    } catch (error) {
      setLinkedGroupStatus(groupId, {
        state: "invalid",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // The group may have changed while the file was read.
    const current = loadProjectGroups().find((item) => item.id === groupId);
    if (current?.workspaceFile !== file) return;
    const result = reconcileLinkedWorkspace({
      previous: current.workspaceFolders ?? [],
      next: folders,
      members: projectGroupMembers(groupId, loadProjectGroupAssignments()),
    });

    const present = await Promise.all(result.toAdd.map(folderExists));
    const added = result.toAdd.filter((_, index) => present[index]);
    const missing = new Set(result.toAdd.filter((_, index) => !present[index]).map(pathKey));

    if (added.length > 0) {
      rememberImportedProjects(added.map((path) => ({ path, lastUsedAt: Date.now() })));
      onProjectsAdded();
    }
    changeProjectGroupMembers(groupId, added, result.toDetach);
    // A folder that does not exist yet is retried at the next sync.
    const linked = result.linked.filter((path) => !missing.has(pathKey(path)));
    saveWorkspaceProjectNames(linked, names);
    updateProjectGroup(groupId, (item) =>
      item.workspaceFile === file ? { ...item, workspaceFolders: linked } : item,
    );
    setLinkedGroupStatus(groupId, null);

    if (result.toDetach.length > 0) {
      await message(
        `${result.toDetach.length === 1 ? "This folder was" : "These folders were"} removed from ${file} and taken out of the group "${current.name}". The projects and their sessions are still in the rail:\n\n${result.toDetach.join("\n")}`,
        { title: "Workspace group updated", kind: "info" },
      );
    }
  } finally {
    syncing.delete(groupId);
  }
}

/**
 * Keeps groups linked to a workspace file in sync. The file is watched by the
 * shared mtime watcher, which re-stats on window focus and costs no process
 * spawns. The first sample after linking also runs a sync, so changes made
 * while the app was closed are picked up on startup.
 */
export function useLinkedWorkspaceGroups(onProjectsAdded: () => void): void {
  const addedRef = useRef(onProjectsAdded);
  addedRef.current = onProjectsAdded;

  useEffect(() => {
    // file path -> stop watching, for every group that is currently linked.
    const watchers = new Map<string, () => void>();
    const sync = (groupId: string) =>
      void syncLinkedGroup(groupId, () => addedRef.current()).catch(() => {
        /* the next change or refresh retries */
      });

    const reconcileWatchers = () => {
      const wanted = new Map<string, string[]>();
      for (const group of loadProjectGroups()) {
        if (!group.workspaceFile) continue;
        const ids = wanted.get(group.workspaceFile) ?? [];
        ids.push(group.id);
        wanted.set(group.workspaceFile, ids);
      }
      for (const [file, stop] of watchers) {
        if (wanted.has(file)) continue;
        stop();
        watchers.delete(file);
      }
      for (const [file] of wanted) {
        if (watchers.has(file)) continue;
        watchers.set(
          file,
          watchFile(file, () => {
            // Read the groups at change time; they may have been relinked.
            for (const group of loadProjectGroups()) {
              if (group.workspaceFile === file) sync(group.id);
            }
          }),
        );
      }
    };

    reconcileWatchers();
    const unsubscribe = subscribeProjectPathsChanged(reconcileWatchers);
    const onRefresh = (event: Event) => {
      const groupId = (event as CustomEvent<string>).detail;
      if (typeof groupId === "string") sync(groupId);
    };
    window.addEventListener(REFRESH_LINKED_GROUP_EVENT, onRefresh);
    return () => {
      unsubscribe();
      window.removeEventListener(REFRESH_LINKED_GROUP_EVENT, onRefresh);
      for (const stop of watchers.values()) stop();
      watchers.clear();
    };
  }, []);
}
