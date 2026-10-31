import captureUrl from "./voiceCapture.js?url&no-inline";
import {
  localVoiceBackend,
  type LocalVoiceInfo,
  type LocalVoiceTranscript,
  type VoiceRuntimeConfig,
} from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { errorText } from "../../../shared/lib/errors";

export type SpeechBinding = { sessionId?: string; sequence: number };
type Callbacks = {
  start: () => SpeechBinding;
  transcript: (result: LocalVoiceTranscript, binding: SpeechBinding) => void;
  state: (state: "speaking" | "transcribing" | "listening") => void;
  error: (message: string, fatal?: boolean) => void;
  playback?: (active: boolean) => void;
};

/** Local audio capture + local ASR. No remote audio or provider credentials. */
export class LocalVoice {
  private stream?: MediaStream;
  private audio?: AudioContext;
  /** Playback runs at the device rate; the 16 kHz capture context would turn
   * 44–48 kHz speech into telephone quality. */
  private output?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private vad?: VoiceVad;
  private info?: LocalVoiceInfo;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private muted = false;
  private requests = 0;
  private speechEpoch = 0;
  private binding?: SpeechBinding;
  private playbackEpoch = 0;
  private speechId?: string;
  private playback = new Set<AudioBufferSourceNode>();
  private playbackStarts = new Map<AudioBufferSourceNode, ReturnType<typeof setTimeout>>();
  private playbackActive = false;
  /** Natural sentences are synthesized one after another (the Host speaks one at a time). */
  private naturalQueue: Promise<void> = Promise.resolve();
  /** Audio clock time where the next natural chunk starts, shared by queued sentences. */
  private nextTime?: number;
  /** App language: Whisper uses it when its own language guess is uncertain. */
  private readonly hint: string;
  constructor(
    private callbacks: Callbacks,
    private language: string,
    private config?: VoiceRuntimeConfig,
    /** Shared with the decorative visualizer; capture never causes React renders. */
    readonly level = { current: 0 },
  ) {
    this.hint = language;
  }

