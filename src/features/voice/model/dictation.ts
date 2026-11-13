import captureUrl from "./voiceCapture.js?url&no-inline";
import {
  localVoiceBackend,
  type CloudDictationProvider,
  type VoiceRuntimeConfig,
} from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { errorText } from "../../../shared/lib/errors";
import { openMicrophone } from "./microphoneAccess";
import { t } from "../../../shared/i18n";
import { processDictationText, type DictationProcessingOptions } from "./dictationProcessing";

const noop = () => {};
/** New speech (seconds) before the next live preview of the phrase in progress.
 * Cloud previews are sparser because each one is a billed request. */
const PREVIEW_SECONDS = { local: 0.9, cloud: 1.4 };

export type DictationState = "idle" | "starting" | "listening" | "finishing";
type Callbacks = {
  /**
   * Recognized text in spoken order. `final: false` is a live preview of the
   * phrase in progress; the next call (preview or final) replaces it. A final
   * call may be empty when the preview turned out to be no speech.
   */
  text: (text: string, final: boolean) => void;
  state: (state: DictationState) => void;
  error: (message: string) => void;
  /** Normalized microphone RMS; zero after capture stops. */
  level?: (level: number) => void;
};

/**
 * Microphone-to-text for the composer, with the local recognizer (no natural
 * speech) or a cloud speech-to-text provider through the Host. While a phrase is
 * spoken it is previewed about every second; each pause ends the phrase, which is
 * transcribed and handed over at once; stopping transcribes the unfinished phrase.
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
  /** The recognizer is reachable; until then audio is buffered and state stays "starting". */
  private ready = false;
  /** Ended phrases whose final text has not been handed over yet. */
  private finals = 0;
  /** Increments when a phrase ends, so a late preview cannot overwrite it. */
  private phrase = 0;
  private previewing = false;
  /** Phrase length (samples) at the last preview. */
  private previewed = 0;
  private rawChunks: Int16Array[] = [];
  private rawLength = 0;
  private audioRate = 16000;
  private readonly cleanupRunId = crypto.randomUUID();

  constructor(
    private callbacks: Callbacks,
    /** App language: Whisper uses it when its own language guess is uncertain. */
    private language: string,
    private config?: VoiceRuntimeConfig,
    private microphoneId?: string,
    private engine: "local" | CloudDictationProvider = "local",
    /** Cloud transcription model; omitted uses the provider default. */
    private model?: string,
    private processing: DictationProcessingOptions = {},
  ) {
    this.processing = {
      ...processing,
      ...(processing.dictionary
        ? {
            dictionary: processing.dictionary.map((entry) => ({
              ...entry,
              aliases: [...entry.aliases],
            })),
          }
        : {}),
      ...(processing.cleanup ? { cleanup: { ...processing.cleanup } } : {}),
    };
  }

  async start() {
    this.callbacks.state("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          t("Microphone access requires the desktop app or a secure browser context."),
        );
      // The microphone opens while the recognizer loads (seconds when it is cold):
      // phrases spoken meanwhile wait for it instead of being lost or delayed.
      // Cloud dictation needs no lease; the Host holds the provider sign-in.
      const backend = this.engine !== "local" ? Promise.resolve("") : this.startLocal();
      this.backend = backend;
      backend.catch((cause) => this.fail(cause));
      const stream = await openMicrophone({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(this.microphoneId ? { deviceId: { exact: this.microphoneId } } : {}),
        },
        video: false,
      });
      this.stream = stream;
      if (this.closed) return this.stopCapture();
      const audio = (this.audio = new AudioContext({ sampleRate: 16000 }));
      await audio.resume();
      await audio.audioWorklet.addModule(captureUrl);
      if (this.closed) return this.stopCapture();
      const rate = audio.sampleRate;
      this.audioRate = rate;
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
        if (this.processing.silenceFilter === false) {
          this.rawChunks.push(frame);
          this.rawLength += frame.length;
          if (this.rawLength >= rate * 19) this.flushRaw(rate);
        } else {
          this.vad?.push(frame);
          this.preview(rate);
        }
      };
      this.source.connect(this.capture);
      this.capture.connect(audio.destination);
      // "Listening" only once speech can turn into text; until then the button
      // keeps showing preparation while the microphone buffers what is said.
      void backend.then(() => {
        if (this.closed) return;
        this.ready = true;
        this.callbacks.state("listening");
      }, noop);
    } catch (cause) {
      this.fail(cause);
    }
  }

  private startLocal() {
    return localVoiceBackend.start(this.config, true).then(({ lease }) => {
      if (this.closed) {
        void localVoiceBackend.release(lease).catch(() => {});
        throw new Error("Dictation was cancelled.");
      }
      this.lease = lease;
      // Runs until the final release, so it also covers the stop() drain.
      this.heartbeat = setInterval(() => {
        const current = this.lease;
        if (!current || this.closed) return;
        void localVoiceBackend.keepAlive(current).catch((cause) => this.fail(cause));
      }, 30_000);
      return lease;
    });
  }

  /** Recognizes `audio`, waiting for the recognizer and a free slot (Host limit: two). */
  private recognize(audio: Int16Array, rate: number) {
    const backend = this.backend!;
    const pcm = pcmBase64(resamplePcm(audio, rate));
    const hint = /^[a-z]{2}$/.test(this.language) ? this.language : undefined;
    const slot = this.inflight.length >= 2 ? this.inflight[0] : undefined;
    const pending = Promise.all([backend, slot]).then(([lease]) => {
      if (this.closed) return { text: "" };
      return this.engine === "local"
        ? localVoiceBackend.transcribe(lease, pcm, hint)
        : localVoiceBackend.cloudTranscribe(this.engine, pcm, hint, this.model);
    });
    this.inflight = [...this.inflight, pending.then(noop, noop)].slice(-2);
    return pending;
  }

  /**
   * Live text while a phrase is still spoken. One preview at a time and none while
   * a finished phrase is pending, so previews never delay or reorder final text.
   */
  private preview(rate: number) {
    if (this.closed || !this.ready || this.previewing || this.finals) return;
    const audio = this.vad?.current();
    const step = PREVIEW_SECONDS[this.engine === "local" ? "local" : "cloud"];
    if (!audio || audio.length - this.previewed < rate * step) return;
    this.previewed = audio.length;
    this.previewing = true;
    const phrase = this.phrase;
    void this.recognize(audio, rate)
      .then(({ text }) => {
        const value = text.trim();
        if (value && !this.closed && phrase === this.phrase && !this.finals)
          this.callbacks.text(value, false);
      }, noop)
      .finally(() => {
        this.previewing = false;
      });
  }

  private flushRaw(rate: number) {
    const chunks = this.rawChunks;
    const length = this.rawLength;
    this.rawChunks = [];
    this.rawLength = 0;
    if (length < rate * 0.1) return;
    const audio = new Int16Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    this.transcribe(audio, rate);
  }

  private fail(cause: unknown) {
    if (this.closed) return;
    this.cancel();
    this.callbacks.error(errorText(cause).trim() || t("Dictation could not start."));
  }

  private transcribe(audio: Int16Array, rate: number) {
    if (!this.backend || this.closed) return;
    // At most two recognitions in flight (the Host's limit), so phrases buffered
    // while the recognizer loaded do not overrun it once it is ready.
    const pending = this.recognize(audio, rate);
    this.phrase++;
    this.previewed = 0;
    this.finals++;
    this.queue = this.queue.then(async () => {
      try {
        let text = processDictationText((await pending).text.trim(), this.processing);
        if (text && this.processing.cleanup?.enabled && !this.closed) {
          try {
            const cleanup = this.processing.cleanup;
            text = (
              await localVoiceBackend.processDictation({
                text,
                runId: this.cleanupRunId,
                model: cleanup.model,
                instructions: cleanup.instructions,
                correctionCue: cleanup.correctionCue,
                translateToEnglish: cleanup.translateToEnglish,
              })
            ).text;
          } catch {
            // Keep the recognized phrase when cleanup is unavailable; never lose speech.
            if (!this.closed)
              this.callbacks.error(
                t("Dictation cleanup failed. The original transcript was kept."),
              );
          }
        }
        // Delivered even when empty, so a preview of no real speech is removed.
        if (!this.closed) this.callbacks.text(text, true);
      } catch (cause) {
        if (!this.closed)
          this.callbacks.error(
            this.engine === "local"
              ? t("Speech recognition failed. Please try again.")
              : errorText(cause).trim() || t("Speech recognition failed. Please try again."),
          );
      } finally {
        this.finals--;
      }
    });
  }

  /** Stops the microphone, transcribes what was already said, then releases. */
  async stop() {
    if (this.closed) return;
    this.callbacks.state("finishing");
    this.stopCapture();
    if (this.processing.silenceFilter === false) this.flushRaw(this.audioRate);
    else this.vad?.flush();
    await this.queue;
    this.cancel();
  }

  /** Releases everything at once and discards pending phrases. */
  cancel() {
    if (this.closed) return;
    this.closed = true;
    if (this.processing.cleanup?.enabled) {
      void localVoiceBackend.cancelDictationCleanup(this.cleanupRunId).catch(noop);
    }
    this.stopCapture();
    this.rawChunks = [];
    this.rawLength = 0;
    this.stopHeartbeat();
    this.release();
    this.callbacks.state("idle");
  }

  private stopCapture() {
    this.callbacks.level?.(0);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.audio && this.audio.state !== "closed") void this.audio.close().catch(noop);
    // Start may still be resuming after a cancel and call this again.
    this.stream = undefined;
    this.audio = undefined;
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private release() {
    const lease = this.lease;
    this.lease = undefined;
    if (lease) void localVoiceBackend.release(lease).catch(() => {});
  }
}
