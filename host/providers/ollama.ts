import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  isOllamaModelName,
  type OllamaModel,
  type OllamaPull,
  type OllamaStatus,
} from "../../src/shared/model/host-contracts/ollama";
import { resolveOnPath } from "../mcp/hub/launch";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import {
  configuredOllamaModels,
  opencodeUserConfigPath,
  readOpencodeConfig,
  saveOllamaModelsToOpencode,
} from "./ollama-opencode-config";

export const OLLAMA_DEFAULT_PORT = 11434;
const PROBE_TIMEOUT_MS = 1_500;
const TAGS_TIMEOUT_MS = 5_000;
const START_DEADLINE_MS = 30_000;
const START_POLL_MS = 500;
/** A pull that sends nothing for this long is treated as stalled and stopped. */
const PULL_IDLE_MS = 120_000;
const MAX_ERROR_CHARS = 300;
const PULL_STALLED = new Error("The download stalled.");

export type OllamaServiceOptions = {
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  /** Host-owned file holding the owner's port; without it the port lives in memory only. */
  settingsPath?: string;
};

/** The port in `OLLAMA_HOST` (`0.0.0.0:11500`, `http://host:11500`, `:11500`), else 11434. */
export function ollamaPortFromEnv(env: NodeJS.ProcessEnv): number {
  const port = Number(/:(\d{1,5})\/?$/.exec(env.OLLAMA_HOST?.trim() ?? "")?.[1]);
  return isOllamaPort(port) ? port : OLLAMA_DEFAULT_PORT;
}

export const isOllamaPort = (port: unknown): port is number =>
  Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535;

