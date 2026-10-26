import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import { isFilesystemTab, type FilePaneTab } from "../../../features/workspace/model/layout";

type BufferState = { path: string; dirty: boolean };

export function managedWorkspaceBuffers(
  files: readonly FilePaneTab[],
  dirtyIds: ReadonlySet<string>,
): BufferState[] {
  const paths = new Map<string, boolean>();
  for (const file of files) {
    if (
      !isFilesystemTab(file) ||
      !file.path ||
      isRemoteProjectPath(file.path) ||
      isRemoteProjectPath(file.cwd)
    )
      continue;
    paths.set(file.path, Boolean(paths.get(file.path) || dirtyIds.has(file.id)));
  }
  return [...paths]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, dirty]) => ({ path, dirty }));
}

/** Serialize complete snapshots so a delayed clean report cannot erase a dirty one. */
export function createWorkspaceBufferReporter(
  report = (buffers: BufferState[]) => invoke<void>("managed_workspace_buffers", { buffers }),
) {
  let tail = Promise.resolve();
  return (buffers: BufferState[]) => {
    const next = tail.then(() => report(buffers));
    tail = next.catch(() => undefined);
    return next;
  };
}

export function useManagedWorkspaceBuffers(
  files: readonly FilePaneTab[],
  dirtyIds: ReadonlySet<string>,
) {
  const [report] = useState(createWorkspaceBufferReporter);
  const snapshot = JSON.stringify(managedWorkspaceBuffers(files, dirtyIds));
  useEffect(() => {
    const send = () => {
      // Failed/unsupported transport remains unknown to the native/Host gate.
      void report(JSON.parse(snapshot) as BufferState[]).catch(() => undefined);
    };
    send();
    const timer = window.setInterval(send, 15_000);
    return () => window.clearInterval(timer);
  }, [report, snapshot]);
  // Unmount is not evidence that editor contents were saved or a process exited.
}
