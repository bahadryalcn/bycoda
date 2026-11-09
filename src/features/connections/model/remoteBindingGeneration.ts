/**
 * Immutable identity of one remote binding read. A token captured when a read
 * starts stays comparable after the pane rebinds, so a late snapshot, history
 * page or block never lands on a newer binding.
 */
export interface RemoteBindingToken {
  readonly version: number;
  /** Host/environment/session identity the read was started for. */
  readonly key: string;
  /** Remote session the read was started for. */
  readonly session: string | undefined;
}

/**
 * Generation owner for a pane's remote binding. RemoteSession is its only
 * writer; reads (poll, channel, history pages, large blocks) and operations
 * capture a token and check it again before applying a result.
 */
export class RemoteBindingGeneration {
  private generation = 0;
  private bound: string | undefined;
  private trackedKey: string;
  private deletedKey: string | undefined;
  private deleting: string | undefined;

  constructor(session: string | undefined, key: string) {
    this.bound = session;
    this.trackedKey = key;
  }

  /** Current generation; any rebinding increments it. */
  get version() {
    return this.generation;
  }

  /** Remote session currently bound to the pane. */
  get session() {
    return this.bound;
  }

  /** Identity recorded by the latest render. */
  get key() {
    return this.trackedKey;
  }

  /** Records the identity of the latest render. */
  track(key: string) {
    this.trackedKey = key;
  }

  /** A different session is being bound: older reads become stale. */
  advance() {
    this.generation++;
    this.deletedKey = undefined;
  }

  /** Binds a session without invalidating reads (the pane's own create/open). */
  bind(session: string | undefined) {
    this.bound = session;
  }

  capture(
    key: string = this.trackedKey,
    session: string | undefined = this.bound,
  ): RemoteBindingToken {
    return { version: this.generation, key, session };
  }

  /** The binding generation is unchanged and the Host did not delete it. */
  isCurrent(token: RemoteBindingToken) {
    return token.version === this.generation && this.deletedKey !== token.key;
  }

  /** `isCurrent`, and the pane is still bound to the token's session. */
  isBound(token: RemoteBindingToken) {
    return this.isCurrent(token) && this.bound === token.session;
  }

  /** A read is stale after disposal, rebinding, host deletion or local discard. */
  isStale(token: RemoteBindingToken) {
    return !this.isCurrent(token) || (!!token.session && this.deleting === token.session);
  }

  markDeleted(key: string) {
    this.deletedKey = key;
  }

  clearDeleted() {
    this.deletedKey = undefined;
  }

  isDeleted(key: string) {
    return this.deletedKey === key;
  }

  /** The latest rendered binding was deleted on the Host. */
  currentDeleted() {
    return this.deletedKey === this.trackedKey;
  }

  beginDiscard(session: string) {
    this.deleting = session;
  }

  endDiscard() {
    this.deleting = undefined;
  }
}
