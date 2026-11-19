/** Native `.git` watcher report for one checkout folder. */
export type GitWatchReport = { cwd: string; index: boolean; refs: boolean };

/** Quiet period after the last report for one checkout before views reload. */
const GIT_WATCH_QUIET_MS = 250;
/** Longest a continuous change stream may hold back delivery for one checkout. */
const GIT_WATCH_MAX_WAIT_MS = 1000;

/** Whether two folders belong to one checkout: the same folder or nested. */
export function sameCheckout(a: string, b: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

type Pending = {
  /** Folder the notification is delivered for: the first reporter still pending. */
  cwd: string;
  firstAt: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Undelivered reports per reporting folder (`keyOf`), each with its own refs flag. */
  reports: Map<string, { cwd: string; refs: boolean }>;
};

/**
 * Coalesces `.git` watcher reports per checkout folder. A burst of reports (a
 * checkout or rebase touches many files) becomes one notification after a
 * short quiet period; a continuous stream is delivered at least every
 * `GIT_WATCH_MAX_WAIT_MS`. Reports of one folder merge into one scope: any
 * refs or HEAD change widens it to the whole checkout.
 */
export function createGitWatchCoalescer(
  notify: (cwd: string, scope: "checkout" | "index") => void,
) {
  // Keyed by entry identity: an entry's first folder may be cancelled while its merged reports stay.
  const pending = new Set<Pending>();
  const keyOf = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  function fire(entry: Pending) {
    if (!pending.delete(entry)) return;
    const refs = [...entry.reports.values()].some((report) => report.refs);
    notify(entry.cwd, refs ? "checkout" : "index");
  }

  return {
    push(reports: GitWatchReport[]) {
      const now = Date.now();
      for (const report of reports) {
        // Nested folders of one checkout share their listeners: they join one pending report.
        const entry: Pending =
          [...pending].find((prior) =>
            [...prior.reports.values()].some((source) => sameCheckout(source.cwd, report.cwd)),
          ) ?? { cwd: report.cwd, firstAt: now, reports: new Map() };
        pending.add(entry);
        const source = keyOf(report.cwd);
        const prior = entry.reports.get(source);
        entry.reports.set(source, { cwd: report.cwd, refs: (prior?.refs ?? false) || report.refs });
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        const wait = Math.min(GIT_WATCH_QUIET_MS, entry.firstAt + GIT_WATCH_MAX_WAIT_MS - now);
        if (wait <= 0) {
          fire(entry);
        } else {
          entry.timer = setTimeout(() => fire(entry), wait);
        }
      }
    },
    /**
     * Drops one folder's undelivered report, e.g. once it is no longer watched. Reports of
     * other folders of the same checkout stay pending; the entry goes once none remain.
     */
    cancel(cwd: string) {
      const source = keyOf(cwd);
      for (const entry of pending) {
        if (!entry.reports.delete(source)) continue;
        if (entry.reports.size === 0) {
          if (entry.timer !== undefined) clearTimeout(entry.timer);
          pending.delete(entry);
        } else if (keyOf(entry.cwd) === source) {
          entry.cwd = [...entry.reports.values()][0].cwd;
        }
      }
    },
  };
}
