import captureUrl from "./voiceCapture.js?url&no-inline";
import {
  localVoiceBackend,
  type LocalVoiceInfo,
  type LocalVoiceTranscript,
  type VoiceRuntimeConfig,
} from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";

export type SpeechBinding = { sessionId?: string; sequence: number };
type Callbacks = {
  start: () => SpeechBinding;
  transcript: (result: LocalVoiceTranscript, binding: SpeechBinding) => void;
  state: (state: "speaking" | "transcribing" | "listening") => void;
  error: (message: string, fatal?: boolean) => void;
};

/** Local audio capture + local ASR. No remote audio or provider credentials. */
export class LocalVoice {
  private stream?: MediaStream;
  private audio?: AudioContext;
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
  constructor(
    private callbacks: Callbacks,
    private language: string,
    private config?: VoiceRuntimeConfig,
  ) {}

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
      );
      this.source = this.audio.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(this.audio, "bycoda-voice-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.closed && !this.muted) this.vad?.push(new Int16Array(event.data));
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

  speak(text: string): boolean {
    if (this.closed) return false;
    if (this.config?.natural) {
      if (!this.info || !this.audio || this.audio.state === "closed") return false;
      this.silence();
      void this.speakNatural(text.slice(0, 700), this.playbackEpoch);
      return true;
    }
    if (this.closed || !globalThis.speechSynthesis) return false;
    const voices = speechSynthesis.getVoices().filter((voice) => voice.localService);
    const voice = voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === this.language);
    if (!voice) return false; // Never silently send speech to a network voice.
    this.silence();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 700));
    utterance.voice = voice;
    utterance.lang = voice.lang;
    speechSynthesis.speak(utterance);
    return true;
  }

  private async speakNatural(text: string, epoch: number) {
    const lease = this.info!.lease;
    let id: string | undefined;
    try {
      ({ id } = await localVoiceBackend.speak(lease, text));
      if (this.closed || epoch !== this.playbackEpoch) {
        await localVoiceBackend.speechCancel(lease, id);
        return;
      }
      this.speechId = id;
      const context = this.audio!;
      await context.resume();
      let nextTime: number | undefined;
      while (!this.closed && epoch === this.playbackEpoch) {
        const chunk = await localVoiceBackend.speechNext(lease, id);
        if (this.closed || epoch !== this.playbackEpoch) break;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.done) break;
        if (!chunk.audio) continue;
        if (chunk.sampleRate !== 48000 || chunk.audio.length > 262144)
          throw new Error("Invalid local speech audio.");
        const bytes = Uint8Array.from(atob(chunk.audio), (value) => value.charCodeAt(0));
        if (!bytes.length || bytes.length % 2) throw new Error("Invalid local speech audio.");
        const samples = new DataView(bytes.buffer);
        const buffer = context.createBuffer(1, bytes.length / 2, 48000);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) channel[i] = samples.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        this.playback.add(source);
        source.onended = () => {
          source.disconnect();
          this.playback.delete(source);
        };
        nextTime =
          nextTime === undefined
            ? context.currentTime + 0.35
            : Math.max(context.currentTime + 0.02, nextTime);
        source.start(nextTime);
        nextTime += buffer.duration;
      }
    } catch (cause) {
      if (!this.closed && epoch === this.playbackEpoch) {
        this.silence();
        this.callbacks.error(
          cause instanceof Error ? cause.message : "Local voice playback failed.",
        );
      }
    } finally {
      if (this.speechId === id) this.speechId = undefined;
      if (id) void localVoiceBackend.speechCancel(lease, id).catch(() => {});
    }
  }

  mute(value: boolean) {
    this.muted = value;
    this.vad?.reset();
    this.speechEpoch++;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !value;
    });
  }
  silence() {
    this.playbackEpoch++;
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
    this.silence();
    this.vad?.reset();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.audio && this.audio.state !== "closed") void this.audio.close();
    if (this.info) void localVoiceBackend.release(this.info.lease).catch(() => {});
  }
}
