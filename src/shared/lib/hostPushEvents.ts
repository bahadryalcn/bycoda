/**
 * Event kinds the local Host already pushes to a registered phone. The Host and the account would
 * otherwise both push the same phone, so the desktop does not report these to the account. Unknown
 * (Host not reachable or too old) leaves reporting on.
 */
let pushed: ReadonlySet<string> = new Set();

export function setHostPushEvents(kinds: readonly string[] | undefined): void {
  pushed = new Set(kinds ?? []);
}

export function hostPushesEvent(kind: string): boolean {
  return pushed.has(kind);
}
