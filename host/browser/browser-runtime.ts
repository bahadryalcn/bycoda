import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { deviceCommand } from "../devices/device-process";
import type { BrowserLoader } from "./shared-browser";

export const BROWSER_RUNTIME_VERSION = "1.64.0";
export const BROWSER_SETUP_HINT =
  "Host browser runtime installs automatically on first use (one time, usually 1-3 minutes). Retry shortly.";
/** One ffmpeg download; matches how long a recording stop waits for it. */
export const FFMPEG_INSTALL_DEADLINE_MS = 300_000;
type RuntimeModule = Awaited<ReturnType<BrowserLoader>> & {
  chromium: {
    executablePath(): string;
    launchServer(options: { headless: boolean }): Promise<{
      process(): { spawnfile?: string } | null;
      close(): Promise<void>;
    }>;
  };
};
/** The slice of Playwright's executable registry the Host reads. */
export type FfmpegRegistry = {
  findExecutable(name: "ffmpeg"): { executablePath(): string | undefined } | undefined;
};
// Records the headless shell that setup verified; `executablePath()` names full Chromium.
const BROWSER_PATH_FILE = ".browser-path";

/**
 * Loads the pinned runtime's own executable registry, the object Playwright's recorder asks for
 * its ffmpeg, so the path follows Playwright's platform table and browsers directory.
 * shortcut: playwright-core 1.64 exports the registry as `registry.registry` from its bundle; the
 * pinned BROWSER_RUNTIME_VERSION fixes that shape. Upgrade to a public accessor if one ships.
 */
function loadPinnedRegistry(directory: string): FfmpegRegistry {
  // Absolute path only: a bare specifier could resolve to another Playwright on this machine.
  const bundle = join(directory, "node_modules", "playwright-core", "lib", "coreBundle.js");
  if (!existsSync(bundle)) throw new Error("Playwright runtime bundle is missing.");
  const requireFromRuntime = createRequire(bundle);
  return (requireFromRuntime(bundle) as { registry: { registry: FfmpegRegistry } }).registry
    .registry;
}

