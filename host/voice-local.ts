import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { localVoicePython } from "./voice-python";
import { inspectVoiceRuntime, voiceRuntimeConfig, type VoiceRuntimeConfig } from "./voice-runtime";
import { VoiceSpeechService } from "./voice-speech";

export type LocalVoiceInfo = { lease: string; model: string; device: string };
export type LocalVoiceTranscript = { text: string; language: string; inferenceMs: number };

export function validateVoiceAudio(audio: unknown, language: unknown) {
  if (
    typeof audio !== "string" ||
    audio.length < 4268 ||
    audio.length > 1_280_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)
  )
    throw new Error("Invalid voice audio.");
  const bytes = Buffer.from(audio, "base64");
  if (
    bytes.length < 3200 ||
    bytes.length > 960_000 ||
    bytes.length % 2 ||
    bytes.toString("base64") !== audio
  )
    throw new Error("Invalid voice audio.");
  if (language !== undefined && (typeof language !== "string" || !/^[a-z]{2}$/.test(language)))
    throw new Error("Invalid voice language.");
  return { audio, language };
}

/** One on-demand recognizer per host. Leases keep other desktop windows independent. */
export class LocalVoiceService {
  private speech = new VoiceSpeechService();
  private runtime: VoiceRuntimeConfig = {};
  private runtimeKey = "";
  private child?: ChildProcessWithoutNullStreams;
  private loading?: Promise<{ model: string; device: string }>;
  private leases = new Map<string, number>();
  private requests = new Map<
    string,
    {
      resolve: (value: LocalVoiceTranscript) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private idle?: ReturnType<typeof setInterval>;

  async start(value?: unknown): Promise<LocalVoiceInfo> {
    const config = voiceRuntimeConfig(value);
    const key = JSON.stringify(config);
    if (this.loading && this.runtimeKey !== key)
      throw new Error(
        "Voice settings changed. Disconnect voice in other windows before reconnecting.",
      );
    if (!this.loading) {
      if (value !== undefined) {
        const found = await inspectVoiceRuntime(config);
        if (!found.ready)
          throw new Error(
            `Voice setup is incomplete: ${found.missing.join(", ")}. Open Settings → Chat → Voice companion to choose installation paths.`,
          );
        // A concurrent start may have finished probing while this one was waiting.
        if (this.loading && this.runtimeKey !== key)
          throw new Error("Another voice configuration is connected.");
        if (!this.loading)
          this.runtime = {
            ...config,
            python: found.python,
            whisperPath: found.whisperPath,
            ttsPath: found.ttsPath,
          };
      } else if (!this.loading) this.runtime = config;
      this.runtimeKey = key;
    }
    const info = await this.ensureWorker();
    if (this.runtime.natural) {
      try {
        await this.speech.start(this.runtime);
      } catch (error) {
        if (!this.leases.size) this.close();
        throw error;
      }
    }
    const lease = randomUUID();
    this.leases.set(lease, Date.now());
    if (!this.idle) {
      this.idle = setInterval(() => {
        for (const [id, used] of this.leases)
          if (Date.now() - used > 90_000) {
            this.leases.delete(id);
            this.speech.release(id);
          }
        if (!this.leases.size && !this.requests.size) this.close();
      }, 15_000);
      this.idle.unref();
    }
    return { ...info, lease };
  }

  keepAlive(lease: unknown) {
    this.checkLease(lease);
    return { ready: Boolean(this.child) };
  }

  release(lease: unknown) {
    if (typeof lease === "string") this.speech.release(lease);
    if (typeof lease === "string") this.leases.delete(lease);
    if (!this.leases.size) this.close();
    return { released: true };
  }

  speak(lease: unknown, text: unknown) {
    this.checkLease(lease);
    return this.speech.speak(String(lease), text);
  }
  nextSpeech(lease: unknown, id: unknown) {
    this.checkLease(lease);
    return this.speech.next(String(lease), id);
  }
  cancelSpeech(lease: unknown, id: unknown) {
    this.checkLease(lease);
    this.speech.cancel(String(lease), id);
    return { cancelled: true };
  }

  async transcribe(
    lease: unknown,
    audio: unknown,
    language?: unknown,
  ): Promise<LocalVoiceTranscript> {
    this.checkLease(lease);
    const data = validateVoiceAudio(audio, language);
    if (this.requests.size >= 2)
      throw new Error("Speech recognition is busy. Please speak again after transcription.");
    await this.ensureWorker();
    if (this.requests.size >= 2)
      throw new Error("Speech recognition is busy. Please speak again after transcription.");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Local speech recognition timed out."));
        this.close();
      }, 30_000);
      this.requests.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, ...data }) + "\n", (error) => {
        if (error) this.close();
      });
    });
  }

  private checkLease(lease: unknown) {
    if (typeof lease !== "string" || !this.leases.has(lease))
      throw new Error("Voice connection expired. Start voice again.");
    this.leases.set(lease, Date.now());
  }

  private ensureWorker() {
    if (this.loading) return this.loading;
    const python =
      this.runtime.python ||
      process.env.BYCODA_VOICE_PYTHON ||
      (process.platform === "win32" ? "python" : "python3");
    this.loading = new Promise<{ model: string; device: string }>((resolve, reject) => {
      const child = (this.child = spawn(python, ["-u", "-c", localVoicePython], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          BYCODA_VOICE_CONFIG: JSON.stringify(this.runtime),
        },
      }));
      const timer = setTimeout(() => {
        reject(new Error("Local voice startup timed out."));
        this.close();
      }, 45_000);
      child.stderr.on("data", () => {}); // Never forward Python paths or diagnostics into transcripts.
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.length > 32000) {
          this.close();
          return;
        }
        try {
          const message = JSON.parse(line);
          if (
            message.ready &&
            typeof message.model === "string" &&
            typeof message.device === "string"
          ) {
            clearTimeout(timer);
            resolve(message);
          } else if (!message.id && message.error) {
            clearTimeout(timer);
            reject(new Error(String(message.error)));
            this.close();
          } else {
            const pending = this.requests.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.requests.delete(message.id);
            if (typeof message.text === "string" && message.text.length <= 16000)
              pending.resolve({
                text: message.text,
                language: String(message.language),
                inferenceMs: Number(message.inferenceMs),
              });
            else pending.reject(new Error("Local speech recognition failed."));
          }
        } catch {
          this.close();
        }
      });
      const failed = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Local voice needs Python, faster-whisper and a cached Whisper model on this computer.",
          ),
        );
        if (this.child === child) this.close();
      };
      child.on("error", failed);
      child.on("exit", failed);
    });
    return this.loading;
  }

  close() {
    this.speech.close();
    const child = this.child;
    this.child = undefined;
    this.loading = undefined;
    this.leases.clear();
    if (this.idle) clearInterval(this.idle);
    this.idle = undefined;
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Local voice disconnected."));
    }
    this.requests.clear();
    child?.kill();
  }
}
