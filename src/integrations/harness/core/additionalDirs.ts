type Resolver = (sessionId: string) => readonly string[];

let resolver: Resolver = () => [];

/**
 * The app owns which extra folders a session may reach. Adapters ask here
 * rather than taking them on each input, so every operation on a session
 * (turn, compact, rewind) sees the same list and never restarts the provider
 * over a difference between call sites.
 */
export function setAdditionalDirsResolver(next: Resolver): void {
  resolver = next;
}

/** Extra folders the session's agent may read and edit, beyond its cwd. */
export function additionalDirsFor(sessionId: string): string[] {
  try {
    return [...resolver(sessionId)];
  } catch {
    return [];
  }
}
