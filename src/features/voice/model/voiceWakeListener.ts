import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { WAKE_LIMITS, WakeGuard } from "./voiceWakeGuard";
import { matchesWakePhrase } from "./voiceWakePhrase";

/** An open microphone: frames of mono PCM at `rate`, released by `close`. */
export type WakeCapture = { rate: number; close: () => void };
export type WakeDeps = {
  openCapture: (onFrame: (frame: Int16Array) => void) => Promise<WakeCapture>;
  /** Local recognizer only; resolves to the recognized text. */
  recognize: (pcm: string) => Promise<string>;
  /** Releases the recognizer. */
  closeRecognizer: () => void;
};
export type WakeListenerState = "listening" | "paused" | "stopped";
type Options = {
  phrase: string;
  onMatch: () => void;
  onState: (state: WakeListenerState) => void;
  onError: (cause: unknown) => void;
  guard?: WakeGuard;
};

/**
 * Local wake-phrase listener. Short speech bursts are cut by the voice VAD, recognized on this
 * computer and compared with the wake phrase. Audio stays in memory and is dropped after each
 * burst; non-matching text is never stored or logged. A match releases the microphone and the
 * recognizer before `onMatch` starts Talk.
 */
export class WakeListener {
  private capture?: WakeCapture;
  private stopped = false;
  private epoch = 0;
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private readonly guard: WakeGuard;
  constructor(
    private deps: WakeDeps,
    private options: Options,
  ) {
    this.guard = options.guard ?? new WakeGuard();
  }

  async start() {
    this.stopped = false;
    await this.open();
  }

  private async open() {
    const epoch = ++this.epoch;
    try {
      let vad: VoiceVad | undefined;
      const capture = await this.deps.openCapture((frame) => {
        if (epoch === this.epoch) vad?.push(frame);
      });
      vad = new VoiceVad(
        capture.rate,
        () => {},
        (audio) => void this.burst(audio, capture.rate, epoch),
      );
      if (this.stopped || epoch !== this.epoch) return capture.close();
      this.capture = capture;
      this.options.onState("listening");
    } catch (cause) {
      this.halt();
      this.options.onError(cause);
    }
  }

  private async burst(audio: Int16Array, rate: number, epoch: number) {
    if (epoch !== this.epoch || !audio.length) return;
    const verdict = this.guard.admit();
    if (verdict === "noisy") return this.pause();
    if (verdict !== "run") return;
    // Too long for a wake phrase: drop the audio without recognizing it.
    if ((audio.length / rate) * 1000 > WAKE_LIMITS.maxBurstMs) return this.guard.done();
    try {
      const heard = await this.deps.recognize(pcmBase64(resamplePcm(audio, rate)));
      if (epoch !== this.epoch || !matchesWakePhrase(heard, this.options.phrase)) return;
      this.halt();
      this.options.onMatch();
    } catch (cause) {
      if (epoch !== this.epoch) return;
      this.halt();
      this.options.onError(cause);
    } finally {
      this.guard.done();
    }
  }

  /** Noisy room: release everything for a while, then listen again. */
  private pause() {
    this.release();
    this.options.onState("paused");
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      if (!this.stopped) void this.open();
    }, WAKE_LIMITS.pauseMs);
  }

  private release() {
    this.epoch++;
    this.capture?.close();
    this.capture = undefined;
    this.deps.closeRecognizer();
  }

  private halt() {
    this.stopped = true;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    this.release();
    this.options.onState("stopped");
  }

  /** Releases the microphone and recognizer; safe to call more than once. */
  stop() {
    if (!this.stopped) this.halt();
  }
}
