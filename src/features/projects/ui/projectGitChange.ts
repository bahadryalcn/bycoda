type FormatCount = (value: number, options?: Intl.NumberFormatOptions) => string;

/** The part of `GitDiffStats` a project row reads. Anything else (null, a failed read) is "unknown". */
export type ProjectGitStats = { files: number; additions: number; deletions: number };

/**
 * What one project row says about its working tree. Files and lines are two different measures: a changed
 * file may carry no line counts (binary, untracked-only, mode-only), and line counts never stand in for a
 * file count. `files` is 0 when the data does not name a count.
 */
export type ProjectGitChange = {
  files: number;
  additions: number;
  deletions: number;
  /** Line churn is known; the row can show "+a -d" next to (or instead of) the compact indicator. */
  hasLines: boolean;
  /** The text of the wide detail, e.g. "+1,234 -56". Empty without line counts. */
  detail: string;
};

function wholeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The visible change of a project, or `null` when there is nothing to claim: no read yet, a failed read
 * (the hook keeps `null` then) or a clean tree. `null` is deliberately not "zero changes": the row shows no
 * indicator for it and never labels it clean.
 */
export function projectGitChange(
  stats: ProjectGitStats | null | undefined,
  formatCount: FormatCount,
): ProjectGitChange | null {
  if (!stats) return null;
  const files = wholeCount(stats.files);
  const additions = wholeCount(stats.additions);
  const deletions = wholeCount(stats.deletions);
  if (files === 0 && additions === 0 && deletions === 0) return null;
  const hasLines = additions > 0 || deletions > 0;
  const detail = [
    additions > 0 ? `+${formatCount(additions, { maximumFractionDigits: 0 })}` : "",
    deletions > 0 ? `-${formatCount(deletions, { maximumFractionDigits: 0 })}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { files, additions, deletions, hasLines, detail };
}

type Translate = (text: string, params?: Record<string, string | number>) => string;

/**
 * "3 files · +1,234 -56": the short tooltip text. Files and lines keep their own words so a line count is
 * never read as a file count. Uses the same wording as the Changes tab.
 */
export function projectGitChangeSummary(
  change: ProjectGitChange,
  t: Translate,
  formatCount: FormatCount,
): string {
  return [
    change.files > 0
      ? t(change.files === 1 ? "{p0} file" : "{p0} files", {
          p0: formatCount(change.files, { maximumFractionDigits: 0 }),
        })
      : "",
    change.detail,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The spoken form: "3 changed files, 1,234 lines added, 56 lines removed". */
export function projectGitChangeSpoken(
  change: ProjectGitChange,
  t: Translate,
  formatCount: FormatCount,
): string {
  return [
    change.files > 0
      ? t(change.files === 1 ? "{p0} changed file" : "{p0} changed files", {
          p0: formatCount(change.files, { maximumFractionDigits: 0 }),
        })
      : "",
    change.additions > 0
      ? t("{p0} lines added", { p0: formatCount(change.additions, { maximumFractionDigits: 0 }) })
      : "",
    change.deletions > 0
      ? t("{p0} lines removed", { p0: formatCount(change.deletions, { maximumFractionDigits: 0 }) })
      : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The count next to the compact indicator; the exact number stays in the tooltip. */
export function projectGitCountLabel(files: number): string {
  return files > 99 ? "99+" : String(files);
}

/**
 * Row-width buckets (px, content box). The wide "+a -d" detail is shown while the project row's own width reaches the
 * bucket, otherwise the compact indicator takes over. The rail's CSS holds one container-query rule per
 * bucket, so the switch follows the row (rail drag, flyout, group indent) without measuring in script.
 */
export const PROJECT_GIT_DETAIL_BUCKETS = [
  140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360,
] as const;

/** Estimated width of one detail character (11px semi-bold tabular digits, plus the +/- signs). */
const DETAIL_CHARACTER_PX = 6.5;
/**
 * Row chrome that is always there: button padding, logo, gaps and the menu reserve. A container query
 * measures the row's content box, so the row's own horizontal padding is not part of it.
 */
const ROW_CHROME_PX = 56;
/** The project name keeps about ten characters before the detail yields. */
const NAME_MIN_PX = 68;
/** One more fixed item in the row: connection icon, mute bell or the reconnect action. */
const EXTRA_ITEM_PX = 24;

/**
 * The smallest bucket the wide detail needs, or `null` when no rail width is wide enough (always compact).
 * `extras` counts the fixed items sharing the row: the remote connection icon, the mute bell and the
 * reconnect action.
 */
export function projectGitDetailBucket(change: ProjectGitChange, extras = 0): number | null {
  if (!change.hasLines) return null;
  const need =
    ROW_CHROME_PX +
    NAME_MIN_PX +
    change.detail.length * DETAIL_CHARACTER_PX +
    Math.max(0, extras) * EXTRA_ITEM_PX;
  return PROJECT_GIT_DETAIL_BUCKETS.find((bucket) => bucket >= need) ?? null;
}
