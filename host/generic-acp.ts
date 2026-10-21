import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  ACP_PINNED_PACKAGE,
  ACP_REGISTRY_URL,
  parseAcpRegistry,
  validateGenericAcpConfig,
  type AcpRegistryEntry,
  type GenericAcpConfig,
  type GenericAcpSummary,
} from "../src/features/providers/model/genericAcp";

export class GenericAcpService {
  private tail: Promise<unknown> = Promise.resolve();
  private registryCache?: { entries: AcpRegistryEntry[]; at: number };
  private installs = new Map<string, AbortController>();
  constructor(private readonly directory: string) {}
  private async configs(): Promise<GenericAcpConfig[]> {
    try {
      return JSON.parse(
        await readFile(join(this.directory, "generic-acp.json"), "utf8"),
      ) as GenericAcpConfig[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async list(): Promise<GenericAcpSummary[]> {
    return (await this.configs()).map(({ env, ...config }) => ({
      ...config,
      envKeys: Object.keys(env ?? {}),
    }));
  }
  async get(id: string): Promise<GenericAcpConfig> {
    const config = (await this.configs()).find((entry) => entry.id === id);
    if (!config) throw new Error("ACP agent is not configured on this host");
    return validateGenericAcpConfig(config);
  }
  private mutate(operation: (configs: GenericAcpConfig[]) => GenericAcpConfig[]): Promise<void> {
    const task = this.tail
      .catch(() => undefined)
      .then(async () => {
        const configs = operation(await this.configs());
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `generic-acp-${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(configs), { mode: 0o600 });
        await rename(temporary, join(this.directory, "generic-acp.json"));
      });
    this.tail = task;
    return task;
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
        const npmCli = join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js");
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
