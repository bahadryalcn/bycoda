import { shortSha } from "../../../shared/lib/shortSha";
import { t } from "../../../shared/i18n/git";
import { folderName, sessionCheckout } from "./checkoutSelection";
import type { Worktree } from "./worktrees";
import { pathKey } from "../../../shared/lib/paths";

/**
 * Where a row sits: worktrees with uncommitted changes first, then the session's folder and
 * the project folder, other worktrees, and last the worktrees agents manage.
 */
export type WorktreeRowGroup = "changes" | "primary" | "other" | "agent";

/** One worktree as every list shows it: same title, marker, counts, order and filter. */
export type WorktreeRow = {
  path: string;
  tree: Worktree;
  /** Branch, or "Detached <sha>". */
  title: string;
  /** Folder name of the worktree; the full path is only a tooltip. */
  folder: string;
  /** Muted text after the title; none for the project folder and agent worktrees (hash-like folders). */
  detail?: string;
  isMain: boolean;
  /** The checkout the current session works in. */
  current: boolean;
  /** Created and owned by an agent, shown with the agent icon and no folder name. */
  agent: boolean;
  group: WorktreeRowGroup;
};

/** A worktree that can be opened: neither deleted on disk nor awaiting prune. */
export const isListedWorktree = (tree: Worktree) => !tree.missing && !tree.prunable;

/** Branch prefixes agents use: managed workspaces (`bycoda/s|t/`), `by/` and temporary `mc/`. */
const AGENT_BRANCH = /^(?:by|bycoda|mc)\//;
/** Managed workspace folders (`wt-<id>`) and worktrees kept under a `.t3` or `.bycoda` root. */
const AGENT_FOLDER = /^wt-[0-9a-f]{6,}$/i;
const AGENT_ROOT = /(?:^|[\\/])\.(?:t3|bycoda)[\\/]/;

/** True for a worktree an agent manages; the project folder never is. */
export const isAgentWorktree = (tree: Pick<Worktree, "path" | "branch" | "isMain">) =>
  !tree.isMain &&
  (AGENT_BRANCH.test(tree.branch ?? "") ||
    AGENT_FOLDER.test(folderName(tree.path)) ||
    AGENT_ROOT.test(tree.path));

/** Dirty is known to be true; an unknown state is never counted as changes. */
export const hasUncommittedChanges = (tree: Pick<Worktree, "dirty">) => tree.dirty === true;

export const worktreeRowTitle = (tree: Worktree) =>
  tree.branch ?? (tree.head ? t("Detached {p0}", { p0: shortSha(tree.head) }) : t("Detached HEAD"));

export const worktreeRowFolder = (tree: Worktree) => folderName(tree.path);

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The folder only when it adds something the branch does not already say. */
function rowDetail(tree: Worktree, agent: boolean): string | undefined {
  if (tree.isMain || agent) return undefined;
  const folder = folderName(tree.path);
  const leaf = slug((tree.branch ?? "").split("/").pop() ?? "");
  const name = slug(folder);
  return !leaf || (!leaf.endsWith(name) && !name.endsWith(leaf)) ? folder : undefined;
}

/** Heading of the group, if it has one: the project folder and other worktrees are unlabelled. */
export const worktreeGroupLabel = (group: WorktreeRowGroup, count: number) =>
  group === "changes"
    ? t("Uncommitted changes")
    : group === "agent"
      ? t("Agent worktrees · {p0}", { p0: count })
      : undefined;

const GROUP_ORDER: readonly WorktreeRowGroup[] = ["changes", "primary", "other", "agent"];

/** Agent worktrees with sessions or unpublished commits (the activity signals the list carries) lead. */
const activity = (tree: Worktree) => tree.sessionIds.length * 1000 + (tree.unpushed ?? 0);

/**
 * The single worktree list: listed worktrees only. Worktrees with uncommitted changes lead
 * (the session's folder, then the project folder, first among them), then the session's and
 * project folder, other worktrees and agent worktrees. `query` matches title, folder and
 * full path, ignoring case and outer spaces.
 */
export function worktreeRows(
  trees: readonly Worktree[] | undefined,
  cwd: string,
  query = "",
): WorktreeRow[] {
  const listed = (trees ?? []).filter(isListedWorktree);
  const session = sessionCheckout(
    cwd,
    listed.map((tree) => tree.path),
  );
  const isCurrent = (tree: Worktree) => !!session && pathKey(tree.path) === pathKey(session);
  const needle = query.trim().toLocaleLowerCase();
  const rows = listed.map((tree): WorktreeRow => {
    const agent = isAgentWorktree(tree);
    const current = isCurrent(tree);
    const group: WorktreeRowGroup = hasUncommittedChanges(tree)
      ? "changes"
      : current || tree.isMain
        ? "primary"
        : agent
          ? "agent"
          : "other";
    return {
      path: tree.path,
      tree,
      title: worktreeRowTitle(tree),
      folder: worktreeRowFolder(tree),
      detail: rowDetail(tree, agent),
      isMain: tree.isMain,
      current,
      agent,
      group,
    };
  });
  const rank = (row: WorktreeRow) => (row.current ? 0 : row.isMain ? 1 : 2);
  return GROUP_ORDER.flatMap((group) =>
    rows
      .filter((row) => row.group === group)
      .sort((a, b) =>
        group === "agent" ? activity(b.tree) - activity(a.tree) : rank(a) - rank(b),
      ),
  ).filter((entry) =>
    `${entry.title}\n${entry.folder}\n${entry.path}`.toLocaleLowerCase().includes(needle),
  );
}

/** Agent rows shown before "… N more". */
export const AGENT_ROWS_SHOWN = 5;

/** Long agent groups collapse after five rows; `hidden` is how many `expanded` would add. */
export function collapseAgentRows(rows: readonly WorktreeRow[], expanded: boolean) {
  const agents = rows.filter((row) => row.group === "agent");
  if (expanded || agents.length <= AGENT_ROWS_SHOWN) return { rows, hidden: 0 };
  const dropped = new Set(agents.slice(AGENT_ROWS_SHOWN));
  return { rows: rows.filter((row) => !dropped.has(row)), hidden: dropped.size };
}
