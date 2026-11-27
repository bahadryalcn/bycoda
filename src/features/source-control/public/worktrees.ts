/** Public source-control contract; exports stay explicit to preserve load isolation. */
export { createWorktree, listWorktrees, removeWorktree } from "../model/worktrees";
export type { RemoveWorktree, Worktree } from "../model/worktrees";
