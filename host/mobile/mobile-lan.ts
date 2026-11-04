import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname, networkInterfaces } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import {
  isLanAddress,
  MOBILE_LAN_MAX_BYTES,
  MOBILE_LAN_MAX_WIRE_BYTES,
  MOBILE_LAN_WINDOW_MS,
} from "../../src/integrations/mobile-lan";
import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { createLanIdentity, openLanRequest } from "./mobile-lan-crypto";
import { createMobileWssGateway } from "../security/mobile-wss";
import type { MobileTlsAuthority, MobileTlsMaterial } from "../security/mobile-tls";

export function localMobileAddresses(): string[] {
  return [
    ...new Set(
      Object.entries(networkInterfaces())
        .sort(
          ([a], [b]) =>
            Number(/virtual|vethernet|docker|wsl|vpn/i.test(a)) -
            Number(/virtual|vethernet|docker|wsl|vpn/i.test(b)),
        )
        .flatMap(([, entries]) =>
          (entries ?? [])
            .filter(
              (entry) => !entry.internal && entry.family === "IPv4" && isLanAddress(entry.address),
            )
            .map((entry) => entry.address),
        ),
    ),
  ];
}
function interfaceForAddress(address: string): string | undefined {
  return Object.entries(networkInterfaces()).find(([, entries]) =>
    (entries ?? []).some((entry) => !entry.internal && entry.family === "IPv4" && entry.address === address),
  )?.[0];
}
function addressForInterface(name: string): string | undefined {
  return (networkInterfaces()[name] ?? []).find((entry) =>
    !entry.internal && entry.family === "IPv4" && isLanAddress(entry.address),
  )?.address;
}

async function boundedBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers["content-length"]) > MOBILE_LAN_MAX_WIRE_BYTES)
    throw new Error("Too large");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MOBILE_LAN_MAX_WIRE_BYTES) throw new Error("Too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The LAN listener exposes only encrypted envelopes; owner RPC stays loopback. */
export function createLanGateway(
  identity: ReturnType<typeof createLanIdentity>,
  environmentId: string,
  getPort: () => number,
) {
  const seen = new Map<string, number>();
  const epoch = randomBytes(32).toString("hex");
  let pending = 0;
  return createServer(
    { requestTimeout: 180_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const deny = () => {
        if (!response.destroyed)
          response.writeHead(403).end('{"error":"Mobile LAN request rejected."}');
      };
      // The public boot challenge prevents replay across listener restarts.
      if (
        request.method === "GET" &&
        request.url === "/mobile/lan/hello" &&
        request.headers.origin === undefined &&
        request.headers.authorization === undefined
      ) {
        response.end(JSON.stringify({ version: 1, epoch }));
        return;
      }
      if (
        request.method !== "POST" ||
        request.url !== "/mobile/lan" ||
        request.headers.origin !== undefined ||
        request.headers.authorization !== undefined ||
        request.headers["content-type"]?.split(";")[0].trim() !== "application/json"
      ) {
        request.resume();
        deny();
        return;
      }
      if (pending >= 16) {
        request.resume();
        response.setHeader("Retry-After", "1");
        response.writeHead(429).end('{"error":"Mobile LAN is busy."}');
        return;
      }
      pending++;
      try {
        const opened = openLanRequest(
          JSON.parse(await boundedBody(request)),
          identity,
          environmentId,
        );
        const input = opened.input;
        const now = Date.now();
        for (const [id, expiry] of seen) if (expiry <= now) seen.delete(id);
        if (
          !input ||
          typeof input !== "object" ||
          input.epoch !== epoch ||
          !Number.isFinite(input.time) ||
          Math.abs(now - input.time) > MOBILE_LAN_WINDOW_MS ||
          seen.has(opened.envelope.id) ||
          seen.size >= 10_000 ||
          !["/rpc", "/mobile/pairing/redeem"].includes(input.path) ||
          typeof input.body !== "string" ||
          Buffer.byteLength(input.body) > MOBILE_LAN_MAX_BYTES ||
          (input.path === "/rpc" &&
            (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.token))) ||
          (input.path === "/mobile/pairing/redeem" && input.token !== undefined)
        )
          throw new Error("Invalid request");
        // Remember before dispatch; a captured write can never execute twice.
        seen.set(opened.envelope.id, now + MOBILE_LAN_WINDOW_MS * 2);
        const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const upstream = httpRequest(
            {
              hostname: "127.0.0.1",
              port: getPort(),
              path: input.path,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(input.body),
                ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
              },
            },
            (reply) => {
              let size = 0;
              const chunks: Buffer[] = [];
              reply.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > MOBILE_LAN_MAX_BYTES) upstream.destroy(new Error("Response too large"));
                else chunks.push(chunk);
              });
              reply.on("error", reject);
              reply.on("end", () =>
                resolve({
                  status: reply.statusCode ?? 502,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          const disconnect = () => {
            if (!response.writableEnded) upstream.destroy(new Error("Disconnected"));
          };
          response.once("close", disconnect);
          upstream.once("close", () => response.off("close", disconnect));
          upstream.setTimeout(180_000, () => upstream.destroy(new Error("Timeout")));
          upstream.on("error", reject);
          upstream.end(input.body);
        });
        if (!response.destroyed) response.end(JSON.stringify(opened.seal(result)));
      } catch {
        deny();
      } finally {
        pending--;
      }
    },
  );
}

