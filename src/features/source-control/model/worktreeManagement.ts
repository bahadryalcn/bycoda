/** Route checkout actions to the application-owned deletion and session safeguards. */
export const OPEN_WORKTREE_MANAGEMENT = "bycoda:open-worktree-management";

export type WorktreeManagementRequest = { cwd: string; deletePath?: string };

export function requestWorktreeManagement(cwd: string, deletePath?: string) {
  window.dispatchEvent(
    new CustomEvent<WorktreeManagementRequest>(OPEN_WORKTREE_MANAGEMENT, {
      detail: { cwd, deletePath },
    }),
  );
}
