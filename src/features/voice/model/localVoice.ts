import captureUrl from "./voiceCapture.js?url&no-inline";
import {
  localVoiceBackend,
  type LocalVoiceInfo,
  type LocalVoiceTranscript,
  type VoiceRuntimeConfig,
} from "./localVoiceClient";
import { VoiceVad, pcmBase64, resamplePcm } from "./voiceVad";
import { errorText } from "../../../shared/lib/errors";
import { speechTranscript } from "./voiceTranscript";
import { openMicrophone } from "./microphoneAccess";
import { t } from "../../../shared/i18n";

export type SpeechBinding = { sessionId?: string; sequence: number };
type Callbacks = {
  /** Snapshot the target at onset without cancelling the current reply. */
  start: () => SpeechBinding;
  /** Promote a snapshot only after recognition accepted actual words. */
  accept?: (binding: SpeechBinding) => SpeechBinding | undefined;
  /** Consume a recognized backchannel before it interrupts playback or pending work. */
  interceptTranscript?: (result: LocalVoiceTranscript, binding: SpeechBinding) => boolean;
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
  /** Only accepted words (or explicit mic reset) supersede pending ASR. */
  private acceptedSpeechEpoch = 0;
  private bindings = new Set<SpeechBinding>();
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
    private conversation: {
      turnEndSilence?: number;
      allowBargeIn?: boolean;
      manualTurnEnd?: boolean;
      languageLock?: string;
      deviceId?: string;
    } = {},
  ) {
    this.hint = language;
  }

  async connect() {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          t("Microphone access requires the desktop app or a secure browser context."),
        );
      this.info = await localVoiceBackend.start(this.config);
      if (this.closed) {
        await localVoiceBackend.release(this.info.lease);
        return;
      }
      this.stream = await openMicrophone({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(this.conversation.deviceId
            ? { deviceId: { exact: this.conversation.deviceId } }
            : {}),
        },
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
          this.binding = { ...this.callbacks.start() };
          this.bindings.add(this.binding);
          this.callbacks.state("speaking");
        },
        (audio) => {
          if (this.binding) void this.transcribe(audio, this.binding, this.speechEpoch);
        },
        () => {
          if (this.binding) this.bindings.delete(this.binding);
          this.callbacks.state("listening");
        },
        this.vadOptions(),
      );
      this.source = this.audio.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(this.audio, "bycoda-voice-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (
          this.closed ||
          this.muted ||
          (this.playbackActive && this.conversation.allowBargeIn === false)
        ) {
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
  private vadOptions() {
    const smart = Boolean(
      this.info?.turn &&
      this.conversation.turnEndSilence === undefined &&
      !this.conversation.manualTurnEnd,
    );
    return {
      endSilence: smart ? 1.3 : (this.conversation.turnEndSilence ?? 1.2),
      manualTurnEnd: this.conversation.manualTurnEnd,
      pause: smart
        ? (audio: Int16Array, pauseId: number) => {
            if (this.binding) void this.endpoint(audio, pauseId, this.binding, this.speechEpoch);
          }
        : undefined,
      limit: () =>
        this.callbacks.error(
          "Voice capture reached its limit. Finish this turn before continuing.",
        ),
    };
  }
  configureConversation(options: {
    turnEndSilence?: number;
    allowBargeIn?: boolean;
    manualTurnEnd?: boolean;
  }) {
    this.conversation = { ...this.conversation, ...options };
    const vadOptions = this.vadOptions();
    this.vad?.setEndSilence(vadOptions.endSilence, vadOptions.pause);
    this.vad?.setManualTurnEnd(this.conversation.manualTurnEnd === true);
  }
  finishTurn() {
    if (!this.closed && !this.muted) this.vad?.flush();
  }

  private async transcribe(audio: Int16Array, binding: SpeechBinding, epoch: number) {
    if (!this.info || this.closed) return;
    if (this.requests >= 2) {
      this.bindings.delete(binding);
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
      if (!this.closed && epoch > this.acceptedSpeechEpoch)
        this.acceptTranscript(result, binding, epoch);
    } catch {
      if (!this.closed)
        this.callbacks.error("Local speech recognition failed. Please speak again.");
    } finally {
      this.bindings.delete(binding);
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
      this.acceptTranscript(result, binding, epoch);
      this.bindings.delete(binding);
    } catch {
      // The fallback silence still transcribes the turn.
    } finally {
      this.requests--;
      if (ended && !this.closed && !this.requests) this.callbacks.state("listening");
    }
  }

  private acceptTranscript(result: LocalVoiceTranscript, binding: SpeechBinding, epoch: number) {
    const text = speechTranscript(result.text);
    if (!text || epoch <= this.acceptedSpeechEpoch) return;
    if (this.callbacks.interceptTranscript?.({ ...result, text }, binding)) {
      // A consumed spoken turn still supersedes older recognitions. It does not
      // promote the UI sequence or interrupt the answer being acknowledged.
      this.acceptedSpeechEpoch = epoch;
      return;
    }
    const accepted = this.callbacks.accept ? this.callbacks.accept(binding) : binding;
    if (!accepted) return;
    this.acceptedSpeechEpoch = epoch;
    // Other in-flight candidates took the same UI sequence snapshot. Carry our
    // own promotion forward; external cancellation still fails callbacks.accept.
    for (const pending of this.bindings)
      if (pending !== binding && pending.sequence === binding.sequence)
        pending.sequence = accepted.sequence;
    this.silence();
    if (!this.conversation.languageLock && /^[a-z]{2}$/.test(result.language))
      this.language = result.language;
    this.callbacks.transcript({ ...result, text }, accepted);
  }

  /** Speaks `text`, replacing current speech, or after it with `append` (streamed replies). */
  speak(text: string, append = false, delivered?: () => void): boolean {
    if (this.closed) return false;
    // A truncated utterance cannot prove delivery of the entire supplied text.
    if (text.length > 700) delivered = undefined;
    if (this.config?.natural) {
      if (!this.info || !this.audio || this.audio.state === "closed") return false;
      if (!append) {
        this.silence();
        this.naturalQueue = this.speakNatural(text.slice(0, 700), this.playbackEpoch, delivered);
        return true;
      }
      const epoch = this.playbackEpoch;
      this.naturalQueue = this.naturalQueue.then(() =>
        this.closed || epoch !== this.playbackEpoch
          ? undefined
          : this.speakNatural(text.slice(0, 700), epoch, delivered),
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
    utterance.onend = () => {
      if (!this.closed && epoch === this.playbackEpoch) {
        this.setPlayback(false);
        delivered?.();
      }
    };
    utterance.onerror = () => {
      if (epoch === this.playbackEpoch) this.setPlayback(false);
    };
    speechSynthesis.speak(utterance);
    return true;
  }

  private async speakNatural(text: string, epoch: number, delivered?: () => void) {
    const lease = this.info!.lease;
    let id: string | undefined;
    const completed: Promise<void>[] = [];
    let successful = false;
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
        if (chunk.done) {
          successful = true;
          break;
        }
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
        let finishPlayback!: () => void;
        completed.push(
          new Promise<void>((resolve) => {
            finishPlayback = resolve;
          }),
        );
        source.onended = () => {
          finishPlayback();
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
      if (successful && completed.length) {
        void Promise.all(completed).then(() => {
          if (!this.closed && epoch === this.playbackEpoch) delivered?.();
        });
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
    // While the reply plays, echo residue and breaths must not interrupt it.
    this.vad?.setStrict(active);
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
    this.acceptedSpeechEpoch = this.speechEpoch;
    this.bindings.clear();
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
    this.bindings.clear();
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
