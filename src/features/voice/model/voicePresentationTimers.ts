/**
 * Shared presentation timers of the voice panel. Each one runs a single interval for however many
 * readouts subscribe, and sleeps while the document is hidden, so a long live session does not
 * wake the main thread for something nobody can see. Neither touches capture, playback or
 * session state; they only publish what the readouts paint.
 */

/** Input level above which the microphone counts as receiving sound. */
export const VOICE_HEARING_LEVEL = 0.04;
/** How often the shared sampler reads the measured input level. */
export const VOICE_HEARING_SAMPLE_MS = 120;
/** Cadence of the session clock and the elapsed time of running actions. */
export const VOICE_SECOND_MS = 1000;

type Listener = () => void;

/**
 * One interval for all subscribers. `visible` subscribers sleep while the document is hidden;
 * `always` ones do not. Becoming visible runs `sample` once so readouts catch up.
 */
class SharedTimer {
  private readonly visible = new Set<Listener>();
  private readonly always = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private listening = false;

  constructor(
    private readonly intervalMs: number,
    /** Runs each tick; calls `publish` when there is something to tell. */
    private readonly sample: (timer: SharedTimer) => void,
    /** Runs when the last subscriber leaves. */
    private readonly onIdle?: () => void,
  ) {}

  readonly subscribeVisible = (listener: Listener) => this.add(this.visible, listener);
  readonly subscribeAlways = (listener: Listener) => this.add(this.always, listener);

  /** Calls the listeners that may see this tick. */
  publish() {
    for (const listener of [...this.always, ...(document.hidden ? [] : this.visible)]) listener();
  }

  private add(set: Set<Listener>, listener: Listener) {
    set.add(listener);
    this.refresh();
    return () => {
      set.delete(listener);
      this.refresh();
    };
  }

  private readonly tick = () => this.sample(this);

  private readonly onVisibility = () => {
    if (!document.hidden) this.tick();
    this.refresh();
  };

  private refresh() {
    clearInterval(this.timer);
    this.timer = undefined;
    const subscribed = this.visible.size + this.always.size > 0;
    if (subscribed && !this.listening)
      document.addEventListener("visibilitychange", this.onVisibility);
    if (!subscribed && this.listening) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onIdle?.();
    }
    this.listening = subscribed;
    if (this.always.size || (this.visible.size && !document.hidden))
      this.timer = setInterval(this.tick, this.intervalMs);
  }
}

export type VoiceHearingStore = {
  /** Samples only while the document is visible. */
  subscribe: (listener: Listener) => () => void;
  /** Keeps sampling while hidden: the detached voice window mirrors the text from here. */
  subscribeAlways: (listener: Listener) => () => void;
  get: () => boolean;
};

const hearingStores = new WeakMap<object, VoiceHearingStore>();

/**
 * One sampler per audio-level ref, shared by every reader. Subscribers hear only about flips
 * between hearing and not hearing, never about each level value, so a streaming level does not
 * re-render them.
 */
export function voiceHearingStore(level: { readonly current: number }): VoiceHearingStore {
  const known = hearingStores.get(level);
  if (known) return known;
  let hearing = false;
  const timer = new SharedTimer(
    VOICE_HEARING_SAMPLE_MS,
    (shared) => {
      const next = level.current > VOICE_HEARING_LEVEL;
      if (next === hearing) return;
      hearing = next;
      shared.publish();
    },
    () => {
      hearing = false;
    },
  );
  const store: VoiceHearingStore = {
    subscribe: timer.subscribeVisible,
    subscribeAlways: timer.subscribeAlways,
    get: () => hearing,
  };
  hearingStores.set(level, store);
  return store;
}

let secondTimer: SharedTimer | undefined;

/**
 * Ticks every second, once for all readouts, while the document is visible, and once more when it
 * becomes visible again so elapsed times catch up. The listener paints its own readout.
 */
export function subscribeVoiceSecond(listener: Listener): () => void {
  secondTimer ??= new SharedTimer(VOICE_SECOND_MS, (shared) => shared.publish());
  return secondTimer.subscribeVisible(listener);
}
