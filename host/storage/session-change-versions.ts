/** Streaming-only saves refresh the project list at most this often. */
export const LIST_REFRESH_MS = 2000;

/**
 * Per-session and per-project-scope change counters for stream invalidation,
 * plus the throttle that keeps one streaming session from rebuilding the
 * project list on every checkpoint. Counters follow the store's transaction:
 * in-flight increments are visible to the owner and folded in on commit.
 */
export class SessionChangeVersions {
  private readonly scopes = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private readonly pendingScopes = new Map<string, number>();
  private readonly pendingSessions = new Map<string, number>();
  private readonly listed = new Map<string, { key: string; at: number }>();
  private readonly steps = new Map<string, number>();

  /** Moves only for changes inside a project that no single session explains. */
  scope(projectId: string, active: boolean): number {
    return (
      (this.scopes.get(projectId) ?? 0) + (active ? (this.pendingScopes.get(projectId) ?? 0) : 0)
    );
  }
  /** Moves on every save of this session, and only of this session. */
  session(sessionId: string, active: boolean): number {
    return (
      (this.sessions.get(sessionId) ?? 0) +
      (active ? (this.pendingSessions.get(sessionId) ?? 0) : 0)
    );
  }
  addScope(projectId: string, active: boolean): void {
    const target = active ? this.pendingScopes : this.scopes;
    target.set(projectId, (target.get(projectId) ?? 0) + 1);
  }
  addSession(sessionId: string, active: boolean): void {
    const target = active ? this.pendingSessions : this.sessions;
    target.set(sessionId, (target.get(sessionId) ?? 0) + 1);
  }
  get pendingChanged(): boolean {
    return this.pendingSessions.size > 0;
  }
  commit(): void {
    for (const [id, count] of this.pendingScopes)
      this.scopes.set(id, (this.scopes.get(id) ?? 0) + count);
    for (const [id, count] of this.pendingSessions)
      this.sessions.set(id, (this.sessions.get(id) ?? 0) + count);
    this.clearPending();
  }
  clearPending(): void {
    this.pendingScopes.clear();
    this.pendingSessions.clear();
  }
  /** After a rollback or cache drop the remembered list state may be wrong. */
  forgetListed(): void {
    this.listed.clear();
  }
  /**
   * Records a save: always moves the session's own version. Returns whether the
   * project version (which rebuilds the whole project list) must move too: when
   * the list-visible summary `key` changed, or the last move is older than
   * LIST_REFRESH_MS (revision/updatedAt churn from streaming). A sibling's
   * save never moves this session's version or the project scope.
   */
  saved(sessionId: string, key: string, active: boolean, now = Date.now()): boolean {
    this.addSession(sessionId, active);
    const last = this.listed.get(sessionId);
    const move = !last || last.key !== key || now - last.at >= LIST_REFRESH_MS;
    if (move) this.listed.set(sessionId, { key, at: now });
    this.steps.set(sessionId, move ? 1 : 0);
    return move;
  }
  /** The project-version step of the session's latest save. */
  lastStep(sessionId: string): number {
    return this.steps.get(sessionId) ?? 1;
  }
  /**
   * Drops a deleted session's counters and list cursor once its deletion has
   * committed. Sessions cannot be saved again after deletion. A reader that recorded
   * a non-zero counter sees it change to 0; a reader that recorded 0 is refreshed by
   * the project scope move the same deletion commits.
   */
  retire(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.listed.delete(sessionId);
    this.steps.delete(sessionId);
  }
}
