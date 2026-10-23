import { invalidateProjectFiles } from "../../../features/files/model/fileIndex";
import { notifyDirsChanged } from "../../../features/files/model/fileTree";
import { invalidateWatchedFiles, nudgeWatchedFiles } from "../../../features/files/model/fileWatch";
import { captureSessionCheckpoint, notifyReviewChanged, prepareSessionCheckpoint } from "../../../features/sessions/model/checkpoint";
import { type HarnessEvent } from "../../../integrations/harness";
import { isEditTool } from "../../../integrations/harness/core/preview";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { resolveWorkspacePath } from "../../../shared/lib/paths";

/** Tool calls whose files already have a pre-edit checkpoint; a streaming edit
 * sends many updates, and one snapshot before it lands is enough. */
const preparedCalls = new Set<string>();

export function trackSessionEdits(sessionId: string, cwd: string, event: HarnessEvent) {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const paths = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);
  if (paths.length === 0 || cwd === "~") return;
  const completed =
    event.type === "tool.updated" && (event.status === "completed" || event.status === "success");
  const call = `${sessionId}\n${cwd}\n${event.callId}\n${paths.join("\n")}`;
  if (!completed) {
    if (preparedCalls.has(call)) return;
    if (preparedCalls.size > 500) preparedCalls.clear();
    preparedCalls.add(call);
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch((error) => {
      preparedCalls.delete(call);
      console.warn("App operation failed", error);
    });
    return;
  }
  preparedCalls.delete(call);
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch((error) => {
      console.warn("App operation failed", error);
    })
    .then(() => notifyReviewChanged(sessionId));
}

/** Keep synchronous subscriber ordering explicit for the two existing completion paths. */
export function notifyFinishedWorkspace(
  sessionId: string,
  cwd: string,
  defer: (callback: () => void, delay: number) => void,
  order: "git-first" | "workspace-first",
) {
  notifyReviewChanged(sessionId);
  // The turn's own refresh below supersedes a pending per-tool one.
  const pending = pendingRefresh.get(cwd);
  if (pending !== undefined) clearTimeout(pending);
  pendingRefresh.delete(cwd);
  if (order === "git-first") {
    notifyGitChanged(cwd, "index");
    nudgeWorkspace(cwd);
  } else {
    nudgeWorkspace(cwd);
    notifyGitChanged(cwd, "index");
  }
  nudgeWatchedFiles();
  defer(() => nudgeWatchedFiles(), 150);
}

const WORKSPACE_REFRESH_MS = 500;
const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

/** Git status and the file tree for `cwd`, coalesced: an agent finishing a burst
 * of tool calls refreshes them once, 500 ms after the last one. */
function refreshWorkspaceSoon(cwd: string) {
  const pending = pendingRefresh.get(cwd);
  if (pending !== undefined) clearTimeout(pending);
  pendingRefresh.set(
    cwd,
    setTimeout(() => {
      pendingRefresh.delete(cwd);
      notifyGitChanged(cwd, "index");
      nudgeWorkspace(cwd);
    }, WORKSPACE_REFRESH_MS),
  );
}

export function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

export function nudgeOpenEditors(
  event: HarnessEvent,
  cwd: string,
  defer: (callback: () => void, delay: number) => void,
) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    defer(() => nudgeWatchedFiles(), 150);
    refreshWorkspaceSoon(cwd);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const resolved = [...(event.paths ?? []), ...(event.preview?.path ? [event.preview.path] : [])]
    .map((path) => resolveWorkspacePath(path, cwd) ?? path)
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (completed) {
    // A successful edit is authoritative. Reload it even if a startup race or
    // coarse filesystem timestamp makes the mtime appear unchanged.
    invalidateWatchedFiles(resolved.length > 0 ? resolved : undefined);
  } else if (resolved.length > 0) {
    nudgeWatchedFiles(resolved);
  }
  if (completed) {
    defer(() => nudgeWatchedFiles(resolved.length > 0 ? resolved : undefined), 150);
    refreshWorkspaceSoon(cwd);
  }
}
