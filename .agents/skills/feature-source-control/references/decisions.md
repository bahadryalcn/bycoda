# Source control decision provenance

Historical intent only; this record grants no Git operation, push, or delete authority beyond the owner gates in the guide.

## Worktree selection in one place

Owner quote, 2026-11-22:

> Ayrıca burası karışıyor 3 yerden worktree branch seçimi var gibi. Bir worktree branch olarak gözükebiliyor. ... tüm worktreeleri aynı anda gör gibi birşey seçemiyorum all repositories yada all worktrees gibi bir seçenek olması lazım değilmi vscode da tüm worktreeleri aynı anda görebiliyordum

The retained decision: the sidebar header is the only worktree selector. The Changes panel has no Worktrees or Branches tabs. This replaces the earlier contract that the Git review target and the execution checkout were separate choices. The default Changes scope is **All worktrees**, showing every worktree as rows. Deleting a worktree may also delete its branch, behind an off-by-default **Also delete branch** option that is only available when the branch is fully merged, has no unpushed commits and is not the default branch.
