import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile, rename } from "node:fs/promises";
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
} from "../src/integrations/external-tunnels";
import { OsSocialCredentials, type SocialCredentialStore } from "./social-credentials";
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
  probe: (url: string) => Promise<boolean>;
  launch: (command: TunnelCommand, emit: (event: TunnelEvent) => void) => OwnedTunnelProcess;
};
const MAX_RECORDS = 32;
const MAX_ACTIVE = 4;

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

/** Host-owned control lane. A manifest contains no tokens or reusable PID authority. */
export class ExternalTunnels {
  private records: ExternalTunnel[] = [];
  private owned = new Map<string, OwnedTunnelProcess>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;
  private initialized = false;
  private closing = false;
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
        let text: string;
        try {
          text = await readFile(join(this.directory, "state.json"), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        if (text.length > 128 * 1024) throw new Error();
        const saved = JSON.parse(text);
        if (
          saved.version !== 1 ||
          saved.environmentId !== this.environmentId ||
          !Array.isArray(saved.tunnels) ||
          saved.tunnels.length > MAX_RECORDS
        )
          throw new Error();
        this.records = saved.tunnels.map((record: ExternalTunnel) => {
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
            throw new Error();
          // Copy only the public contract, never deserialize process ownership.
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
        });
        await this.persist();
      } catch {
        throw new TunnelError("storage-unavailable");
      }
    })();
    await this.initialization;
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    try {
      const path = join(this.directory, "state.json");
      await writeFile(
        `${path}.tmp`,
        JSON.stringify({ version: 1, environmentId: this.environmentId, tunnels: this.records }),
        { mode: 0o600 },
      );
      await rename(`${path}.tmp`, path);
    } catch {
      throw new TunnelError("storage-unavailable");
    }
  }

  status(): Promise<TunnelOverview> {
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
        environmentId: this.environmentId,
        hostLocalUrl: tunnelLocalUrl(this.hostUrl()),
        providers,
        tunnels: this.records.map((record) => ({ ...record, canStop: this.owned.has(record.id) })),
        publicReachability: "unverified",
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
      const record = this.records.find((entry) => entry.id === input.id);
      if (!record) throw new TunnelError("invalid-target");
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
