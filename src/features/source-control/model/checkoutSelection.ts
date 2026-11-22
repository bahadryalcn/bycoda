import { t } from "../../../shared/i18n/git";
import { isEqualOrInside, pathKey, projectKey } from "../../../shared/lib/paths";
import { shortSha } from "../../../shared/lib/shortSha";
import type { Worktree } from "./worktrees";

/** Prefix of the per-session review-target choice that the sidebar header replaced. */
const LEGACY_KEY = "bycoda.sourceControl.checkout.v1:";

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

/** State scope: the session's own checkout, so a session in one worktree never shares row state with another. */
export function checkoutSelectionScope(cwd: string, paths: readonly string[]): string {
  return projectKey(sessionCheckout(cwd, paths) ?? cwd);
}

/** Each checkout and its discovered child repositories are separate Git targets. */
export function checkoutRepositoryPaths(
  paths: readonly string[],
  modules: Readonly<Record<string, readonly string[]>>,
): string[] {
  const seen = new Set<string>();
  return paths
    .flatMap((root) => [
      root,
      ...(modules[root] ?? []).filter((child) => isEqualOrInside(child, root)),
    ])
    .filter((path) => {
      const key = pathKey(path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  return checkoutTitleWith(tree, t);
}

/** Checkout title using the caller's reactive translator. */
export function checkoutTitleWith(tree: Worktree, translate: (message: string) => string): string {
  return tree.branch ?? `${translate("Detached HEAD")} · ${shortSha(tree.head)}`;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Overview row labels. Detached checkouts lead with their folder, since a bare
 * hash identifies nothing; branches drop a folder name that only repeats them
 * (`audit/x-harness` in `harness`, `mc/3e93` in `wt-mc-3e93`).
 */
export function checkoutRowLabels(tree: Worktree): {
  title: string;
  detail?: string;
} {
  const folder = folderName(tree.path);
  if (!tree.branch)
    return {
      title: folder,
      detail: t("Detached {p0}", { p0: shortSha(tree.head) }),
    };
  const leaf = slug(tree.branch.split("/").pop() ?? tree.branch);
  const name = slug(folder);
  const redundant = !!name && !!leaf && (leaf.endsWith(name) || name.endsWith(leaf));
  return { title: tree.branch, detail: redundant ? undefined : folder };
}

/**
 * A Git or filesystem failure that says the working directory itself is gone
 * ("cannot change to '<path>'", ENOENT, Windows "os error 2/3"). It only says the
 * path may be missing; callers confirm with `worktreeDeletedExternally` before
 * treating a failure as a removed checkout.
 */
export function isMissingPathError(error: string | null | undefined): boolean {
  return (
    !!error &&
    /cannot change to|no such file or directory|not a directory|os error [23]\b|cannot find the (?:file|path)|\bENOENT\b|sistem belirtilen dosyayı bulamıyor/i.test(
      error,
    )
  );
}

/** The listed path a "cannot change to '<path>'" failure names, if it is one of `paths`. */
export function missingPathNamedIn(
  error: string | null | undefined,
  paths: readonly string[],
): string | undefined {
  const named = error?.match(/cannot change to '([^']+)'/i)?.[1];
  return named ? paths.find((path) => same(path, named)) : undefined;
}

/** One-time cleanup of the retired per-session review-target choices (header focus replaces them). */
export function dropLegacyCheckoutSelections(): void {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(LEGACY_KEY)) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was persisted */
  }
}
