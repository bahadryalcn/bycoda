import { useRef } from "react";

export interface WorkspaceStateRefDeps {
  dirtyFiles: Set<string>;
  activeTabId: string;
  projectCwd: string;
}

/** Render-time mirrors of dirty files, the active tab id and the project folder. */
export function useWorkspaceStateRefs({
  dirtyFiles,
  activeTabId,
  projectCwd,
}: WorkspaceStateRefDeps) {
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const projectCwdRef = useRef(projectCwd);
  projectCwdRef.current = projectCwd;
  return { dirtyFilesRef, activeTabIdRef, projectCwdRef };
}

export interface SurfaceFlagRefDeps {
  searchViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  automationsViewOpen: boolean;
  serversViewOpen?: boolean;
  filePickerOpen: boolean;
}

/** Render-time mirrors of the surface view flags, read by event callbacks. */
export function useSurfaceFlagRefs({
  searchViewOpen,
  inboxViewOpen,
  notesViewOpen,
  automationsViewOpen,
  serversViewOpen = false,
  filePickerOpen,
}: SurfaceFlagRefDeps) {
  const searchViewOpenRef = useRef(searchViewOpen);
  searchViewOpenRef.current = searchViewOpen;
  const inboxViewOpenRef = useRef(inboxViewOpen);
  inboxViewOpenRef.current = inboxViewOpen;
  const notesViewOpenRef = useRef(notesViewOpen);
  notesViewOpenRef.current = notesViewOpen;
  const automationsViewOpenRef = useRef(automationsViewOpen);
  automationsViewOpenRef.current = automationsViewOpen;
  const serversViewOpenRef = useRef(serversViewOpen);
  serversViewOpenRef.current = serversViewOpen;
  const filePickerOpenRef = useRef(filePickerOpen);
  filePickerOpenRef.current = filePickerOpen;
  return {
    searchViewOpenRef,
    inboxViewOpenRef,
    notesViewOpenRef,
    automationsViewOpenRef,
    serversViewOpenRef,
    filePickerOpenRef,
  };
}
