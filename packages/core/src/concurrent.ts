/** Run async work with a small fixed worker pool. */
export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  // Workers never reject: a failure is recorded, stops new work, and is rethrown
  // only after every in-flight sibling has settled.
  const worker = async () => {
    try {
      while (!failed && shouldContinue()) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        await task(items[index], index);
      }
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  if (failed) throw firstError;
}
