/** Observe the original profile lock; stale/failed probes remain held.
 * Watch events avoid steady polling; a missed event uses bounded-rate backoff.
 * This does not unlink locks or infer browser death from a launcher/PID alone.
 */
export function waitForProfileUnlock(
  ports: {
    inUse: () => Promise<boolean>;
    observe: (changed: () => void, failed: () => void) => () => void;
  },
  exited: Promise<void> = Promise.resolve(),
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false, didExit = false, checking = false, again = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    const stopWatch = () => {
      const original = stop;
      stop = undefined;
      try { original?.(); } catch { /* Profile lock proof is independent of watcher cleanup. */ }
    };
    const schedule = () => {
      if (finished || !didExit || timer) return;
      timer = setTimeout(() => { timer = undefined; check(); }, delay);
      timer.unref?.();
      delay = Math.min(30_000, delay * 2);
    };
    const check = () => {
      if (finished || !didExit) return;
      if (checking) { again = true; return; }
      clearTimeout(timer);
      timer = undefined;
      checking = true;
      void Promise.resolve().then(() => ports.inUse()).then((inUse) => {
        if (!inUse) {
          finished = true;
          stopWatch();
          resolve();
        } else schedule();
      }, () => schedule()).finally(() => {
        checking = false;
        if (again) { again = false; check(); }
      }).catch(() => schedule());
    };
    try {
      stop = ports.observe(() => { delay = 1000; check(); }, () => {
        stopWatch();
        schedule();
      });
    } catch { /* Failed observation retains conservative lock probes. */ }
    void exited.then(() => { didExit = true; check(); }, () => {
      // Unknown original launcher completion never becomes a released profile.
    });
  });
}
