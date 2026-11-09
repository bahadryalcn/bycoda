import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { writeFileAtomic } from "../storage/atomic-write";

/** Pinned official GitHub CLI release; its checksums file is verified before extraction. */
export const GH_CLI_VERSION = "2.103.2";
const RELEASE_URL = `https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}`;
const HOST = "github.com";
/** The first GitHub call waits this long for the one-time install before reporting it. */
export const GH_INSTALL_WAIT_MS = 3 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;
const AUTH_CACHE_MS = 30_000;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CHECKSUMS_BYTES = 256 * 1024;

const TARGETS: Record<string, { os: string; cpu: string }> = {
  "win32-x64": { os: "windows", cpu: "amd64" },
  "win32-arm64": { os: "windows", cpu: "arm64" },
  "darwin-x64": { os: "macOS", cpu: "amd64" },
  "darwin-arm64": { os: "macOS", cpu: "arm64" },
  "linux-x64": { os: "linux", cpu: "amd64" },
  "linux-arm64": { os: "linux", cpu: "arm64" },
};

export type GhAsset = {
  /** Release asset name, e.g. gh_2.103.2_linux_amd64.tar.gz. */
  file: string;
  /** Path of the gh binary inside the archive. */
  entry: string[];
};

/** Official release asset and in-archive binary path for one platform and architecture. */
export function ghAsset(
  platform: NodeJS.Platform,
  arch: string,
  version = GH_CLI_VERSION,
): GhAsset | undefined {
  const target = TARGETS[`${platform}-${arch}`];
  if (!target) return undefined;
  const stem = `gh_${version}_${target.os}_${target.cpu}`;
  if (platform === "win32") return { file: `${stem}.zip`, entry: ["bin", "gh.exe"] };
  return {
    file: `${stem}.${platform === "darwin" ? "zip" : "tar.gz"}`,
    entry: [stem, "bin", "gh"],
  };
}

/** Lookup in `gh_<version>_checksums.txt` lines of the form "<sha256>  <file>". */
export function checksumFor(checksums: string, file: string): string | undefined {
  for (const line of checksums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (match?.[2] === file) return match[1]!.toLowerCase();
  }
  return undefined;
}

type ExecOptions = { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer?: number };
/** Per-call limits; publication commands need longer than status reads. */
export type GhRunLimits = { timeoutMs?: number; maxBuffer?: number };
export type GhExec = (file: string, args: string[], options: ExecOptions) => Promise<string>;

export type GhRuntimeOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  /** Replaces the per-platform install folders searched after PATH (tests use an empty list). */
  commonDirectories?: string[];
  fetch?: typeof fetch;
  exec?: GhExec;
  waitMs?: number;
};

const defaultExec: GhExec = async (file, args, options) =>
  (
    await execFileAsync(file, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      shell: false,
      windowsHide: true,
    })
  ).stdout;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * GitHub CLI for bycoda: a gh already on this computer wins, otherwise a pinned official copy
 * is installed once under the host data folder. Both share gh's own sign-in.
 */
export class GhRuntime {
  private pending?: Promise<string>;
  private lastError?: string;
  private readonly authCache = new Map<
    string,
    { until: number; env?: NodeJS.ProcessEnv; error?: string }
  >();
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly exec: GhExec;
  private readonly waitMs: number;

  constructor(
    private readonly baseDirectory: string,
    private readonly options: GhRuntimeOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? fetch;
    this.exec = options.exec ?? defaultExec;
    this.waitMs = options.waitMs ?? GH_INSTALL_WAIT_MS;
  }

  private get directory() {
    return join(this.baseDirectory, "tools", `gh-${GH_CLI_VERSION}`);
  }

  private managedPath(): string | undefined {
    const asset = ghAsset(this.platform, this.arch);
    return asset ? join(this.directory, ...asset.entry) : undefined;
  }

  /** The managed copy counts only when its install marker names the pinned version. */
  private async managedInstalled(): Promise<string | undefined> {
    const binary = this.managedPath();
    if (!binary) return undefined;
    try {
      const marker = await readFile(join(this.directory, ".install-complete"), "utf8");
      return marker === GH_CLI_VERSION && (await stat(binary)).isFile() ? binary : undefined;
    } catch {
      return undefined;
    }
  }

