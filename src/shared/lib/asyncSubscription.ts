/** Releases a subscription even when registration finishes after disposal. */
export function retainAsyncSubscription(
  registration: Promise<() => void>,
  report: (error: unknown) => void,
): () => void {
  let disposed = false;
  let release: (() => void) | undefined;
  const safelyRelease = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      report(error);
    }
  };
  void registration
    .then((fn) => {
      if (disposed) safelyRelease(fn);
      else release = fn;
    })
    .catch(report);
  return () => {
    disposed = true;
    if (release) {
      safelyRelease(release);
      release = undefined;
    }
  };
}
