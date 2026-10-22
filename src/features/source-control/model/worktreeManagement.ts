/** Open worktree management, or a targeted deletion with application-owned safeguards. */
export const OPEN_WORKTREE_MANAGEMENT = "bycoda:open-worktree-management";

export type WorktreeManagementRequest = { cwd: string; deletePath?: string };

export function requestWorktreeManagement(cwd: string, deletePath?: string) {
  window.dispatchEvent(
    new CustomEvent<WorktreeManagementRequest>(OPEN_WORKTREE_MANAGEMENT, {
      detail: { cwd, deletePath },
    }),
  );
}
