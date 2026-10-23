import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { voiceSpeechPython } from "./voice-speech-python";
import type { VoiceRuntimeConfig } from "./voice-runtime";

export type VoiceChunk = { audio?: string; sampleRate?: number; done?: boolean; error?: string };
type Speech = { owner: string; chunks: VoiceChunk[]; waiter?: (value: VoiceChunk) => void };

/** One warm local synthesizer. A new utterance supersedes only its owner's playback. */
export class VoiceSpeechService {
  private child?: ChildProcessWithoutNullStreams;
  private loading?: Promise<void>;
  private speeches = new Map<string, Speech>();

  start(config: VoiceRuntimeConfig) {
    if (this.loading) return this.loading;
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
        reject(new Error("VoxCPM2 startup timed out."));
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
          const speech = this.speeches.get(message.id);
          if (!speech) return;
          const chunk: VoiceChunk = message.error
            ? { done: true, error: String(message.error) }
            : message.done
              ? { done: true }
              : { audio: message.audio, sampleRate: message.sampleRate };
          if (speech.waiter) {
            const waiter = speech.waiter;
            speech.waiter = undefined;
            waiter(chunk);
          } else if (speech.chunks.length < 410) speech.chunks.push(chunk);
          else this.cancel(speech.owner, message.id);
        } catch {
          this.close();
        }
      });
      const failed = () => {
        clearTimeout(timer);
        reject(new Error("VoxCPM2 disconnected. Check voice setup in Chat settings."));
        if (this.child === child) this.close();
      };
      child.on("error", failed);
      child.on("exit", failed);
      child.stdin.on("error", failed);
    });
    return this.loading;
  }

  speak(owner: string, text: unknown) {
    if (typeof text !== "string" || !text.trim() || text.length > 700)
      throw new Error("Invalid speech text.");
    if (!this.child) throw new Error("Natural voice is not connected.");
    // The GPU is shared: avoid silently interrupting another window's voice.
    if ([...this.speeches.values()].some((speech) => speech.owner !== owner))
      throw new Error("Natural voice is speaking in another window.");
    this.release(owner);
    const id = randomUUID();
    this.speeches.set(id, { owner, chunks: [] });
    this.child.stdin.write(JSON.stringify({ id, text }) + "\n");
    return { id };
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
    this.child?.stdin.write(JSON.stringify({ cancel: id }) + "\n");
    speech.waiter?.({ done: true });
    this.speeches.delete(String(id));
  }
  release(owner: string) {
    for (const [id, speech] of this.speeches) if (speech.owner === owner) this.cancel(owner, id);
  }
  close() {
    const child = this.child;
    this.child = undefined;
    this.loading = undefined;
    for (const speech of this.speeches.values())
      speech.waiter?.({ done: true, error: "Local voice disconnected." });
    this.speeches.clear();
    child?.kill();
  }
}
