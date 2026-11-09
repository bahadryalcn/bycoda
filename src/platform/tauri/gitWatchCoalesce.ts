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
  cwd: string;
  refs: boolean;
  firstAt: number;
  timer?: ReturnType<typeof setTimeout>;
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
  const pending = new Map<string, Pending>();
  const keyOf = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  function fire(key: string, entry: Pending) {
    if (pending.get(key) !== entry) return;
    pending.delete(key);
    notify(entry.cwd, entry.refs ? "checkout" : "index");
  }

  return {
    push(reports: GitWatchReport[]) {
      const now = Date.now();
      for (const report of reports) {
        // Nested folders of one checkout share their listeners: they join one pending report.
        const nested = [...pending].find(([, prior]) => sameCheckout(prior.cwd, report.cwd));
        const key = nested?.[0] ?? keyOf(report.cwd);
        let entry = nested?.[1];
        if (!entry) {
          entry = { cwd: report.cwd, refs: false, firstAt: now };
          pending.set(key, entry);
        }
        entry.refs ||= report.refs;
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        const wait = Math.min(GIT_WATCH_QUIET_MS, entry.firstAt + GIT_WATCH_MAX_WAIT_MS - now);
        if (wait <= 0) {
          fire(key, entry);
        } else {
          const scheduled = entry;
          entry.timer = setTimeout(() => fire(key, scheduled), wait);
        }
      }
    },
    /** Drops a checkout's undelivered report, e.g. once it is no longer watched. */
    cancel(cwd: string) {
      const key = keyOf(cwd);
      const entry = pending.get(key);
      if (entry?.timer !== undefined) clearTimeout(entry.timer);
      pending.delete(key);
    },
  };
}
