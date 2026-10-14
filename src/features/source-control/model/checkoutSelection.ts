import { t } from "../../../shared/i18n/git";
import { isEqualOrInside, pathKey, projectKey } from "../../../shared/lib/paths";
import type { Worktree } from "./worktrees";

const KEY = "bycoda.sourceControl.checkout.v1:";
/** Persisted value meaning the user explicitly chose the "All checkouts" overview. */
const ALL = "*";

export type CheckoutGroups = {
  /** The session's checkout, then the main folder (deduplicated). */
  primary: Worktree[];
  /** Other checkouts with changes, unpushed commits or sessions. */
  active: Worktree[];
  /** Clean checkouts with nothing unpushed and no sessions. */
  idle: Worktree[];
};

export const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

const same = (a: string, b: string) => pathKey(a) === pathKey(b);

/** The checkout containing `cwd`; the deepest one wins when checkouts are nested. */
export function sessionCheckout(cwd: string, paths: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const path of paths)
    if (isEqualOrInside(cwd, path) && (!best || pathKey(path).length > pathKey(best).length))
      best = path;
  return best;
}

export function mainCheckout(
  paths: readonly string[],
  worktrees: Readonly<Record<string, Worktree>>,
): string | undefined {
  return paths.find((path) => worktrees[path]?.isMain);
}

/** Default checkout: the session's own, then the main folder, then the first one. */
export function defaultCheckout(
  cwd: string,
  paths: readonly string[],
  worktrees: Readonly<Record<string, Worktree>>,
): string {
  return sessionCheckout(cwd, paths) ?? mainCheckout(paths, worktrees) ?? paths[0] ?? cwd;
}

/**
 * Storage scope: the session's own checkout, so a session in one worktree never
 * inherits the choice made from another.
 */
export function checkoutSelectionScope(cwd: string, paths: readonly string[]): string {
  return projectKey(sessionCheckout(cwd, paths) ?? cwd);
}

/** Returns a checkout path, "" for all checkouts, or null when nothing is stored. */
export function loadCheckoutSelection(scope: string): string | null {
  try {
    const value = localStorage.getItem(KEY + scope);
    return value === null ? null : value === ALL ? "" : value;
  } catch {
    return null;
  }
}

export function saveCheckoutSelection(scope: string, selection: string): void {
  try {
    localStorage.setItem(KEY + scope, selection === "" ? ALL : selection);
  } catch {
    /* storage unavailable: the choice lasts for this window only */
  }
}

/** Resolves a stored/explicit choice to a live checkout path, "" (all) or the default. */
export function resolveCheckoutSelection(
  choice: string | null,
  cwd: string,
  paths: readonly string[],
  worktrees: Readonly<Record<string, Worktree>>,
): string {
  if (choice === "") return "";
  const match = choice === null ? undefined : paths.find((path) => same(path, choice));
  return match ?? defaultCheckout(cwd, paths, worktrees);
}

export const isIdleCheckout = (tree: Worktree) =>
  !tree.dirty && !(tree.unpushed && tree.unpushed > 0) && tree.sessionIds.length === 0;

export function groupCheckouts(trees: readonly Worktree[], cwd: string): CheckoutGroups {
  const current = sessionCheckout(
    cwd,
    trees.map((tree) => tree.path),
  );
  const rank = (tree: Worktree) => (current && same(tree.path, current) ? 0 : tree.isMain ? 1 : 2);
  const primary = trees.filter((tree) => rank(tree) < 2).sort((a, b) => rank(a) - rank(b));
  const rest = trees.filter((tree) => rank(tree) === 2);
  return {
    primary,
    active: rest.filter((tree) => !isIdleCheckout(tree)),
    idle: rest.filter(isIdleCheckout),
  };
}

export function checkoutTitle(tree: Worktree): string {
  return tree.branch ?? `${t("Detached")} · ${tree.head.slice(0, 7)}`;
}

/** Selector label: `branch · folder`, marking the session's checkout. */
export function checkoutOptionLabel(tree: Worktree, isSession: boolean): string {
  const parts = [checkoutTitle(tree), folderName(tree.path)];
  if (isSession) parts.push(t("This session"));
  return parts.join(" · ");
}