const fileExists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Install locations of the official Ollama apps, for a Host started before PATH changed. */
function knownOllamaPaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string) {
  if (platform === "win32")
    return [
      join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs", "Ollama", "ollama.exe"),
    ];
  if (platform === "darwin")
    return [
      "/Applications/Ollama.app/Contents/Resources/ollama",
      "/opt/homebrew/bin/ollama",
      "/usr/local/bin/ollama",
    ];
  return ["/usr/local/bin/ollama", "/usr/bin/ollama"];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** `/api/tags` models. An Ollama without `capabilities` predates them, so chat is assumed. */
export function parseOllamaTags(body: unknown): OllamaModel[] {
  const models = record(body)?.models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((entry): OllamaModel[] => {
    const item = record(entry);
    const name = typeof item?.name === "string" ? item.name : "";
    if (!isOllamaModelName(name)) return [];
    const capabilities = Array.isArray(item?.capabilities) ? item.capabilities : undefined;
    const parameterSize = record(item?.details)?.parameter_size;
    return [
      {
        name,
        size: typeof item?.size === "number" && item.size >= 0 ? Math.floor(item.size) : 0,
        ...(typeof parameterSize === "string" && parameterSize.length <= 32
          ? { parameterSize }
          : {}),
        chat: capabilities ? capabilities.includes("completion") : true,
        tools: capabilities ? capabilities.includes("tools") : false,
      },
    ];
  });
}

/**
 * The owner's local Ollama: finds and starts it, lists and downloads models and lists chosen
 * models in OpenCode's user config. It only talks to loopback and never stops Ollama, which may
 * serve other apps. At most one download runs at a time.
 */
export class OllamaService {
  private readonly fetchImpl: typeof fetch;
  private readonly spawnImpl: typeof spawn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly home: string;
  private readonly exists: (path: string) => Promise<boolean>;
  private readonly sleep: (ms: number) => Promise<void>;
  private pull: OllamaPull | null = null;
  private pullAbort: AbortController | undefined;
  private starting: Promise<void> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private readonly settingsPath: string | undefined;
  /** The owner's port; `undefined` follows the default, the promise is the first read. */
  private customPort: Promise<number | undefined> | undefined;

  constructor(options: OllamaServiceOptions = {}) {
    this.settingsPath = options.settingsPath;
    this.fetchImpl =
      options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.home = options.home ?? homedir();
    this.exists = options.exists ?? fileExists;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async status(): Promise<OllamaStatus> {
    const custom = await this.readCustomPort();
    const [runtime, opencode] = await Promise.all([this.runtime(), this.opencodeState()]);
    return {
      port: custom ?? ollamaPortFromEnv(this.env),
      portCustom: custom !== undefined,
      ...runtime,
      pull: this.pull,
      opencode,
    };
  }

  /** Saves the owner's port, or returns to the default with `null`. */
  async setPort(port: number | null): Promise<OllamaStatus> {
    if (port !== null && !isOllamaPort(port)) throw new Error("Invalid Ollama port.");
    if (this.pull?.state === "running") throw new Error("Wait for the download to finish.");
    if (this.settingsPath)
      await writeFileAtomic(this.settingsPath, `${JSON.stringify({ port })}\n`);
    this.customPort = Promise.resolve(port ?? undefined);
    // Models already given to OpenCode follow the new port; a JSONC or damaged file is left alone.
    const opencode = await this.opencodeState();
    if (opencode.config === "ready" && opencode.models.length)
      return this.saveOpencode(opencode.models);
    return this.status();
  }

  /** Starts `ollama serve` detached, so it outlives the Host like the Ollama app does. */
  async start(): Promise<OllamaStatus> {
    this.starting ??= this.launch().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    return this.status();
  }

  /** Starts a download and returns at once; `status()` reports its progress. */
  startPull(model: string): OllamaPull {
    if (this.pull?.state === "running") throw new Error("Another model is downloading.");
    const abort = new AbortController();
    this.pullAbort = abort;
    // One object per download, updated in place, so a stale stream can never touch a newer one.
    const pull: OllamaPull = { model, state: "running", completed: 0, total: 0 };
    this.pull = pull;
    void this.runPull(pull, abort)
      .catch((error: unknown) => {
        if (pull.state !== "running") return;
        const stalled = abort.signal.reason === PULL_STALLED;
        if (abort.signal.aborted && !stalled) pull.state = "cancelled";
        else {
          pull.state = "failed";
          pull.error = truncateGraphemes(
            stalled ? PULL_STALLED.message : errorMessage(error),
            MAX_ERROR_CHARS,
          );
        }
      })
      .finally(() => {
        if (this.pullAbort === abort) this.pullAbort = undefined;
      });
    return pull;
  }

  cancelPull(): void {
    this.pullAbort?.abort();
  }

  /** Saves serially, so two quick saves cannot interleave their read and write. */
  async saveOpencode(models: readonly string[]): Promise<OllamaStatus> {
    const unique = [...new Set(models)];
    const run = this.saving.then(async () =>
      saveOllamaModelsToOpencode(
        await opencodeUserConfigPath(this.env, this.home),
        unique,
        `${await this.baseUrl()}/v1`,
      ),
    );
    this.saving = run.catch(() => undefined);
    await run;
    return this.status();
  }

  private async runtime(): Promise<Pick<OllamaStatus, "runtime" | "version" | "models">> {
    const version = await this.version();
    if (version === undefined)
      return { runtime: (await this.binary()) ? "stopped" : "missing", models: [] };
    const tags = await this.request("/api/tags", { signal: AbortSignal.timeout(TAGS_TIMEOUT_MS) })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    return {
      runtime: "running",
      ...(version ? { version } : {}),
      models: parseOllamaTags(tags),
    };
  }

  /** The running server's version, `""` when it answers without one, undefined when down. */
  private async version(): Promise<string | undefined> {
    try {
      const response = await this.request("/api/version", {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      const body = record(await response.json().catch(() => undefined));
      const version = body?.version;
      return typeof version === "string" && version.length <= 64 ? version : "";
    } catch {
      return undefined;
    }
  }

  private async binary(): Promise<string | undefined> {
    const onPath = await resolveOnPath("ollama", this.env, this.platform);
    if (onPath) return onPath;
    for (const candidate of knownOllamaPaths(this.env, this.platform, this.home))
      if (await this.exists(candidate)) return candidate;
    return undefined;
  }

  private async launch(): Promise<void> {
    if ((await this.version()) !== undefined) return;
    const binary = await this.binary();
    if (!binary) throw new Error("Ollama is not installed on this computer.");
    // Ollama reads its listen address from OLLAMA_HOST; loopback keeps it off the network.
    const address = new URL(await this.baseUrl()).host;
    await new Promise<void>((resolve, reject) => {
      const child = this.spawnImpl(binary, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...this.env, OLLAMA_HOST: address },
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    const startedAt = monotonicNow();
    while (elapsedSince(startedAt) < START_DEADLINE_MS) {
      if ((await this.version()) !== undefined) return;
      await this.sleep(START_POLL_MS);
    }
    throw new Error("Ollama did not start in time.");
  }

  private async opencodeState(): Promise<OllamaStatus["opencode"]> {
    const read = await readOpencodeConfig(await opencodeUserConfigPath(this.env, this.home));
    return { config: read.state, models: configuredOllamaModels(read.config).slice(0, 1000) };
  }

  /** Streams `/api/pull` progress lines into `pull` until success, an error line or abort. */
  private async runPull(pull: OllamaPull, abort: AbortController): Promise<void> {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(PULL_STALLED), PULL_IDLE_MS);
    };
    touch();
    try {
      const response = await this.request("/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: pull.model, stream: true }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(await errorBody(response, `Ollama answered ${response.status}.`));
      const reader = response.body.getReader();
      // Lossy decoding: one invalid byte never ends the read.
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) applyPullLine(pull, line);
      }
      applyPullLine(pull, buffered + decoder.decode());
      if (pull.state === "running")
        throw new Error("The download ended before Ollama reported success.");
    } finally {
      clearTimeout(idle);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${await this.baseUrl()}${path}`, { ...init, redirect: "error" });
  }

  /** Only loopback is ever contacted; the owner chooses the port. */
  private async baseUrl(): Promise<string> {
    return `http://127.0.0.1:${(await this.readCustomPort()) ?? ollamaPortFromEnv(this.env)}`;
  }

  /** A missing or damaged settings file follows the default port. */
  private readCustomPort(): Promise<number | undefined> {
    this.customPort ??= this.settingsPath
      ? readStateFile(this.settingsPath, (text) => JSON.parse(text) as unknown).then(
          (read) => {
            const port = record(read.value)?.port;
            return isOllamaPort(port) ? port : undefined;
          },
          () => undefined,
        )
      : Promise.resolve(undefined);
    return this.customPort;
  }
}

/** Applies one `/api/pull` NDJSON line; an `error` line throws, a `success` line finishes. */
export function applyPullLine(pull: OllamaPull, line: string): void {
  if (pull.state !== "running" || !line.trim()) return;
  let event: Record<string, unknown> | undefined;
  try {
    event = record(JSON.parse(line));
  } catch {
    return;
  }
  if (!event) return;
  if (typeof event.error === "string") throw new Error(event.error);
  // Ollama reports progress per layer, so the bar follows the layer being downloaded.
  if (typeof event.total === "number" && event.total > 0) pull.total = event.total;
  if (typeof event.completed === "number" && event.completed >= 0)
    pull.completed = Math.min(event.completed, pull.total || event.completed);
  if (event.status === "success") {
    pull.state = "done";
    pull.completed = pull.total;
  }
}

async function errorBody(response: Response, fallback: string): Promise<string> {
  const body = record(await response.json().catch(() => undefined));
  return typeof body?.error === "string" ? body.error : fallback;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
