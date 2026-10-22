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
} from "../src/integrations/mobile-lan";
import type { MobileAccessStatus } from "../src/integrations/mobile-access";
import { createLanIdentity, openLanRequest } from "./mobile-lan-crypto";

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
        request.headers["content-type"]?.split(";")[0].trim() !== "application/json" ||
        pending >= 16
      ) {
        request.resume();
        deny();
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

type SavedAccess = { key: string; enabled: boolean; address?: string; port?: number };
export class MobileLanAccess {
  private saved?: SavedAccess;
  private identity?: ReturnType<typeof createLanIdentity>;
  private gateway?: ReturnType<typeof createLanGateway>;
  private loading?: Promise<void>;
  private operation?: Promise<MobileAccessStatus>;
  private disposed = false;
  constructor(
    private readonly file: string,
    private readonly environmentId: string,
    private readonly getPort: () => number,
    private readonly addresses = localMobileAddresses,
    private readonly makeGateway = createLanGateway,
  ) {}

  private load(): Promise<void> {
    return (this.loading ??= (async () => {
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
        (saved.port !== undefined &&
          (!Number.isInteger(saved.port) || saved.port < 1 || saved.port > 65535))
      )
        throw new Error("Invalid saved LAN access");
      this.identity = createLanIdentity(saved.key);
      this.saved = saved;
    })());
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
    return {
      mode: "lan",
      state: ready ? "ready" : addresses.length ? "setup-required" : "unavailable",
      addresses,
      machineName: hostname().slice(0, 120),
      ...(ready
        ? { endpoint: `http://${active.address}:${active.port}`, lanKey: this.identity!.publicKey }
        : {}),
    };
  }
  async start(): Promise<void> {
    await this.load();
    if (this.saved?.enabled && !this.disposed) await this.enable(this.saved.address);
  }
  enable(address?: unknown): Promise<MobileAccessStatus> {
    if (this.operation) return this.operation;
    const operation = (async () => {
      await this.load();
      if (this.disposed) throw new Error("Host is closing");
      const addresses = this.addresses();
      const selected = address === undefined ? addresses[0] : address;
      if (typeof selected !== "string" || !isLanAddress(selected) || !addresses.includes(selected))
        return this.status();
      if (this.gateway?.address() && this.saved?.address === selected) return this.status();
      this.identity ??= createLanIdentity();
      await this.closeGateway();
      const gateway = this.makeGateway(this.identity, this.environmentId, this.getPort);
      gateway.maxConnections = 32;
      try {
        await new Promise<void>((resolve, reject) => {
          gateway.once("error", reject);
          gateway.listen(this.saved?.port ?? 0, selected, () => {
            gateway.off("error", reject);
            resolve();
          });
        });
        if (this.disposed) throw new Error("Host is closing");
        const active = gateway.address();
        if (!active || typeof active === "string") throw new Error("LAN access unavailable");
        await this.persist({
          key: this.identity.encoded,
          enabled: true,
          address: selected,
          port: active.port,
        });
        if (this.disposed) throw new Error("Host is closing");
        this.gateway = gateway;
        gateway.on("error", () => {
          if (this.gateway === gateway) void this.closeGateway();
        });
        return await this.status();
      } catch {
        gateway.closeAllConnections();
        gateway.close();
        return { mode: "lan", state: "unavailable", addresses } as MobileAccessStatus;
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
  async disable(): Promise<MobileAccessStatus> {
    await this.operation?.catch(() => {});
    await this.load();
    if (this.saved) await this.persist({ ...this.saved, enabled: false });
    await this.closeGateway();
    return this.status();
  }
  private async closeGateway(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = undefined;
    if (!gateway) return;
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  }
  async close(): Promise<void> {
    this.disposed = true;
    await this.operation?.catch(() => {});
    await this.closeGateway();
  }
}
