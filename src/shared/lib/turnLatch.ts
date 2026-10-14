type TurnState<Event> = {
  turnDone: (() => void) | null;
  turnFailed: unknown;
  turnEndPending: boolean;
  onEvent: (event: Event) => void;
};

/** Shared settlement only; provider cleanup and early guards remain in their adapter. */
export class TurnLatch {
  static finish<Event>(state: TurnState<Event>, events: Event[] = []): void {
    for (const event of events) state.onEvent(event);
    const done = state.turnDone;
    const failed = state.turnFailed;
    state.turnDone = null;
    state.turnFailed = null;
    if (done) {
      done();
      return;
    }
    if (!failed) state.turnEndPending = true;
  }

  static settle<Event>(state: TurnState<Event>, finish: () => void): void {
    if (state.turnEndPending && state.turnDone) finish();
  }
}
