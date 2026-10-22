import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { deviceCommand } from "./device-process";
import type { BrowserLoader } from "./shared-browser";

export const BROWSER_RUNTIME_VERSION = "1.64.0";
type RuntimeModule = Awaited<ReturnType<BrowserLoader>> & {
  chromium: { executablePath(): string };
};

/** Optional tools live outside immutable host packages and survive host updates. */
export class BrowserRuntime {
  private pending?: Promise<void>;
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
        installed = existsSync((await this.module()).chromium.executablePath());
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

  readonly load: BrowserLoader = async () => {
    if (!(await this.status()).installed)
      throw new Error(
        "Choose Set up host browser on this machine to install Playwright and Chromium, then retry.",
      );
    return this.module();
  };

  /** Explicit owner action only. One download per host, hidden argument-array subprocesses. */
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
    await command(this.nodePath, [cli, "install", "chromium"], {
      cwd: stage,
      env,
      timeoutMs: 600_000,
    });
    if (!existsSync((await this.module(stage)).chromium.executablePath()))
      throw new Error("Chromium installation is incomplete.");
    await writeFile(join(stage, ".install-complete"), BROWSER_RUNTIME_VERSION, { mode: 0o600 });
    if (existsSync(this.directory))
      await rename(this.directory, `${this.directory}.previous-${randomUUID()}`);
    await rename(stage, this.directory);
  }
}
