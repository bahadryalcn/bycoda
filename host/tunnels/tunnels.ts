import { randomUUID } from "node:crypto";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { installCloudflared } from "./cloudflared-install";
import { renameWithRetry } from "../storage/rename-retry";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TUNNEL_PROVIDERS,
  TUNNEL_ISSUES,
  TunnelError,
  tunnelActive,
  tunnelLocalUrl,
  tunnelPublicUrl,
  type ExternalTunnel,
  type TunnelOverview,
  type TunnelProvider,
  type TunnelStart,
} from "../../src/integrations/external-tunnels";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { OsSocialCredentials, type SocialCredentialStore } from "../social/social-credentials";
import { startTunnelGuardian, type OwnedTunnelProcess } from "./tunnel-process";
import {
  probeTunnelOrigin,
  tunnelCommand,
  tunnelExecutable,
  type TunnelCommand,
  type TunnelEvent,
} from "./tunnel-providers";

type Dependencies = {
  credentials: SocialCredentialStore;
  executable: (provider: TunnelProvider) => Promise<string | undefined>;
  install: () => Promise<string>;
  probe: (url: string) => Promise<boolean>;
  launch: (command: TunnelCommand, emit: (event: TunnelEvent) => void) => OwnedTunnelProcess;
};
const MAX_RECORDS = 32;
const MAX_ACTIVE = 4;
/** Automatic Host access checks every 5 s but starts a tunnel at most this often, doubling to the cap. */
const AUTOMATIC_RETRY_MS = 5_000;
const AUTOMATIC_MAX_RETRY_MS = 300_000;
/** A tunnel ready this long resets the backoff. */
const AUTOMATIC_STABLE_MS = 60_000;

