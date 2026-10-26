/** The fields needed to authorize a session; transcripts are deliberately absent. */
export type SessionAuthorityIdentity = { projectId: string; provider: string };
export type SessionGrantScope = SessionAuthorityIdentity & {
  sessionId: string;
  environmentId: string;
};

/** Preparation changed while waiting for SQL admission. Keep the grant, but fail closed. */
export class SessionAuthorityUnavailable extends Error {
  constructor() {
    super("Session metadata changed; retry authentication.");
    this.name = "SessionAuthorityUnavailable";
  }
}

export type SessionAuthorityResolver = {
  /** External reads happen here, before reserving the Host SQL owner. */
  prepare(id: string): Promise<void>;
  /** Only fresh, bounded Host SQL/metadata checks; never external worker or network I/O. */
  current(id: string): Promise<SessionAuthorityIdentity>;
};

/** Native-only sessions live in a different SQLite database. Read its metadata
 * before Host admission, and fail closed if it changed before the fresh checks. */
export function createSessionAuthorityResolver(
  store: HostStore,
  desktop: Pick<DesktopSessions, "metadataAsync" | "fingerprint" | "samePath">,
  providers: readonly string[],
): SessionAuthorityResolver {
  const prepared = new Map<string, { fingerprint: string; cwd: string; provider: string }>();
  return {
    async prepare(id) {
      if (store.db.ownsScope) throw new SessionAuthorityUnavailable();
      if (await store.sessionAuthority(id)) return;
      // Only authentication preparation is retried, before any business operation.
      for (let attempt = 0; attempt < 2; attempt++) {
        const fingerprint = desktop.fingerprint();
        const value = await desktop.metadataAsync(id);
        if (desktop.fingerprint() !== fingerprint) continue;
        if (!value) throw new Error("Session not found on this machine");
        prepared.delete(id);
        prepared.set(id, { fingerprint, cwd: value.cwd, provider: value.harness });
        while (prepared.size > 512) prepared.delete(prepared.keys().next().value!);
        return;
      }
      throw new SessionAuthorityUnavailable();
    },
    async current(id) {
      const host = await store.sessionAuthority(id);
      if (host) return host;
      const value = prepared.get(id);
      if (!value || desktop.fingerprint() !== value.fingerprint)
        throw new SessionAuthorityUnavailable();
      const project = (await store.projects()).find((project) =>
        desktop.samePath(project.cwd, value.cwd),
      );
      if (desktop.fingerprint() !== value.fingerprint) throw new SessionAuthorityUnavailable();
      if (!project || (value.provider !== "acp" && !providers.includes(value.provider)))
        throw new Error("Session not found on this machine");
      return { projectId: project.id, provider: value.provider };
    },
  };
}

export function assertSessionGrantScope(expected: unknown, current: SessionGrantScope): void {
  if (expected === undefined) return;
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).length !== 4 ||
    Object.keys(expected).some((key) => !Object.hasOwn(current, key)) ||
    Object.entries(current).some(
      ([key, value]) => (expected as Record<string, unknown>)[key] !== value,
    )
  )
    throw new Error("Session grant scope changed; reconnect this session explicitly.");
}
import type { DesktopSessions } from "./desktopSessions";
import type { HostStore } from "./store";
