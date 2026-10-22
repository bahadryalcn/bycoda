import { mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  ACP_PINNED_PACKAGE,
  ACP_REGISTRY_URL,
  parseAcpRegistry,
  validateGenericAcpConfig,
  type AcpRegistryEntry,
  type GenericAcpConfig,
  type GenericAcpSummary,
} from "../src/features/providers/model/genericAcp";

const directoryWrites = new Map<string, Promise<unknown>>();
const revisionSecret = randomBytes(32);
const CONFIG_BYTES = 1024 * 1024;
export type GenericAcpCenter = { revision: string; agents: { id: string; name: string; argumentCount: number; environmentKeyCount: number; contextWindow?: number }[] };
export type GenericAcpMetadataPatch = { id: string; expectedRevision: string; name: string; contextWindow?: number | null };

/** Canonical existing ancestor prevents aliases from acquiring independent write queues. */
async function directoryKey(directory: string): Promise<string> {
  let cursor = resolve(directory); const suffix: string[] = [];
  for (;;) {
    try {
      const key = resolve(await realpath(cursor), ...suffix);
      return process.platform === "win32" ? key.toLowerCase() : key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("ACP configuration directory is unavailable");
      suffix.unshift(basename(cursor)); cursor = parent;
    }
  }
}
const configRevision = (configs: GenericAcpConfig[]) => createHmac("sha256", revisionSecret).update(JSON.stringify(configs)).digest("hex");
/** The packaged host ships only node.exe, so npm comes from the user's Node install or PATH. */
export function windowsNpmCli(env: NodeJS.ProcessEnv = process.env, nodePath = process.execPath): string | undefined {
  return [
    dirname(nodePath),
    ...(env.PATH ?? env.Path ?? "").split(delimiter),
    env.APPDATA ? join(env.APPDATA, "npm") : "",
    env.ProgramFiles ? join(env.ProgramFiles, "nodejs") : "",
  ]
    .filter(Boolean)
    .map((directory) => join(directory.replace(/^"|"$/g, ""), "node_modules", "npm", "bin", "npm-cli.js"))
    .find(existsSync);
}