function tunnelCredentials(directory: string, environmentId: string): SocialCredentialStore {
  const vault = new OsSocialCredentials(directory, `${environmentId}.tunnels`);
  return {
    async get(id) {
      // Observing an empty vault must not create an OS key or request an unlock.
      try {
        await access(join(directory, "tokens.enc"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      return vault.get(id);
    },
    set: (id, credential) => vault.set(id, credential),
    delete: (id) => vault.delete(id),
  };
}

type TunnelRepair = { repaired: true; dropped: number };
/** Host-only status: the web client reconstructs the public overview and ignores this. */
export type TunnelStatus = TunnelOverview & { repair?: TunnelRepair };
type ManifestVerdict =
  | { kind: "current"; records: ExternalTunnel[] }
  | { kind: "damaged"; records: ExternalTunnel[]; dropped: number }
  | { kind: "foreign"; environmentId: string };

const MAX_STATE_BYTES = 128 * 1024;
const QUARANTINE_LIMIT = 3;
const CORRUPT_PREFIX = "state.json.corrupt-";

function timestampLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Move `from` to `stem + extension`, adding a numeric suffix instead of replacing evidence. */
async function moveAside(
  directory: string,
  stem: string,
  extension: string,
  from: string,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const target = join(directory, `${stem}${attempt ? `-${attempt}` : ""}${extension}`);
    if (await exists(target)) continue;
    await renameWithRetry(from, target);
    return target;
  }
  throw new Error("No free name for retained tunnel state");
}

/** Keep the newest damaged-state copies; ISO-derived names sort chronologically. */
async function pruneCorruptCopies(directory: string): Promise<void> {
  const copies = (await readdir(directory))
    .filter((name) => name.startsWith(CORRUPT_PREFIX))
    .sort();
  for (const name of copies.slice(0, Math.max(0, copies.length - QUARANTINE_LIMIT)))
    await rm(join(directory, name), { force: true });
}

/** Host-owned control lane. A manifest contains no tokens or reusable PID authority. */
export class ExternalTunnels {
  private records: ExternalTunnel[] = [];
  private owned = new Map<string, OwnedTunnelProcess>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;
  private initialized = false;
  private closing = false;
  private repair?: TunnelRepair;
  private automaticHostAccess = false;
  private automaticTimer?: ReturnType<typeof setTimeout>;
  private automaticFailures = 0;
  private automaticNotBefore = 0;
  private automaticReadySince?: number;
  private readonly dependencies: Dependencies;

  constructor(
    private readonly directory: string,
    private readonly environmentId: string,
    private readonly hostUrl: () => string,
    dependencies?: Partial<Dependencies>,
  ) {
    this.dependencies = {
      credentials: tunnelCredentials(join(directory, "credentials"), environmentId),
      executable: tunnelExecutable,
      install: () => installCloudflared(join(directory, "bin")),
      probe: probeTunnelOrigin,
      launch: startTunnelGuardian,
      ...dependencies,
    };
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation);
    this.queue = task.catch(() => {});
    return task;
  }

  private async initialize(): Promise<void> {
    this.initialization ??= (async () => {
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.load();
        const setting = await readStateFile(join(this.directory, "automatic.json"), (text) => {
          const value = JSON.parse(text);
          if (value.environmentId !== this.environmentId || typeof value.enabled !== "boolean")
            throw new Error("Invalid automatic tunnel setting");
          return value.enabled as boolean;
        });
        if (setting.status === "corrupt") throw new Error("Invalid automatic tunnel setting");
        this.automaticHostAccess = setting.value ?? false;
      } catch {
        throw new TunnelError("storage-unavailable");
      }
    })();
    try {
      await this.initialization;
      this.initialized = true;
    } catch (error) {
      this.initialization = undefined;
      throw error;
    }
  }

  /** Startup restores intent only, never a persisted process handle or URL. */
  async boot(): Promise<void> {
    await this.serialized(() => this.initialize());
    this.scheduleAutomatic(0);
  }

  private scheduleAutomatic(delay = 5_000): void {
    clearTimeout(this.automaticTimer);
    if (this.closing || !this.automaticHostAccess) return;
    this.automaticTimer = setTimeout(() => {
      void this.reconcileAutomatic()
        .finally(() => this.scheduleAutomatic(5_000))
        .catch(() => {});
    }, delay);
    this.automaticTimer.unref();
  }

  private async reconcileAutomatic(): Promise<void> {
    if (this.closing || !this.automaticHostAccess) return;
    // Unknown retirement retains ownership and blocks a replacement.
    const owned = this.records.find(
      (record) =>
        record.provider === "cloudflare" && record.target === "host" && this.owned.has(record.id),
    );
    if (owned) {
      if (owned.state !== "ready") this.automaticReadySince = undefined;
      else {
        this.automaticReadySince ??= monotonicNow();
        // A tunnel that stayed up proves the last failures are over.
        if (elapsedSince(this.automaticReadySince) >= AUTOMATIC_STABLE_MS)
          this.resetAutomaticBackoff();
      }
      return;
    }
    this.automaticReadySince = undefined;
    if (monotonicNow() < this.automaticNotBefore) return;
    // Every attempt that has not yet proven stable widens the wait: 5 s, 10 s ... 5 min.
    this.automaticFailures++;
    this.automaticNotBefore =
      monotonicNow() +
      Math.min(AUTOMATIC_RETRY_MS * 2 ** (this.automaticFailures - 1), AUTOMATIC_MAX_RETRY_MS);
    const attempt = await this.start({ provider: "cloudflare", target: "host" });
    // Without the CLI each retry would run the installer again; wait the longest time.
    if (attempt.issue === "cli-missing")
      this.automaticNotBefore = monotonicNow() + AUTOMATIC_MAX_RETRY_MS;
  }

  private resetAutomaticBackoff(): void {
    this.automaticFailures = 0;
    this.automaticNotBefore = 0;
    this.automaticReadySince = undefined;
  }

  private async setAutomatic(enabled: boolean): Promise<void> {
    await writeFileAtomic(
      join(this.directory, "automatic.json"),
      JSON.stringify({
        environmentId: this.environmentId,
        enabled,
      }),
      { mode: 0o600 },
    );
    this.automaticHostAccess = enabled;
    // The owner acted: start over instead of waiting out an earlier backoff.
    this.resetAutomaticBackoff();
    this.scheduleAutomatic();
  }

  /** Only a live, owned Host tunnel may be advertised. */
  publicHostUrl(): string | undefined {
    return this.records.find(
      (record) =>
        record.provider === "cloudflare" &&
        record.target === "host" &&
        record.state === "ready" &&
        this.owned.has(record.id),
    )?.publicUrl;
  }

  /** Only real I/O failures keep the control lane closed; damaged state is repaired here. */
  private async load(): Promise<void> {
    const path = join(this.directory, "state.json");
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const manifest = this.inspectManifest(bytes);
    if (manifest.kind === "foreign") {
      // Another environment's manifest is evidence: keep it aside, never adopt or delete it.
      await moveAside(
        this.directory,
        `state.foreign-${safeLabel(manifest.environmentId)}`,
        ".json",
        path,
      );
      this.records = [];
    } else {
      if (manifest.kind === "damaged") {
        // Keep the damaged bytes as evidence before the salvaged manifest replaces them.
        await moveAside(this.directory, `state.json.corrupt-${timestampLabel()}`, "", path);
        await pruneCorruptCopies(this.directory);
        this.repair = { repaired: true, dropped: manifest.dropped };
      }
      this.records = manifest.records;
    }
    await this.persist();
  }

  /** Classify saved state without trusting it. Salvaged records are listed, never executed. */
  private inspectManifest(bytes: Buffer): ManifestVerdict {
    const damaged: ManifestVerdict = { kind: "damaged", records: [], dropped: 0 };
    if (bytes.length > MAX_STATE_BYTES) return damaged;
    let saved: unknown;
    try {
      saved = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch {
      return damaged;
    }
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return damaged;
    const manifest = saved as Record<string, unknown>;
    if (typeof manifest.environmentId === "string" && manifest.environmentId !== this.environmentId)
      return { kind: "foreign", environmentId: manifest.environmentId };
    if (
      manifest.version !== 1 ||
      manifest.environmentId !== this.environmentId ||
      !Array.isArray(manifest.tunnels)
    )
      return damaged;
    const records: ExternalTunnel[] = [];
    let dropped = 0;
    for (const entry of manifest.tunnels) {
      const record = this.restoreRecord(entry);
      if (record && records.length < MAX_RECORDS) records.push(record);
      else dropped++;
    }
    return dropped === 0 ? { kind: "current", records } : { kind: "damaged", records, dropped };
  }

  /** Copy only the public contract of one saved record, never its process ownership. */
  private restoreRecord(entry: unknown): ExternalTunnel | undefined {
    try {
      const record = entry as ExternalTunnel;
      if (
        !record ||
        !/^[a-f0-9-]{36}$/.test(record.id) ||
        !TUNNEL_PROVIDERS.includes(record.provider) ||
        !["host", "dev-server"].includes(record.target) ||
        !["starting", "ready", "stopping", "stopped", "error", "interrupted"].includes(
          record.state,
        ) ||
        !Number.isFinite(record.startedAt)
      )
        return undefined;
      return {
        id: record.id,
        provider: record.provider,
        target: record.target,
        localUrl: tunnelLocalUrl(record.localUrl),
        startedAt: record.startedAt,
        state: tunnelActive(record.state) ? "interrupted" : record.state,
        ...(tunnelActive(record.state)
          ? { issue: "host-restarted" as const }
          : record.issue && TUNNEL_ISSUES.includes(record.issue)
            ? { issue: record.issue }
            : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    try {
      const path = join(this.directory, "state.json");
      await writeFileAtomic(
        path,
        JSON.stringify({ version: 1, environmentId: this.environmentId, tunnels: this.records }),
        { mode: 0o600 },
      );
    } catch {
      throw new TunnelError("storage-unavailable");
    }
  }

  status(): Promise<TunnelStatus> {
    return this.serialized(async () => {
      await this.initialize();
      const providers = await Promise.all(
        TUNNEL_PROVIDERS.map(async (provider) => {
          const installed = !!(await this.dependencies.executable(provider).catch(() => undefined));
          if (provider === "cloudflare")
            return { provider, installed, credential: "not-required" as const };
          try {
            const credential = await this.dependencies.credentials.get("ngrok");
            return {
              provider,
              installed,
              credential: credential?.accessToken ? ("saved" as const) : ("missing" as const),
            };
          } catch {
            return { provider, installed, credential: "unavailable" as const };
          }
        }),
      );
      return {
        automaticHostAccess: this.automaticHostAccess,
        environmentId: this.environmentId,
        hostLocalUrl: tunnelLocalUrl(this.hostUrl()),
        providers,
        tunnels: this.records.map((record) => ({ ...record, canStop: this.owned.has(record.id) })),
        publicReachability: "unverified",
        ...(this.repair ? { repair: { ...this.repair } } : {}),
      };
    });
  }

  credential(input: Record<string, unknown>): Promise<{ saved: boolean }> {
    return this.serialized(async () => {
      await this.initialize();
      if (input.provider !== "ngrok") throw new TunnelError("credential-missing");
      // Empty input explicitly forgets this host's saved token.
      const token = input.token;
      if (typeof token !== "string" || token.length > 4096 || /[^!-~]/.test(token))
        throw new TunnelError("credential-missing");
      try {
        if (token) await this.dependencies.credentials.set("ngrok", { accessToken: token });
        else await this.dependencies.credentials.delete("ngrok");
      } catch {
        throw new TunnelError("credential-store-unavailable");
      }
      return { saved: !!token };
    });
  }

  start(input: Record<string, unknown> | TunnelStart): Promise<ExternalTunnel> {
    return this.serialized(async () => {
      await this.initialize();
      if (this.closing) throw new TunnelError("process-error");
      if (
        !TUNNEL_PROVIDERS.includes(input.provider as TunnelProvider) ||
        !["host", "dev-server"].includes(String(input.target))
      )
        throw new TunnelError("invalid-target");
      const provider = input.provider as TunnelProvider;
      const target = input.target as TunnelStart["target"];
      if (input.automatic !== undefined) {
        if (input.automatic !== true || provider !== "cloudflare" || target !== "host")
          throw new TunnelError("invalid-target");
      }
      const host = tunnelLocalUrl(this.hostUrl());
      const localUrl = target === "host" ? host : tunnelLocalUrl(input.localUrl);
      if (
        target === "host" &&
        input.localUrl !== undefined &&
        tunnelLocalUrl(input.localUrl) !== host
      )
        throw new TunnelError("invalid-target");
      const hostPort = new URL(host).port || "80";
      const localPort = new URL(localUrl).port || (localUrl.startsWith("https:") ? "443" : "80");
      if (target === "dev-server" && localPort === hostPort)
        throw new TunnelError("host-target-required");
      if (input.automatic === true) await this.setAutomatic(true);
      const existing = this.records.find(
        (record) =>
          this.owned.has(record.id) &&
          record.provider === provider &&
          record.target === target &&
          record.localUrl === localUrl,
      );
      if (existing) return { ...existing };
      if (this.owned.size >= MAX_ACTIVE) throw new TunnelError("process-error");
      const record: ExternalTunnel = {
        id: randomUUID(),
        provider,
        target,
        localUrl,
        state: "starting",
        startedAt: Date.now(),
      };
      while (this.records.length >= MAX_RECORDS) {
        const removable = this.records.findIndex((entry) => !this.owned.has(entry.id));
        if (removable < 0) throw new TunnelError("process-error");
        this.records.splice(removable, 1);
      }
      this.records.push(record);
      const fail = async (issue: ExternalTunnel["issue"]) => {
        record.state = "error";
        record.issue = issue;
        await this.persist();
        return { ...record };
      };
      let program: string | undefined;
      try {
        program = await this.dependencies.executable(provider);
        if (!program && provider === "cloudflare") program = await this.dependencies.install();
      } catch {
        return fail("cli-missing");
      }
      if (!program) return fail("cli-missing");
      let token: string | undefined;
      if (provider === "ngrok") {
        try {
          token = (await this.dependencies.credentials.get("ngrok"))?.accessToken;
        } catch {
          return fail("credential-store-unavailable");
        }
        if (!token) return fail("credential-missing");
      }
      if (!(await this.dependencies.probe(localUrl).catch(() => false)))
        return fail("origin-unreachable");
      const config = join(this.directory, `${provider}.yml`);
      try {
        // Configs isolate global CLI settings and contain no credentials.
        await writeFile(
          config,
          provider === "ngrok"
            ? 'version: "3"\nagent:\n  web_addr: false\n  update_check: false\n'
            : "{}\n",
          { mode: 0o600 },
        );
        await this.persist();
      } catch {
        return fail("storage-unavailable");
      }
      try {
        const child = this.dependencies.launch(
          tunnelCommand(provider, program, localUrl, config, token),
          (event) => {
            void this.serialized(() => this.event(record.id, event)).catch(() => {
              // Fail closed if recording state becomes impossible.
              record.state = "error";
              record.issue = "storage-unavailable";
              delete record.publicUrl;
              void this.owned
                .get(record.id)
                ?.stop()
                .catch(() => {});
            });
          },
        );
        this.owned.set(record.id, child);
      } catch {
        return fail("process-error");
      }
      return { ...record };
    });
  }

  private async event(id: string, event: TunnelEvent): Promise<void> {
    const record = this.records.find((entry) => entry.id === id);
    if (!record || !this.owned.has(id)) return;
    if (event.type === "ready" && record.state === "starting") {
      const publicUrl = tunnelPublicUrl(record.provider, event.publicUrl);
      if (!publicUrl) return;
      record.state = "ready";
      record.publicUrl = publicUrl;
    } else if (event.type === "error" && record.state !== "stopping") {
      record.state = "error";
      record.issue ??= TUNNEL_ISSUES.includes(event.issue) ? event.issue : "process-error";
      delete record.publicUrl;
      // Do not await here: exit events also use the serialized control lane.
      void this.owned
        .get(id)
        ?.stop()
        .catch(() => {
          void this.serialized(async () => {
            if (!this.owned.has(id)) return;
            record.issue = "stop-failed";
            await this.persist();
          }).catch(() => {});
        });
    } else if (event.type === "exit") {
      this.owned.delete(id);
      delete record.publicUrl;
      if (record.state === "stopping" || record.issue === "stop-failed") {
        record.state = "stopped";
        delete record.issue;
      } else if (tunnelActive(record.state)) {
        record.state = "error";
        record.issue = "unexpected-exit";
      }
    }
    await this.persist();
  }

  stop(input: Record<string, unknown>): Promise<ExternalTunnel> {
    return this.serialized(async () => {
      await this.initialize();
      if (input.automatic === true) {
        await this.setAutomatic(false);
        const active = this.records.find(
          (entry) =>
            entry.provider === "cloudflare" && entry.target === "host" && this.owned.has(entry.id),
        );
        if (active) input = { ...input, id: active.id };
        else
          return {
            id: "",
            provider: "cloudflare",
            target: "host",
            localUrl: tunnelLocalUrl(this.hostUrl()),
            state: "stopped",
            startedAt: Date.now(),
          };
      }
      const record = this.records.find((entry) => entry.id === input.id);
      if (!record) throw new TunnelError("invalid-target");
      if (record.provider === "cloudflare" && record.target === "host" && this.automaticHostAccess)
        await this.setAutomatic(false);
      const child = this.owned.get(record.id);
      if (!child) return { ...record }; // Restarted records convey no authority to kill.
      record.state = "stopping";
      delete record.publicUrl;
      // A broken manifest must never prevent stopping an owned public tunnel.
      await this.persist().catch(() => {});
      try {
        await child.stop();
        this.owned.delete(record.id);
        record.state = "stopped";
        delete record.issue;
      } catch {
        record.state = "error";
        record.issue = "stop-failed";
      }
      await this.persist();
      return { ...record };
    });
  }

  close(): Promise<void> {
    this.closing = true;
    clearTimeout(this.automaticTimer);
    return this.serialized(async () => {
      for (const [id, child] of this.owned) {
        const record = this.records.find((entry) => entry.id === id)!;
        delete record.publicUrl;
        try {
          await child.stop();
          record.state = "stopped";
          delete record.issue;
          this.owned.delete(id);
        } catch {
          record.state = "error";
          record.issue = "stop-failed";
        }
      }
      if (this.initialized) await this.persist();
    });
  }
}
