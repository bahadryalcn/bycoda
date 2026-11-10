type Token = { start: number; end: number; query: string; trigger?: "$" };

/** State updater that keeps the current token object when the new one is equivalent, so no re-render. */
export function keepEqualToken<T extends Token>(next: T | null) {
  return (current: T | null): T | null =>
    current &&
    next &&
    current.start === next.start &&
    current.end === next.end &&
    current.query === next.query &&
    current.trigger === next.trigger
      ? current
      : next;
}