export class GenericAcpService {
  private registryCache?: { entries: AcpRegistryEntry[]; at: number };
  private installs = new Map<string, AbortController>();
  constructor(private readonly directory: string) {}
  private async configs(): Promise<GenericAcpConfig[]> {
    try {
      const file = await open(join(this.directory, "generic-acp.json"), "r");
      try {
        if ((await file.stat()).size > CONFIG_BYTES) throw new Error("ACP configuration exceeds the read limit");
        const bytes = Buffer.alloc(CONFIG_BYTES + 1);
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const chunk = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
          if (!chunk.bytesRead) break;
          bytesRead += chunk.bytesRead;
        }
        if (bytesRead > CONFIG_BYTES) throw new Error("ACP configuration exceeds the read limit");
        const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
        if (!Array.isArray(value) || value.length > 256) throw new Error("Invalid ACP configuration collection");
        const configs = value.map((entry) => validateGenericAcpConfig(entry));
        if (new Set(configs.map((entry) => entry.id)).size !== configs.length) throw new Error("Duplicate ACP configuration identity");
        return configs;
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      // Parser and filesystem errors can contain source fragments or private paths.
      throw new Error("ACP configuration could not be read");
    }
  }
  async list(): Promise<GenericAcpSummary[]> {
    return (await this.configs()).map(({ env, ...config }) => ({
      ...config,
      envKeys: Object.keys(env ?? {}),
    }));
  }
  /** Project before transport: command, arguments, environment keys/values and auth ids stay on the host. */
  async center(): Promise<GenericAcpCenter> {
    const configs = await this.configs();
    return { revision: configRevision(configs), agents: configs.map((entry) => ({
      id: entry.id, name: entry.name, argumentCount: entry.args.length, environmentKeyCount: Object.keys(entry.env ?? {}).length,
      ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
    })) };
  }
  patchMetadata(input: GenericAcpMetadataPatch): Promise<void> {
    if (!input || Object.keys(input).some((key) => !["id", "expectedRevision", "name", "contextWindow"].includes(key)) ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.id) || !/^[a-f0-9]{64}$/.test(input.expectedRevision) ||
      typeof input.name !== "string" || !input.name.trim() || input.name.length > 160 || /[\r\n\0]/.test(input.name) ||
      input.contextWindow !== undefined && input.contextWindow !== null && (!Number.isSafeInteger(input.contextWindow) || input.contextWindow < 1024 || input.contextWindow > 10_000_000))
      return Promise.reject(new Error("Invalid ACP metadata update"));
    return this.mutate((configs) => {
      if (input.expectedRevision !== configRevision(configs)) throw new Error("ACP configuration changed; refresh and review before saving");
      if (!configs.some((entry) => entry.id === input.id)) throw new Error("ACP configuration is no longer available");
      return configs.map((entry) => {
        if (entry.id !== input.id) return entry;
        const updated = { ...entry, name: input.name.trim() };
        if (input.contextWindow === null) delete updated.contextWindow;
        else if (input.contextWindow !== undefined) updated.contextWindow = input.contextWindow;
        return validateGenericAcpConfig(updated);
      });
    });
  }
  async get(id: string): Promise<GenericAcpConfig> {
    const config = (await this.configs()).find((entry) => entry.id === id);
    if (!config) throw new Error("ACP agent is not configured on this host");
    return validateGenericAcpConfig(config);
  }
  private async mutate(operation: (configs: GenericAcpConfig[]) => GenericAcpConfig[]): Promise<void> {
    const key = await directoryKey(this.directory);
    const task = (directoryWrites.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const configs = operation(await this.configs());
        if (configs.length > 256 || Buffer.byteLength(JSON.stringify(configs)) > CONFIG_BYTES) throw new Error("ACP configuration exceeds the write limit");
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `generic-acp-${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(configs), { mode: 0o600 });
        await rename(temporary, join(this.directory, "generic-acp.json"));
      });
    directoryWrites.set(key, task);
    try { await task; } finally { if (directoryWrites.get(key) === task) directoryWrites.delete(key); }
  }
  save(input: GenericAcpConfig): Promise<void> {
    const config = validateGenericAcpConfig(input);
    return this.mutate((configs) => {
      const old = configs.find((entry) => entry.id === config.id);
      return [
        ...configs.filter((entry) => entry.id !== config.id),
        { ...config, env: config.env ?? old?.env },
      ];
    });
  }
  remove(id: string): Promise<void> {
    return this.mutate((configs) => configs.filter((entry) => entry.id !== id));
  }
  async registry(refresh = false, signal?: AbortSignal): Promise<AcpRegistryEntry[]> {
    if (!refresh && this.registryCache && Date.now() - this.registryCache.at < 3600_000)
      return this.registryCache.entries;
    const response = await fetch(ACP_REGISTRY_URL, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`ACP registry returned ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty registry");
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 1024 * 1024) throw new Error("ACP registry exceeds 1 MiB");
        text += decoder.decode(next.value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const entries = parseAcpRegistry(JSON.parse(text + decoder.decode()));
    this.registryCache = { entries, at: Date.now() };
    return entries;
  }
  cancelInstall(id: string): void {
    this.installs.get(id)?.abort();
  }
  async install(id: string, version: string): Promise<void> {
    if (this.installs.has(id)) throw new Error("ACP installation is already running");
    const controller = new AbortController();
    this.installs.set(id, controller);
    try {
      const entry = (await this.registry(false, controller.signal)).find(
        (item) => item.id === id && item.version === version,
      );
      controller.signal.throwIfAborted();
      if (!entry?.package || !ACP_PINNED_PACKAGE.test(entry.package))
        throw new Error("Pinned npm distribution is unavailable");
      const prefix = join(this.directory, "acp-tools", id, randomUUID());
      await mkdir(prefix, { recursive: true });
      controller.signal.throwIfAborted();
      // Resolve npm through its JS CLI on Windows, avoiding cmd.exe interpolation entirely.
      let command = "npm";
      let args = ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--", entry.package];
      if (process.platform === "win32") {
        const npmCli = windowsNpmCli();
        if (!npmCli) throw new Error("ACP installation requires npm beside Node.js or on this host's PATH");
        command = process.execPath;
        args = [npmCli, ...args];
      }
      await new Promise<void>((done, fail) =>
        execFile(
          command,
          args,
          {
            windowsHide: true,
            signal: controller.signal,
            timeout: 5 * 60_000,
            maxBuffer: 1024 * 1024,
          },
          (error) =>
            error
              ? fail(
                  new Error(
                    "ACP installation failed; check npm availability and package compatibility",
                  ),
                )
              : done(),
        ),
      );
      const packageName = entry.package.slice(0, entry.package.lastIndexOf("@"));
      const packageRoot = join(prefix, "node_modules", packageName);
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
        bin?: string | Record<string, string>;
      };
      const bins =
        typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
      if (bins.length !== 1)
        throw new Error(
          "Package exposes multiple or no commands; configure its local command explicitly",
        );
      const script = resolve(packageRoot, bins[0]);
      if (!script.startsWith(resolve(packageRoot) + sep))
        throw new Error("Package command escapes install directory");
      controller.signal.throwIfAborted();
      await this.save({
        id,
        name: entry.name,
        command: process.execPath,
        args: [script, ...entry.args],
        env: entry.env,
      });
    } finally {
      this.installs.delete(id);
    }
  }
}