  private searchDirectories(): string[] {
    const home = this.env.HOME ?? this.env.USERPROFILE ?? homedir();
    const pathDirectories = (this.env.PATH ?? this.env.Path ?? "")
      .split(delimiter)
      .map((directory) => directory.replace(/^"|"$/g, ""))
      .filter(Boolean);
    const common =
      this.options.commonDirectories ??
      (this.platform === "win32"
        ? [
            join(this.env.ProgramFiles ?? "C:\\Program Files", "GitHub CLI"),
            join(this.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs", "GitHub CLI"),
          ]
        : this.platform === "darwin"
          ? ["/opt/homebrew/bin", "/usr/local/bin"]
          : ["/usr/bin", "/usr/local/bin", join(home, ".local", "bin")]);
    return [...new Set([...pathDirectories, ...common])];
  }

  /** Every usable gh on this computer, in preference order: PATH and install folders, then the managed copy. */
  private async candidates(): Promise<string[]> {
    const name = this.platform === "win32" ? "gh.exe" : "gh";
    const found: string[] = [];
    for (const directory of this.searchDirectories()) {
      const candidate = join(directory, name);
      if (
        await stat(candidate).then(
          (entry) => entry.isFile(),
          () => false,
        )
      )
        found.push(candidate);
    }
    const managed = await this.managedInstalled();
    if (managed) found.push(managed);
    return [...new Set(found)];
  }

  /** Hidden, deadline-bound gh invocation; the first use waits for the one-time install. */
  async run(cwd: string, args: string[], limits: GhRunLimits = {}): Promise<string> {
    const found = await this.candidates();
    const binary = found[0] ?? (await this.waitForInstall());
    const env = await this.credentials(
      binary,
      found.filter((candidate) => candidate !== binary),
    );
    return await this.exec(binary, args, {
      cwd,
      env,
      timeout: limits.timeoutMs ?? COMMAND_TIMEOUT_MS,
      ...(limits.maxBuffer ? { maxBuffer: limits.maxBuffer } : {}),
    });
  }

  private async waitForInstall(): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "GitHub CLI is still being installed for bycoda (one time, usually 1-3 minutes). Try again shortly.",
            ),
          ),
        this.waitMs,
      );
    });
    try {
      return await Promise.race([this.setup(), bounded]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Auth is gh's own sign-in. If this gh is signed out, reuse a token from another gh here. */
  private async credentials(binary: string, others: string[]): Promise<NodeJS.ProcessEnv> {
    const cached = this.authCache.get(binary);
    if (cached && cached.until > Date.now()) {
      if (cached.error) throw new Error(cached.error);
      return cached.env!;
    }
    const base = { ...this.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };
    const signedIn = await this.exec(binary, ["auth", "status", "--active", "--hostname", HOST], {
      env: base,
      timeout: PROBE_TIMEOUT_MS,
    }).then(
      () => true,
      () => false,
    );
    let entry: { env?: NodeJS.ProcessEnv; error?: string };
    if (signedIn) entry = { env: base };
    else {
      let token = "";
      for (const other of others) {
        token = await this.exec(other, ["auth", "token", "--hostname", HOST], {
          env: base,
          timeout: PROBE_TIMEOUT_MS,
        }).then(
          (output) => output.trim(),
          () => "",
        );
        if (token) break;
      }
      entry = token ? { env: { ...base, GH_TOKEN: token } } : { error: this.signInMessage(binary) };
    }
    this.authCache.set(binary, { until: Date.now() + AUTH_CACHE_MS, ...entry });
    if (entry.error) throw new Error(entry.error);
    return entry.env!;
  }

  private signInMessage(binary: string) {
    const command = binary === this.managedPath() ? `"${binary}" auth login` : "gh auth login";
    return `GitHub is not signed in on this computer. Run ${command} in a terminal, choose github.com and complete sign-in, then try again. Bycoda uses the same GitHub sign-in for GitHub inbox items.`;
  }

  /** Shares one install per host; concurrent callers await the same attempt. */
  setup(): Promise<string> {
    if (!this.pending) {
      this.lastError = undefined;
      this.pending = this.install()
        .catch((error: unknown) => {
          this.lastError = errorMessage(error);
          throw error;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return this.pending;
  }

  async status() {
    return {
      managed: !!(await this.managedInstalled()),
      installing: !!this.pending,
      version: GH_CLI_VERSION,
      lastError: this.lastError,
    };
  }

  private async install(): Promise<string> {
    const asset = ghAsset(this.platform, this.arch);
    if (!asset)
      throw new Error(
        `GitHub CLI is not published for ${this.platform}-${this.arch}. Install it from cli.github.com, then try again.`,
      );
    const checksums = (
      await this.download(`${RELEASE_URL}/gh_${GH_CLI_VERSION}_checksums.txt`, MAX_CHECKSUMS_BYTES)
    ).toString("utf8");
    const expected = checksumFor(checksums, asset.file);
    if (!expected) throw new Error("GitHub CLI release checksums are unavailable. Try again.");
    const archive = await this.download(`${RELEASE_URL}/${asset.file}`, MAX_ARCHIVE_BYTES);
    if (createHash("sha256").update(archive).digest("hex") !== expected)
      throw new Error("GitHub CLI download verification failed. Try again.");
    const stage = `${this.directory}.stage-${randomUUID()}`;
    const previous = `${this.directory}.previous-${randomUUID()}`;
    await mkdir(stage, { recursive: true, mode: 0o700 });
    try {
      const archivePath = join(stage, asset.file);
      await writeFileAtomic(archivePath, archive);
      const member = asset.entry.join("/");
      const flags = asset.file.endsWith(".zip") ? "-xf" : "-xzf";
      await this.exec(this.extractor(), [flags, archivePath, "-C", stage, member], {
        timeout: EXTRACT_TIMEOUT_MS,
      });
      await rm(archivePath, { force: true });
      const binary = join(stage, ...asset.entry);
      if (!(await lstat(binary)).isFile())
        throw new Error("GitHub CLI installation is incomplete.");
      if (this.platform !== "win32") await chmod(binary, 0o755);
      const version = await this.exec(binary, ["--version"], { timeout: PROBE_TIMEOUT_MS });
      if (!version.trim().startsWith(`gh version ${GH_CLI_VERSION} `))
        throw new Error("GitHub CLI installation is incomplete.");
      await writeFileAtomic(join(stage, ".install-complete"), GH_CLI_VERSION);
      await stat(this.directory).then(
        () => rename(this.directory, previous),
        () => undefined,
      );
      await rename(stage, this.directory).catch(async (error: unknown) => {
        if (!(await this.managedInstalled())) throw error;
      });
      await rm(previous, { recursive: true, force: true }).catch(() => undefined);
      return join(this.directory, ...asset.entry);
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Windows 10+ ships bsdtar as System32\tar.exe, which reads zip; macOS and Linux use tar. */
  private extractor() {
    return this.platform === "win32"
      ? join(this.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  }

  private async download(url: string, limit: number): Promise<Buffer> {
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    }).catch(() => undefined);
    if (!response?.ok || !response.body)
      throw new Error("GitHub CLI could not be downloaded. Check your connection and try again.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) throw new Error("GitHub CLI download is too large. Try again.");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks);
  }
}
