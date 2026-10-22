/** A failed previous operation does not poison the owner's subsequent operation. */
export function continueAfterFailure<Result>(
  previous: Promise<unknown>,
  operation: () => Promise<Result>,
): Promise<Result> {
  return previous.catch(() => undefined).then(operation);
}

/** Keep the caller's result while publishing a rejection-safe queue tail. */
export function settledTail(previous: Promise<unknown>): Promise<void> {
  return previous.then(
    () => undefined,
    () => undefined,
  );
}
