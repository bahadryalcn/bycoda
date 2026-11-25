import type { SessionLifecycleState, SessionLifecycleView } from "./sessionLifecycle";

/** Project the latest gesture while the Host persists writes in gesture order. */
export class PendingLifecycle {
  private lastWrite: Promise<SessionLifecycleView> | undefined;
  private entries = new Map<
    string,
    { state: SessionLifecycleState; done: Promise<SessionLifecycleView> }
  >();

  project(records: ReadonlyMap<string, SessionLifecycleView>) {
    if (!this.entries.size) return records;
    const shown = new Map(records);
    for (const [sessionId, intent] of this.entries) {
      const current = records.get(sessionId);
      shown.set(sessionId, {
        sessionId,
        participants: current?.participants ?? [],
        state: intent.state,
      });
    }
    return shown;
  }

  change(
    sessionId: string,
    state: SessionLifecycleState,
    save: () => Promise<SessionLifecycleView>,
    notify: () => void,
  ) {
    const previous = this.entries.get(sessionId);
    if (previous?.state === state) return previous.done;
    // A bulk gesture updates every row together while its owning Host processes one write at a time.
    const request = this.lastWrite ? this.lastWrite.then(save, save) : save();
    const done = request.finally(() => {
      if (this.lastWrite === done) this.lastWrite = undefined;
      if (this.entries.get(sessionId)?.done === done) {
        this.entries.delete(sessionId);
        notify();
      }
    });
    this.entries.set(sessionId, { state, done });
    this.lastWrite = done;
    notify();
    return done;
  }
}