/** Optional tools live outside immutable host packages and survive host updates. */
export class BrowserRuntime {
  private pending?: Promise<void>;
  private ffmpegPending?: Promise<void>;
  private lastError?: string;
  private readonly directory: string;
  private readonly nodePath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly baseDirectory: string,
    private readonly options: {
      nodePath?: string;
      npmCliPath?: string;
      env?: NodeJS.ProcessEnv;
      command?: typeof deviceCommand;
      load?: (entry: string) => Promise<RuntimeModule>;
      loadRegistry?: () => FfmpegRegistry;
    } = {},
  ) {
    this.directory = join(baseDirectory, "tools", `playwright-${BROWSER_RUNTIME_VERSION}`);
    this.nodePath = options.nodePath ?? process.execPath;
    this.env = options.env ?? process.env;
  }

  private entry(directory = this.directory) {
    return join(directory, "node_modules", "playwright", "index.mjs");
  }

  private async module(directory = this.directory) {
    const entry = this.entry(directory);
    return this.options.load
      ? this.options.load(entry)
      : ((await import(/* @vite-ignore */ pathToFileURL(entry).href)) as RuntimeModule);
  }

  async status() {
    let installed = false;
    try {
      if (
        (await readFile(join(this.directory, ".install-complete"), "utf8")) ===
          BROWSER_RUNTIME_VERSION &&
        existsSync(this.entry())
      ) {
        const verified = await readFile(join(this.directory, BROWSER_PATH_FILE), "utf8").catch(
          () => "",
        );
        // Older installs carried full Chromium and no recorded shell path.
        installed = verified
          ? existsSync(verified.trim())
          : existsSync((await this.module()).chromium.executablePath());
      }
    } catch {
      /* Missing or partial installs are never ready. */
    }
    return {
      installed,
      installing: !!this.pending,
      version: BROWSER_RUNTIME_VERSION,
      lastError: this.lastError,
    };
  }

  /** Attach real runtime readiness; the setup hint appears only when setup is missing. */
  async describe<T extends object>(state: T) {
    const runtime = await this.status();
    return runtime.installed
      ? { ...state, runtime }
      : { ...state, runtime, setup: BROWSER_SETUP_HINT };
  }

  /** First use starts the one-time pinned setup in the background, like the reference app; no owner step. */
  readonly load: BrowserLoader = async () => {
    const status = await this.status();
    if (!status.installed) {
      void this.setup().catch(() => undefined);
      throw new Error(
        `The host browser is installing automatically (one time, usually 1-3 minutes). Retry shortly.${status.lastError ? ` Last attempt failed: ${status.lastError}` : ""}`,
      );
    }
    return this.module();
  };

  /** One download per host, hidden argument-array subprocesses. */
  async setup() {
    if (!this.pending) {
      this.lastError = undefined;
      this.pending = this.install()
        .catch((error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    await this.pending;
    return this.status();
  }

  /** Where the pinned registry says ffmpeg belongs; undefined when Playwright has no build here. */
  private expectedFfmpeg(): string | undefined {
    try {
      const registry = this.options.loadRegistry?.() ?? loadPinnedRegistry(this.directory);
      return registry.findExecutable("ffmpeg")?.executablePath();
    } catch {
      return undefined; // Runtime missing or incomplete: no pinned ffmpeg to read.
    }
  }

  /** Playwright's own ffmpeg, when it is on disk. */
  async ffmpegPath() {
    const expected = this.expectedFfmpeg();
    return expected && existsSync(expected) ? expected : undefined;
  }

  /**
   * Adds Playwright's ffmpeg to an install made before ffmpeg joined setup. Runs the pinned cli
   * once per host (concurrent callers share the run) with setup's env, so the download lands in
   * the browsers path the runtime already uses. Resolves without downloading when ffmpeg is
   * present or Playwright ships no build for this platform (the caller then falls back to PATH).
   */
  ensureFfmpeg(): Promise<void> {
    this.ffmpegPending ??= this.installFfmpeg().finally(() => {
      this.ffmpegPending = undefined;
    });
    return this.ffmpegPending;
  }

  private async installFfmpeg() {
    await this.pending?.catch(() => undefined);
    if (await this.ffmpegPath()) return;
    if (!(await this.status()).installed)
      throw new Error(
        "The host browser runtime is not installed yet. It installs automatically on first use; retry shortly.",
      );
    const expected = this.expectedFfmpeg();
    if (!expected) return;
    const command = this.options.command ?? deviceCommand;
    const env = {
      ...this.env,
      PATH: [dirname(this.nodePath), this.env.PATH ?? ""].join(delimiter),
    };
    await command(
      this.nodePath,
      [join(this.directory, "node_modules", "playwright", "cli.js"), "install", "ffmpeg"],
      { cwd: this.directory, env, timeoutMs: FFMPEG_INSTALL_DEADLINE_MS },
    );
    if (!existsSync(expected))
      throw new Error("Playwright's ffmpeg install finished without an ffmpeg binary.");
  }

  private async install() {
    if ((await this.status()).installed) return;
    const directories = [
      dirname(this.nodePath),
      dirname(dirname(this.nodePath)),
      join(this.baseDirectory, "runtime"),
      ...(this.env.PATH ?? this.env.Path ?? "").split(delimiter),
      ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
    ].filter(Boolean);
    const npm =
      this.options.npmCliPath ??
      directories
        .flatMap((directory) => [
          join(directory, "node_modules/npm/bin/npm-cli.js"),
          join(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
        ])
        .find(existsSync);
    if (!npm) throw new Error("Browser setup requires npm beside Node.js or on this host's PATH.");
    const stage = `${this.directory}.stage-${randomUUID()}`;
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({ private: true, dependencies: { playwright: BROWSER_RUNTIME_VERSION } }),
      { mode: 0o600 },
    );
    const command = this.options.command ?? deviceCommand;
    const env = {
      ...this.env,
      PATH: [dirname(this.nodePath), this.env.PATH ?? ""].join(delimiter),
    };
    await command(
      this.nodePath,
      [npm, "install", "--no-audit", "--no-fund", "--omit=dev", "--ignore-scripts"],
      { cwd: stage, env, timeoutMs: 600_000 },
    );
    const cli = join(stage, "node_modules", "playwright", "cli.js");
    if (!existsSync(cli) || !existsSync(this.entry(stage)))
      throw new Error("Playwright installation is incomplete.");
    // Every Host launch is headless, so the smaller headless shell is enough (as in the reference app).
    await command(this.nodePath, [cli, "install", "--only-shell", "chromium", "ffmpeg"], {
      cwd: stage,
      env,
      timeoutMs: 600_000,
    });
    const server = await (await this.module(stage)).chromium.launchServer({ headless: true });
    const executable = server.process()?.spawnfile;
    await server.close();
    if (!executable || !existsSync(executable))
      throw new Error("Chromium installation is incomplete.");
    await writeFile(join(stage, BROWSER_PATH_FILE), executable, { mode: 0o600 });
    await writeFile(join(stage, ".install-complete"), BROWSER_RUNTIME_VERSION, { mode: 0o600 });
    if (existsSync(this.directory))
      await rename(this.directory, `${this.directory}.previous-${randomUUID()}`);
    await rename(stage, this.directory);
  }
}