type SavedAccess = {
  key: string;
  enabled: boolean;
  address?: string;
  port?: number;
  tlsPort?: number;
  interfaceName?: string;
};
export type MobileLanTlsOptions = {
  tlsAuthority: MobileTlsAuthority;
  ingressSecret?: string;
  makeWssGateway?: typeof createMobileWssGateway;
};
export class MobileLanAccess {
  private saved?: SavedAccess;
  private identity?: ReturnType<typeof createLanIdentity>;
  private gateway?: ReturnType<typeof createLanGateway>;
  private wssGateway?: ReturnType<typeof createMobileWssGateway>;
  private tlsBootstrap?: MobileAccessStatus["tls"];
  private tlsExpiresAt?: number;
  private renewal?: ReturnType<typeof setTimeout>;
  private renewalOwner?: object;
  private loading?: Promise<void>;
  private operation?: Promise<MobileAccessStatus>;
  private addressTimer?: ReturnType<typeof setInterval>;
  private addressCheck?: Promise<void>;
  private notice?: string;
  private disposed = false;
  constructor(
    private readonly file: string,
    private readonly environmentId: string,
    private readonly getPort: () => number,
    private readonly addresses = localMobileAddresses,
    private readonly makeGateway = createLanGateway,
    private readonly tlsOptions?: MobileLanTlsOptions,
  ) {}

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    const attempt = (async () => {
      let text: string;
      try {
        text = await readFile(this.file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      const saved = JSON.parse(text) as SavedAccess;
      if (
        typeof saved.enabled !== "boolean" ||
        typeof saved.key !== "string" ||
        (saved.address !== undefined && !isLanAddress(saved.address)) ||
        (saved.interfaceName !== undefined &&
          (typeof saved.interfaceName !== "string" || !saved.interfaceName || saved.interfaceName.length > 256)) ||
        (saved.port !== undefined &&
          (!Number.isInteger(saved.port) || saved.port < 1 || saved.port > 65535)) ||
        (saved.tlsPort !== undefined &&
          (!Number.isInteger(saved.tlsPort) || saved.tlsPort < 1 || saved.tlsPort > 65535))
      )
        throw new Error("Invalid saved LAN access");
      this.identity = createLanIdentity(saved.key);
      this.saved = saved;
    })();
    this.loading = attempt;
    // A rejected load must not be cached forever; let a later call retry.
    attempt.catch(() => {
      if (this.loading === attempt) this.loading = undefined;
    });
    return attempt;
  }
  private async persist(saved: SavedAccess) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
    await rename(temp, this.file);
    this.saved = saved;
  }
  async status(): Promise<MobileAccessStatus> {
    await this.load();
    const addresses = this.addresses();
    const active = this.gateway?.address();
    const ready = active && typeof active !== "string" && addresses.includes(active.address);
    const tlsActive = this.wssGateway?.address();
    const tls =
      ready &&
      tlsActive &&
      typeof tlsActive !== "string" &&
      tlsActive.address === active.address &&
      tlsActive.port === this.saved?.tlsPort &&
      this.tlsExpiresAt !== undefined &&
      this.tlsExpiresAt > Date.now()
        ? this.tlsBootstrap
        : undefined;
    return {
      mode: "lan",
      state: ready ? "ready" : this.notice ? "unavailable" : addresses.length ? "setup-required" : "unavailable",
      addresses,
      ...(this.notice ? { reason: this.notice } : {}),
      machineName: hostname().slice(0, 120),
      ...(ready
        ? { endpoint: `http://${active.address}:${active.port}`, lanKey: this.identity!.publicKey }
        : {}),
      ...(tls ? { tls } : {}),
    };
  }
  async start(): Promise<void> {
    await this.load();
    if (this.saved?.enabled && !this.disposed) {
      this.watchAddress();
      await this.enable(this.saved.address);
    }
  }
  private watchAddress(): void {
    if (this.addressTimer || this.disposed) return;
    this.addressTimer = setInterval(() => {
      if (this.addressCheck || this.operation || this.disposed || !this.saved?.enabled) return;
      const check = (async () => {
        const selected = this.saved?.address;
        if (!selected) return;
        const current = this.saved?.interfaceName ? addressForInterface(this.saved.interfaceName) : selected;
        const available = !!current && this.addresses().includes(current);
        const active = this.gateway?.address();
        if (!available) {
          this.notice = "The selected mobile network interface is unavailable.";
          if (active) await this.closeGateway();
        }
        else if (available && (!active || (typeof active !== "string" && active.address !== current)) && !this.disposed)
          await this.enable(current);
      })();
      this.addressCheck = check;
      void check.catch(() => {}).finally(() => {
        if (this.addressCheck === check) this.addressCheck = undefined;
      });
    }, 15_000);
    this.addressTimer.unref?.();
  }
  enable(address?: unknown): Promise<MobileAccessStatus> {
    if (this.operation) return this.operation;
    const operation = (async (): Promise<MobileAccessStatus> => {
      await this.load();
      if (this.disposed) throw new Error("Host is closing");
      const addresses = this.addresses();
      const selected = address === undefined ? addresses[0] : address;
      if (typeof selected !== "string" || !isLanAddress(selected) || !addresses.includes(selected))
        return this.status();
      if (
        this.gateway?.address() &&
        this.saved?.address === selected &&
        (!this.tlsOptions || this.wssGateway?.address())
      )
        return this.status();
      this.identity ??= createLanIdentity();
      let material;
      try {
        if (this.tlsOptions) {
          if (this.tlsOptions.tlsAuthority.environmentId !== this.environmentId)
            throw new Error("TLS Host identity changed");
          material = await this.tlsOptions.tlsAuthority.issue([selected]);
        }
      } catch {
        return { mode: "lan", state: "unavailable", addresses };
      }
      await this.closeGateway();
      const gateway = this.makeGateway(this.identity, this.environmentId, this.getPort);
      let wss: ReturnType<typeof createMobileWssGateway> | undefined;
      gateway.maxConnections = 32;
      try {
        const listenGateway = (port: number) =>
          new Promise<void>((resolve, reject) => {
            gateway.once("error", reject);
            gateway.listen(port, selected, () => {
              gateway.off("error", reject);
              resolve();
            });
          });
        // A paired device holds this endpoint. Never silently replace a saved
        // port when another process owns it; surface unavailable instead.
        await listenGateway(this.saved?.port ?? 0);
        if (this.disposed) throw new Error("Host is closing");
        const active = gateway.address();
        if (!active || typeof active === "string") throw new Error("LAN access unavailable");
        let tls: MobileAccessStatus["tls"];
        let tlsPort: number | undefined;
        if (material && this.tlsOptions) {
          wss = (this.tlsOptions.makeWssGateway ?? createMobileWssGateway)({
            address: selected,
            getPort: this.getPort,
            material,
            ingressSecret: this.tlsOptions.ingressSecret,
          });
          const listen = (port: number) =>
            new Promise<void>((resolve, reject) => {
              wss!.once("error", reject);
              wss!.listen(port, selected, () => {
                wss!.off("error", reject);
                resolve();
              });
            });
          await listen(this.saved?.tlsPort ?? 0);
          const address = wss.address();
          if (!address || typeof address === "string")
            throw new Error("Mobile TLS access unavailable");
          tlsPort = address.port;
          tls = await this.tlsOptions.tlsAuthority.bootstrap(selected, tlsPort);
        }
        const previousAddress = this.saved?.address;
        const interfaceName = interfaceForAddress(selected);
        await this.persist({
          key: this.identity.encoded,
          enabled: true,
          address: selected,
          ...(interfaceName ? { interfaceName } : {}),
          port: active.port,
          ...(tlsPort ? { tlsPort } : {}),
        });
        if (this.disposed) throw new Error("Host is closing");
        this.gateway = gateway;
        this.wssGateway = wss;
        this.tlsBootstrap = tls;
        this.tlsExpiresAt = material?.expiresAt;
        this.notice = previousAddress && previousAddress !== selected ? "Mobile address changed. Reconnect paired devices using the new endpoint." : undefined;
        this.watchAddress();
        if (wss && this.tlsOptions && material && tlsPort) {
          const secure = wss;
          this.startTlsRenewal(secure, selected, tlsPort, material);
          wss.on("error", () => {
            if (this.wssGateway === secure) void this.closeGateway();
          });
        }
        gateway.on("error", () => {
          if (this.gateway === gateway) void this.closeGateway();
        });
        return await this.status();
      } catch (error) {
        this.notice = (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? "The saved mobile port is in use. Free it and retry."
          : "Mobile LAN access could not start. Check the selected network and retry.";
        if (this.gateway === gateway || (wss && this.wssGateway === wss)) {
          await this.closeGateway();
        } else {
          gateway.closeAllConnections();
          gateway.close();
          wss?.closeAllConnections();
          wss?.close();
        }
        return { mode: "lan", state: "unavailable", addresses, reason: this.notice } as MobileAccessStatus;
      }
    })();
    this.operation = operation;
    void operation
      .finally(() => {
        if (this.operation === operation) this.operation = undefined;
      })
      .catch(() => {});
    return operation;
  }
  private startTlsRenewal(
    secure: ReturnType<typeof createMobileWssGateway>,
    address: string,
    port: number,
    material: MobileTlsMaterial,
  ): void {
    const authority = this.tlsOptions!.tlsAuthority;
    const owner = Object.freeze({
      caSpkiPin: material.caSpkiPin,
      caGeneration: material.caGeneration,
      caCertificatePem: material.caCertificatePem,
    });
    this.renewalOwner = owner;
    const current = () =>
      !this.disposed &&
      this.renewalOwner === owner &&
      this.wssGateway === secure &&
      this.saved?.enabled === true &&
      this.saved.address === address &&
      this.saved.tlsPort === port;
    let retryDelay = 60_000;
    const schedule = (delay: number) => {
      if (!current()) return;
      const timer = setTimeout(() => {
        if (!current() || this.renewal !== timer) return;
        this.renewal = undefined;
        void renew().catch(() => {});
      }, delay);
      this.renewal = timer;
      timer.unref?.();
    };
    const renew = async () => {
      let nextDelay = 3_600_000;
      try {
        const renewed = await authority.issue([address]);
        if (!current()) return;
        if (
          renewed.caSpkiPin !== owner.caSpkiPin ||
          renewed.caGeneration !== owner.caGeneration ||
          renewed.caCertificatePem !== owner.caCertificatePem ||
          !Number.isFinite(renewed.expiresAt) ||
          renewed.expiresAt <= Date.now()
        )
          throw new Error("Mobile TLS renewal changed its original trust or validity.");
        const bound = secure.address();
        if (!bound || typeof bound === "string" || bound.address !== address || bound.port !== port)
          throw new Error("The original mobile TLS listener binding could not be confirmed.");
        secure.setSecureContext({
          key: renewed.privateKeyPem,
          cert: renewed.certificatePem + renewed.caCertificatePem,
        });
        this.tlsExpiresAt = renewed.expiresAt;
        retryDelay = 60_000;
      } catch {
        // Keep the original listener and context. Failed issuance is not proof
        // that it stopped; an expired leaf is omitted from bootstrap disclosure.
        nextDelay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 3_600_000);
      } finally {
        // Schedule only after actual settlement: a hung issue never overlaps a
        // second one, and a closed/replaced owner cannot install or restart it.
        schedule(nextDelay);
      }
    };
    schedule(3_600_000);
  }
  async disable(): Promise<MobileAccessStatus> {
    clearInterval(this.addressTimer);
    this.addressTimer = undefined;
    await this.addressCheck?.catch(() => {});
    await this.operation?.catch(() => {});
    clearInterval(this.addressTimer);
    this.addressTimer = undefined;
    await this.load();
    if (this.saved) await this.persist({ ...this.saved, enabled: false });
    await this.closeGateway();
    return this.status();
  }
  private async closeGateway(): Promise<void> {
    const gateway = this.gateway;
    const wss = this.wssGateway;
    this.gateway = undefined;
    this.wssGateway = undefined;
    this.tlsBootstrap = undefined;
    this.tlsExpiresAt = undefined;
    this.renewalOwner = undefined;
    clearTimeout(this.renewal);
    this.renewal = undefined;
    await Promise.all(
      [gateway, wss]
        .filter((server) => server !== undefined)
        .map(async (server) => {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }),
    );
  }
  async close(): Promise<void> {
    this.disposed = true;
    clearInterval(this.addressTimer);
    this.addressTimer = undefined;
    await this.addressCheck?.catch(() => {});
    await this.operation?.catch(() => {});
    await this.closeGateway();
  }
}