  async connect() {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Microphone access requires the desktop app or a secure browser context.");
      this.info = await localVoiceBackend.start(this.config);
      if (this.closed) {
        await localVoiceBackend.release(this.info.lease);
        return;
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.closed) {
        this.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.audio = new AudioContext({ sampleRate: 16000 });
      await this.audio.resume();
      await this.audio.audioWorklet.addModule(captureUrl);
      if (this.closed) return;
      this.vad = new VoiceVad(
        this.audio.sampleRate,
        () => {
          this.speechEpoch++;
          this.silence();
          this.binding = this.callbacks.start();
          this.callbacks.state("speaking");
        },
        (audio) => {
          if (this.binding) void this.transcribe(audio, this.binding, this.speechEpoch);
        },
        () => this.callbacks.state("listening"),
        // With Smart Turn, a finished sentence ends after ~0.2 s instead of 0.6 s,
        // and a mid-sentence pause keeps listening up to 1.3 s.
        this.info.turn
          ? {
              endSilence: 1.3,
              pause: (audio, pauseId) => {
                if (this.binding)
                  void this.endpoint(audio, pauseId, this.binding, this.speechEpoch);
              },
            }
          : {},
      );
      this.source = this.audio.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(this.audio, "bycoda-voice-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (this.closed || this.muted) {
          this.level.current = 0;
          return;
        }
        const frame = new Int16Array(event.data);
        let squares = 0;
        for (const sample of frame) squares += (sample / 32768) ** 2;
        const rms = frame.length ? Math.sqrt(squares / frame.length) : 0;
        const next = Math.min(1, rms);
        const smoothing = next > this.level.current ? 0.55 : 0.2;
        this.level.current += (next - this.level.current) * smoothing;
        this.vad?.push(frame);
      };
      this.source.connect(this.capture);
      this.capture.connect(this.audio.destination);
      this.heartbeat = setInterval(() => {
        if (this.info && !this.closed)
          void localVoiceBackend.keepAlive(this.info.lease).catch(() => {
            this.close();
            this.callbacks.error("Local voice disconnected. Start voice again.", true);
          });
      }, 30_000);
      this.callbacks.state("listening");
      return this.info;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private async transcribe(audio: Int16Array, binding: SpeechBinding, epoch: number) {
    if (!this.info || this.closed) return;
    if (this.requests >= 2) {
      this.callbacks.error("Speech recognition is busy. Please speak again.");
      return;
    }
    this.requests++;
    this.callbacks.state("transcribing");
    try {
      const result = await localVoiceBackend.transcribe(
        this.info.lease,
        pcmBase64(resamplePcm(audio, this.audio!.sampleRate)),
        /^[a-z]{2}$/.test(this.hint) ? this.hint : undefined,
      );
      // A correction spoken while ASR is running supersedes its older result.
      if (!this.closed && epoch === this.speechEpoch && result.text.trim()) {
        if (/^[a-z]{2}$/.test(result.language)) this.language = result.language;
        this.callbacks.transcript(result, binding);
      }
    } catch {
      if (!this.closed)
        this.callbacks.error("Local speech recognition failed. Please speak again.");
    } finally {
      this.requests--;
      if (!this.closed && !this.requests) this.callbacks.state("listening");
    }
  }

  /** Asks at a pause whether the sentence is finished; if so, its text ends the turn. */
  private async endpoint(
    audio: Int16Array,
    pauseId: number,
    binding: SpeechBinding,
    epoch: number,
  ) {
    // A busy recognizer simply leaves the decision to the fallback silence.
    if (!this.info || this.closed || this.requests >= 2) return;
    this.requests++;
    let ended = false;
    try {
      const result = await localVoiceBackend.endpoint(
        this.info.lease,
        pcmBase64(resamplePcm(audio, this.audio!.sampleRate)),
        /^[a-z]{2}$/.test(this.hint) ? this.hint : undefined,
      );
      if (this.closed || epoch !== this.speechEpoch || !("text" in result)) return;
      // The speaker may have continued while the check ran; then the turn goes on.
      if (!this.vad?.commit(pauseId)) return;
      ended = true;
      if (!result.text.trim()) return;
      if (/^[a-z]{2}$/.test(result.language)) this.language = result.language;
      this.callbacks.transcript(result, binding);
    } catch {
      // The fallback silence still transcribes the turn.
    } finally {
      this.requests--;
      if (ended && !this.closed && !this.requests) this.callbacks.state("listening");
    }
  }

  /** Speaks `text`, replacing current speech, or after it with `append` (streamed replies). */
  speak(text: string, append = false): boolean {
    if (this.closed) return false;
    if (this.config?.natural) {
      if (!this.info || !this.audio || this.audio.state === "closed") return false;
      if (!append) {
        this.silence();
        this.naturalQueue = this.speakNatural(text.slice(0, 700), this.playbackEpoch);
        return true;
      }
      const epoch = this.playbackEpoch;
      this.naturalQueue = this.naturalQueue.then(() =>
        this.closed || epoch !== this.playbackEpoch
          ? undefined
          : this.speakNatural(text.slice(0, 700), epoch),
      );
      return true;
    }
    if (this.closed || !globalThis.speechSynthesis) return false;
    const voices = speechSynthesis.getVoices().filter((voice) => voice.localService);
    const voice = voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === this.language);
    if (!voice) return false; // Never silently send speech to a network voice.
    // Queued utterances play in order; a new reply replaces them.
    if (!append) this.silence();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 700));
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const epoch = this.playbackEpoch;
    utterance.onstart = () => {
      if (!this.closed && epoch === this.playbackEpoch) this.setPlayback(true);
    };
    utterance.onend = utterance.onerror = () => {
      if (epoch === this.playbackEpoch) this.setPlayback(false);
    };
    speechSynthesis.speak(utterance);
    return true;
  }

  private async speakNatural(text: string, epoch: number) {
    const lease = this.info!.lease;
    let id: string | undefined;
    try {
      ({ id } = await localVoiceBackend.speak(
        lease,
        text,
        /^[a-z]{2}$/.test(this.language) ? this.language : undefined,
      ));
      if (this.closed || epoch !== this.playbackEpoch) {
        await localVoiceBackend.speechCancel(lease, id);
        return;
      }
      this.speechId = id;
      const context = (this.output ??= new AudioContext());
      await context.resume();
      while (!this.closed && epoch === this.playbackEpoch) {
        const chunk = await localVoiceBackend.speechNext(lease, id);
        if (this.closed || epoch !== this.playbackEpoch) break;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.done) break;
        if (!chunk.audio) continue;
        const rate = chunk.sampleRate ?? 0;
        if (!Number.isInteger(rate) || rate < 16000 || rate > 48000 || chunk.audio.length > 262144)
          throw new Error("Invalid local speech audio.");
        const bytes = Uint8Array.from(atob(chunk.audio), (value) => value.charCodeAt(0));
        if (!bytes.length || bytes.length % 2) throw new Error("Invalid local speech audio.");
        const samples = new DataView(bytes.buffer);
        const buffer = context.createBuffer(1, bytes.length / 2, rate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) channel[i] = samples.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        this.playback.add(source);
        source.onended = () => {
          const timer = this.playbackStarts.get(source);
          if (timer !== undefined) clearTimeout(timer);
          this.playbackStarts.delete(source);
          source.disconnect();
          this.playback.delete(source);
          if (epoch === this.playbackEpoch && !this.playback.size) this.setPlayback(false);
        };
        // Continue right after queued audio; after a gap, buffer again against
        // underruns. Only streamed VoxCPM2 audio needs that buffer: Supertonic
        // delivers each sentence complete.
        const lead = this.config?.engine === "voxcpm2" ? 0.35 : 0.05;
        const start =
          this.nextTime !== undefined && this.nextTime > context.currentTime
            ? this.nextTime
            : context.currentTime + lead;
        source.start(start);
        this.watchPlaybackStart(source, context, start, epoch);
        this.nextTime = start + buffer.duration;
      }
    } catch (cause) {
      if (!this.closed && epoch === this.playbackEpoch) {
        this.silence();
        this.callbacks.error(errorText(cause).trim() || "Local voice playback failed.");
      }
    } finally {
      if (this.speechId === id) this.speechId = undefined;
      if (id) void localVoiceBackend.speechCancel(lease, id).catch(() => {});
    }
  }

  private setPlayback(active: boolean) {
    if (this.playbackActive === active) return;
    this.playbackActive = active;
    this.callbacks.playback?.(active);
  }

  private watchPlaybackStart(
    source: AudioBufferSourceNode,
    context: AudioContext,
    startTime: number,
    epoch: number,
  ) {
    // Web Audio has no onstart event. Use its clock, rather than reporting queued
    // synthesis as audible speech. A suspended context must not start the visual.
    const check = () => {
      if (this.closed || epoch !== this.playbackEpoch || !this.playback.has(source)) return;
      const remaining = startTime - context.currentTime;
      if (context.state === "running" && remaining <= 0) {
        this.playbackStarts.delete(source);
        this.setPlayback(true);
      } else {
        this.playbackStarts.set(source, setTimeout(check, Math.max(16, remaining * 1000)));
      }
    };
    check();
  }

  mute(value: boolean) {
    this.muted = value;
    this.level.current = 0;
    this.vad?.reset();
    this.speechEpoch++;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !value;
    });
  }
  silence() {
    this.playbackEpoch++;
    this.naturalQueue = Promise.resolve();
    this.nextTime = undefined;
    for (const timer of this.playbackStarts.values()) clearTimeout(timer);
    this.playbackStarts.clear();
    this.setPlayback(false);
    for (const source of this.playback) {
      source.stop();
      source.disconnect();
    }
    this.playback.clear();
    if (this.speechId && this.info)
      void localVoiceBackend.speechCancel(this.info.lease, this.speechId).catch(() => {});
    this.speechId = undefined;
    globalThis.speechSynthesis?.cancel();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.level.current = 0;
    this.silence();
    this.vad?.reset();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.audio && this.audio.state !== "closed") void this.audio.close();
    if (this.output && this.output.state !== "closed") void this.output.close();
    if (this.info) void localVoiceBackend.release(this.info.lease).catch(() => {});
  }
}
