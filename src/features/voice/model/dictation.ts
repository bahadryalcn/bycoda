import captureUrl from "./voiceCapture.js?url&no-inline";
import { localVoiceBackend, type VoiceRuntimeConfig } from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { errorText } from "../../../shared/lib/errors";

export type DictationState = "idle" | "starting" | "listening" | "finishing";
type Callbacks = {
  /** One recognized phrase, in spoken order. */
  text: (text: string) => void;
  state: (state: DictationState) => void;
  error: (message: string) => void;
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
      const { lease } = await localVoiceBackend.start(this.config, true);
      this.lease = lease;
      if (this.closed) return this.release();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.closed) return this.release();
      this.audio = new AudioContext({ sampleRate: 16000 });
      await this.audio.resume();
      await this.audio.audioWorklet.addModule(captureUrl);
      if (this.closed) return this.release();
      const rate = this.audio.sampleRate;
      this.vad = new VoiceVad(
        rate,
        () => {},
        (audio) => this.transcribe(audio, rate),
      );
      this.source = this.audio.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(this.audio, "bycoda-voice-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
        this.vad?.push(new Int16Array(event.data));
      this.source.connect(this.capture);
      this.capture.connect(this.audio.destination);
      this.heartbeat = setInterval(() => {
        if (this.lease) void localVoiceBackend.keepAlive(this.lease).catch(() => this.cancel());
      }, 30_000);
      this.callbacks.state("listening");
    } catch (cause) {
      this.cancel();
      this.callbacks.error(errorText(cause).trim() || "Dictation could not start.");
    }
  }

  private transcribe(audio: Int16Array, rate: number) {
    const lease = this.lease;
    if (!lease) return;
    const pcm = pcmBase64(resamplePcm(audio, rate));
    const hint = /^[a-z]{2}$/.test(this.language) ? this.language : undefined;
    const pending = localVoiceBackend.transcribe(lease, pcm, hint);
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
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.audio && this.audio.state !== "closed") void this.audio.close();
  }

  private release() {
    const lease = this.lease;
    this.lease = undefined;
    if (lease) void localVoiceBackend.release(lease).catch(() => {});
  }
}
