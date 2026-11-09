/** Runs `load` at most once per request; the name is looked up only when asked for. */
export function memoized<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= load());
}
