# Source control decision provenance

Historical intent only; this record grants no Git operation, push, or delete authority beyond the owner gates in the guide.

## Worktree selection in one place

Owner quote, 2026-11-22:

> Ayrıca burası karışıyor 3 yerden worktree branch seçimi var gibi. Bir worktree branch olarak gözükebiliyor. ... tüm worktreeleri aynı anda gör gibi birşey seçemiyorum all repositories yada all worktrees gibi bir seçenek olması lazım değilmi vscode da tüm worktreeleri aynı anda görebiliyordum

The retained decision: the sidebar header is the only worktree selector. The Changes panel has no Worktrees or Branches tabs. This replaces the earlier contract that the Git review target and the execution checkout were separate choices. The default Changes scope is **All worktrees**, showing every worktree as rows. Deleting a worktree may also delete its branch, behind an off-by-default **Also delete branch** option that is only available when the branch is fully merged, has no unpushed commits and is not the default branch.

## Same-level repository sections, no text markers

Owner quotes, 2026-11-22: "girintili olunca iş karışıyor ... vscode da aynı hizada" and "seperate repository filan gerek yok bunlara saçma sapan etiket ve yazılar".

The retained decision (following VS Code's Source Control view): the Changes panel lists repositories as same-level sections, never indented, and lists only worktrees with uncommitted changes or unpushed commits (and the repositories nested in them); clean and unknown worktrees live in the header picker, which is the repository list with agent-managed worktrees grouped last. Repository and worktree rows show an icon, bold name, muted branch, change chip, sync arrows and hover actions only; "This session", "Separate repository", "Project folder" and similar text markers are not shown, and their explanation lives in tooltips. An unknown worktree state renders as unknown, never as clean. A Host that lists worktrees carries `dirty` and `unpushed` per worktree, as the desktop listing does.

2026-11-26: "2 tane push bekleyen var hiç gözükmüyor bunları da göstermek gerekiyor" — the All-worktrees Changes panel also lists worktrees with unpushed commits, after the changed ones.

## All repositories, every worktree listed

Owner quote, 2026-11-27: "buranın all worktrees değil all repositories filan olsun adı vscode daki gibi çalışsın ... All worktrees de de tüm worktreeler gelmiyor sadece değişikliği olanlar geliyor ... boş olan worktree ler default olarak kapalı gelebilir ... Her birinin changes staged ının sabit yüksekliği olsun"

The retained decision, replacing the changed-only list above: the overview is named **All repositories** and lists every worktree; those with changes or unpushed commits open first, clean and unknown ones follow collapsed, and child repositories are discovered only for open rows. Every row, collapsed or open, carries its branch picker. Each section's file lists scroll within a capped height. The header picker no longer filters the Sessions list (owner answer, same day: "Etkilemesin").
