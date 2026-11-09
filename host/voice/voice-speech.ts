import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { voiceSpeechPython } from "./voice-speech-python";
import type { VoiceRuntimeConfig } from "./voice-runtime";
import { ELEVENLABS_SAMPLE_RATE, streamElevenLabs } from "./voice-elevenlabs";

export type VoiceChunk = { audio?: string; sampleRate?: number; done?: boolean; error?: string };
type Speech = {
  owner: string;
  chunks: VoiceChunk[];
  waiter?: (value: VoiceChunk) => void;
  /** Cloud synthesis only: stops the HTTP stream. */
  abort?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  ended?: boolean;
};
export type VoiceSpeechDependencies = {
  /** Reads a stored cloud voice key on the Host; never sent to the desktop. */
  cloudKey?: (provider: "elevenlabs") => Promise<string | undefined>;
  request?: typeof fetch;
};

/** One warm synthesizer: a local Python worker, or ElevenLabs over HTTPS.
 * A new utterance supersedes only its owner's playback. */
export class VoiceSpeechService {
  private child?: ChildProcessWithoutNullStreams;
  private cloud?: { key: string; voiceId?: string };
  private loading?: Promise<void>;
  private speeches = new Map<string, Speech>();

  constructor(private readonly dependencies: VoiceSpeechDependencies = {}) {}

  start(config: VoiceRuntimeConfig) {
    if (this.loading) return this.loading;
    if (config.engine === "elevenlabs") {
      const loading = (this.loading = (async () => {
        const key = await this.dependencies.cloudKey?.("elevenlabs").catch(() => undefined);
        if (!key) throw new Error("Add your ElevenLabs API key in Chat settings.");
        this.cloud = { key, ...(config.voiceId ? { voiceId: config.voiceId } : {}) };
      })());
      loading.catch(() => {
        if (this.loading === loading) this.close();
      });
      return loading;
    }
    this.loading = new Promise<void>((resolve, reject) => {
      const child = (this.child = spawn(config.python!, ["-u", "-c", voiceSpeechPython], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          BYCODA_VOICE_CONFIG: JSON.stringify(config),
        },
      }));
      const timer = setTimeout(() => {
        reject(new Error("Natural voice startup timed out."));
        this.close();
      }, 90_000);
      child.stderr.on("data", () => {});
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          if (line.length > 262144) throw new Error("Invalid speech chunk.");
          const message = JSON.parse(line);
          if (message.ready) {
            clearTimeout(timer);
            resolve();
            return;
          }
          if (!message.id && message.error) {
            reject(new Error(String(message.error)));
            this.close();
            return;
          }
          this.deliver(
            message.id,
            message.error
              ? { done: true, error: String(message.error) }
              : message.done
                ? { done: true }
                : { audio: message.audio, sampleRate: message.sampleRate },
          );
        } catch {
          this.close();
        }
      });
      const failed = () => {
        clearTimeout(timer);
        reject(new Error("Natural voice disconnected. Check voice setup in Chat settings."));
        if (this.child === child) this.close();
      };
      child.on("error", failed);
      child.on("exit", failed);
      child.stdin.on("error", failed);
    });
    return this.loading;
  }

  speak(owner: string, text: unknown, language?: unknown) {
    if (typeof text !== "string" || !text.trim() || text.length > 700)
      throw new Error("Invalid speech text.");
    if (language !== undefined && (typeof language !== "string" || !/^[a-z]{2}$/.test(language)))
      throw new Error("Invalid voice language.");
    if (!this.child && !this.cloud) throw new Error("Natural voice is not connected.");
    // The synthesizer is shared: avoid silently interrupting another window's voice.
    if ([...this.speeches.values()].some((speech) => speech.owner !== owner))
      throw new Error("Natural voice is speaking in another window.");
    this.release(owner);
    const id = randomUUID();
    if (this.cloud) {
      const abort = new AbortController();
      this.speeches.set(id, { owner, chunks: [], abort });
      this.armDeadline(id);
      void streamElevenLabs(
        {
          key: this.cloud.key,
          text,
          voiceId: this.cloud.voiceId,
          language: typeof language === "string" ? language : undefined,
          signal: abort.signal,
          request: this.dependencies.request,
        },
        (pcm) =>
          this.deliver(id, { audio: pcm.toString("base64"), sampleRate: ELEVENLABS_SAMPLE_RATE }),
      ).then(
        () => this.deliver(id, { done: true }),
        (error: unknown) =>
          this.deliver(id, {
            done: true,
            error: error instanceof Error ? error.message : "Local voice playback failed.",
          }),
      );
      return { id };
    }
    this.speeches.set(id, { owner, chunks: [] });
    this.armDeadline(id);
    this.child!.stdin.write(JSON.stringify({ id, text, ...(language ? { language } : {}) }) + "\n");
    return { id };
  }

  private armDeadline(id: string, ms = 30_000) {
    const speech = this.speeches.get(id);
    if (!speech) return;
    clearTimeout(speech.timer);
    speech.timer = setTimeout(() => {
      speech.abort?.abort();
      if (!speech.abort) this.child?.stdin.write(JSON.stringify({ cancel: id }) + "\n");
      this.deliver(id, { done: true, error: "Speech playback timed out. Try again." });
    }, ms);
    speech.timer.unref();
  }

  private deliver(id: string, chunk: VoiceChunk) {
    const speech = this.speeches.get(id);
    if (!speech || speech.ended) return;
    if (chunk.done) speech.ended = true;
    clearTimeout(speech.timer);
    if (!chunk.done) this.armDeadline(id, 15_000);
    if (speech.waiter) {
      const waiter = speech.waiter;
      speech.waiter = undefined;
      waiter(chunk);
    } else if (speech.chunks.length < 410) speech.chunks.push(chunk);
    else this.cancel(speech.owner, id);
  }

  async next(owner: string, id: unknown): Promise<VoiceChunk> {
    const speech = typeof id === "string" ? this.speeches.get(id) : undefined;
    if (!speech || speech.owner !== owner) throw new Error("Speech playback expired.");
    if (speech.waiter) throw new Error("Speech playback is already being read.");
    const chunk =
      speech.chunks.shift() ??
      (await new Promise<VoiceChunk>((resolve) => {
        const timer = setTimeout(() => {
          if (speech.waiter === done) speech.waiter = undefined;
          resolve({}); // Long-poll heartbeat, without ending playback.
        }, 10_000);
        const done = (value: VoiceChunk) => {
          clearTimeout(timer);
          resolve(value);
        };
        speech.waiter = done;
      }));
    if (chunk.done) this.speeches.delete(String(id));
    return chunk;
  }

  cancel(owner: string, id: unknown) {
    const speech = typeof id === "string" ? this.speeches.get(id) : undefined;
    if (!speech || speech.owner !== owner) return;
    clearTimeout(speech.timer);
    if (speech.abort) speech.abort.abort();
    else this.child?.stdin.write(JSON.stringify({ cancel: id }) + "\n");
    speech.waiter?.({ done: true });
    this.speeches.delete(String(id));
  }
  release(owner: string) {
    for (const [id, speech] of this.speeches) if (speech.owner === owner) this.cancel(owner, id);
  }
  close() {
    const child = this.child;
    this.child = undefined;
    this.cloud = undefined;
    this.loading = undefined;
    for (const speech of this.speeches.values()) {
      clearTimeout(speech.timer);
      speech.abort?.abort();
      speech.waiter?.({ done: true, error: "Local voice disconnected." });
    }
    this.speeches.clear();
    child?.kill();
  }
}
