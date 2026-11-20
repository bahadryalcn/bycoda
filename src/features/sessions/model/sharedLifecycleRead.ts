export interface SharedReadPolicy {
  /** Repeats the read this often while the document is visible. */
  intervalMs: number;
  /** Also re-reads when the window regains focus while the document is visible. */
  refreshOnFocus: boolean;
}

type Share = {
  subscribers: number;
  refresh: () => Promise<void>;
  stop: () => void;
};

const shares = new Map<string, Share>();

function startShare(
  key: string,
  read: (isCurrent: () => boolean) => Promise<void>,
  policy: SharedReadPolicy,
): Share {
  let pending: Promise<void> | undefined;
  const isCurrent = () => shares.get(key) === share;
  const refresh = () => {
    pending ??= read(isCurrent)
      .catch(() => undefined)
      .then(() => {
        pending = undefined;
      });
    return pending;
  };
  const onFocus = () => {
    if (!document.hidden) void refresh();
  };
  const timer = window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, policy.intervalMs);
  if (policy.refreshOnFocus) window.addEventListener("focus", onFocus);
  const share: Share = {
    subscribers: 0,
    refresh,
    stop: () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    },
  };
  return share;
}

/**
 * One interval, one focus listener and one in-flight read per key, however many callers mount.
 * Every subscriber reads immediately (joining a read already in flight); timer and focus refreshes
 * pause while the document is hidden. The last release stops the timer and listener, and a read
 * that finishes after its key was released sees `isCurrent()` as false and must write nothing.
 */
export function subscribeSharedRead(
  key: string,
  read: (isCurrent: () => boolean) => Promise<void>,
  policy: SharedReadPolicy,
): () => void {
  let share = shares.get(key);
  if (!share) {
    share = startShare(key, read, policy);
    shares.set(key, share);
  }
  const current = share;
  current.subscribers += 1;
  void current.refresh();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.subscribers -= 1;
    if (current.subscribers === 0) {
      current.stop();
      shares.delete(key);
    }
  };
}
