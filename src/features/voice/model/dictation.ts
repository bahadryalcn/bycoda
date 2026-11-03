import captureUrl from "./voiceCapture.js?url&no-inline";
import { localVoiceBackend, type VoiceRuntimeConfig } from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { errorText } from "../../../shared/lib/errors";

const noop = () => {};

export type DictationState = "idle" | "starting" | "listening" | "finishing";
type Callbacks = {
  /** One recognized phrase, in spoken order. */
  text: (text: string) => void;
  state: (state: DictationState) => void;
  error: (message: string) => void;
  /** Normalized microphone RMS; zero after capture stops. */
  level?: (level: number) => void;
};

/**
 * Microphone-to-text for the composer. Uses the local recognizer only (no natural
 * speech, no provider). Each pause ends a phrase, which is transcribed and handed
 * over at once; stopping transcribes the unfinished phrase before releasing.
 */
export class Dictation {
  private lease?: string;
  private stream?: MediaStream;
  private audio?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private vad?: VoiceVad;
  private heartbeat?: ReturnType<typeof setInterval>;
  /** Resolves to the recognizer lease; capture does not wait for it. */
  private backend?: Promise<string>;
  /** Completion of the latest recognition requests, bounding concurrency. */
  private inflight: Promise<void>[] = [];
  /** Keeps phrases in spoken order even when recognition overlaps. */
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private callbacks: Callbacks,
    /** App language: Whisper uses it when its own language guess is uncertain. */
    private language: string,
    private config?: VoiceRuntimeConfig,
  ) {}

  async start() {
    this.callbacks.state("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Microphone access requires the desktop app or a secure browser context.");
      // The microphone opens while the recognizer loads (seconds when it is cold):
      // phrases spoken meanwhile wait for it instead of being lost or delayed.
      const backend = localVoiceBackend.start(this.config, true).then(({ lease }) => {
        if (this.closed) {
          void localVoiceBackend.release(lease).catch(() => {});
          throw new Error("Dictation was cancelled.");
        }
        this.lease = lease;
        this.heartbeat = setInterval(() => {
          if (this.lease) void localVoiceBackend.keepAlive(this.lease).catch(() => this.cancel());
        }, 30_000);
        return lease;
      });
      this.backend = backend;
      backend.catch((cause) => this.fail(cause));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.stream = stream;
      if (this.closed) return this.stopCapture();
      const audio = (this.audio = new AudioContext({ sampleRate: 16000 }));
      await audio.resume();
      await audio.audioWorklet.addModule(captureUrl);
      if (this.closed) return this.stopCapture();
      const rate = audio.sampleRate;
      this.vad = new VoiceVad(
        rate,
        () => {},
        (audio) => this.transcribe(audio, rate),
      );
      this.source = audio.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(audio, "bycoda-voice-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (this.closed) return;
        const frame = new Int16Array(event.data);
        let squares = 0;
        for (const sample of frame) squares += (sample / 32768) ** 2;
        this.callbacks.level?.(frame.length ? Math.min(1, Math.sqrt(squares / frame.length)) : 0);
        this.vad?.push(frame);
      };
      this.source.connect(this.capture);
      this.capture.connect(audio.destination);
      this.callbacks.state("listening");
    } catch (cause) {
      this.fail(cause);
    }
  }

  private fail(cause: unknown) {
    if (this.closed) return;
    this.cancel();
    this.callbacks.error(errorText(cause).trim() || "Dictation could not start.");
  }

  private transcribe(audio: Int16Array, rate: number) {
    const backend = this.backend;
    if (!backend || this.closed) return;
    const pcm = pcmBase64(resamplePcm(audio, rate));
    const hint = /^[a-z]{2}$/.test(this.language) ? this.language : undefined;
    // At most two recognitions in flight (the Host's limit), so phrases buffered
    // while the recognizer loaded do not overrun it once it is ready.
    const slot = this.inflight.length >= 2 ? this.inflight[0] : undefined;
    const pending = Promise.all([backend, slot]).then(([lease]) =>
      localVoiceBackend.transcribe(lease, pcm, hint),
    );
    this.inflight = [...this.inflight, pending.then(noop, noop)].slice(-2);
    this.queue = this.queue.then(async () => {
      try {
        const text = (await pending).text.trim();
        if (text && !this.closed) this.callbacks.text(text);
      } catch {
        if (!this.closed) this.callbacks.error("Speech recognition failed. Please try again.");
      }
    });
  }

  /** Stops the microphone, transcribes what was already said, then releases. */
  async stop() {
    if (this.closed) return;
    this.callbacks.state("finishing");
    this.stopCapture();
    this.vad?.flush();
    await this.queue;
    this.cancel();
  }

  /** Releases everything at once and discards pending phrases. */
  cancel() {
    if (this.closed) return;
    this.closed = true;
    this.stopCapture();
    this.release();
    this.callbacks.state("idle");
  }

  private stopCapture() {
    this.callbacks.level?.(0);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.audio && this.audio.state !== "closed") void this.audio.close().catch(noop);
    // Start may still be resuming after a cancel and call this again.
    this.stream = undefined;
    this.audio = undefined;
  }

  private release() {
    const lease = this.lease;
    this.lease = undefined;
    if (lease) void localVoiceBackend.release(lease).catch(() => {});
  }
}
