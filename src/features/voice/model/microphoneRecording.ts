import { openMicrophone } from "./microphoneAccess";

export type MicrophoneRecordingState = "idle" | "requesting" | "recording" | "ready" | "playing";

/** Explicit, local-only ten-second recording. Never transcribes or uploads audio. */
export class MicrophoneRecording {
  private generation = 0;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private url?: string;
  private player?: HTMLAudioElement;
  private disposed = false;
  constructor(
    private readonly changed: (state: MicrophoneRecordingState, error?: string) => void,
  ) {}

  async record(microphoneId?: string) {
    this.reset();
    const generation = this.generation;
    this.changed("requesting");
    try {
      if (typeof MediaRecorder === "undefined")
        throw new Error("Audio recording is unavailable in this browser.");
      const stream = await openMicrophone({
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        video: false,
      });
      if (generation !== this.generation || this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const chunks: Blob[] = [];
      let bytes = 0;
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (generation !== this.generation || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 4 * 1024 * 1024) {
          this.reset();
          this.changed("idle", "The microphone recording exceeded its size limit. Try again.");
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.reset();
        this.changed("idle", "Microphone recording failed. Try again.");
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        this.releaseCapture();
        if (!chunks.length) {
          this.changed("idle", "No microphone audio was recorded. Try again.");
          return;
        }
        this.url = URL.createObjectURL(
          new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type }),
        );
        this.changed("ready");
      };
      recorder.start(250);
      this.changed("recording");
      this.timer = setTimeout(() => this.stop(), 10_000);
    } catch (cause) {
      if (generation !== this.generation || this.disposed) return;
      this.reset();
      this.changed("idle", cause instanceof Error ? cause.message : String(cause));
    }
  }

  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.releaseCapture();
  }

  async play() {
    if (!this.url || this.disposed) return;
    const generation = this.generation;
    this.player?.pause();
    const player = new Audio(this.url);
    this.player = player;
    player.onended = () => {
      if (generation === this.generation) this.changed("ready");
    };
    player.onerror = () => {
      if (generation === this.generation)
        this.changed("ready", "Audio playback failed. Record another test.");
    };
    try {
      await player.play();
      if (generation === this.generation) this.changed("playing");
      else player.pause();
    } catch {
      if (generation === this.generation)
        this.changed("ready", "Audio playback failed. Record another test.");
    }
  }

  cancel() {
    this.reset();
    if (!this.disposed) this.changed("idle");
  }
  dispose() {
    this.disposed = true;
    this.reset();
  }

  private releaseCapture() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }

  private reset() {
    this.generation++;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = undefined;
    this.releaseCapture();
    this.player?.pause();
    this.player = undefined;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
  }
}
