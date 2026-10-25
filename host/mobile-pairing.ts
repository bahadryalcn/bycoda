import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  MOBILE_PAIRING_MAX_BYTES,
  MOBILE_PAIRING_TTL_MS,
  MOBILE_PAIRING_VERSION,
  type MobilePairingTicket as MobilePairingCreated,
  type MobilePairingStatus,
  type MobilePairingRedemption as MobilePairingCredential,
} from "../src/integrations/mobile-pairing";

export type {
  MobilePairingTicket as MobilePairingCreated,
  MobilePairingStatus,
  MobilePairingRedemption as MobilePairingCredential,
} from "../src/integrations/mobile-pairing";

const MAX_PAIRINGS = 32;
const RATE_WINDOW_MS = 60_000;
const MAX_CREATE_PER_OWNER = 10;
const MAX_REDEMPTIONS = 120;
const SECRET_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_ID_FORMAT = /^[a-f0-9-]{36}$/i;
const INVALID_TICKET = "Mobile pairing ticket is invalid or expired. Create a new QR code.";

export type MobilePairingStore = {
  environmentId: string;
  hasDeviceHash: (hash: string) => boolean | Promise<boolean>;
  issueDevice: (
    name: string,
  ) => { id: string; token: string } | Promise<{ id: string; token: string }>;
  transaction?<T>(action: () => T | Promise<T>): T | Promise<T>;
};

type Pairing = {
  id: string;
  issuerHash: string;
  ticketHash: string;
  expiresAt: number;
  state: "pending" | "paired" | "cancelled";
  suggestedName: string;
  claimHash?: string;
  deviceName?: string;
  credential?: MobilePairingCredential;
  expiryTimer: ReturnType<typeof setTimeout>;
};

type Rate = { startedAt: number; count: number };

export class MobilePairingError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "MobilePairingError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deviceName(value: unknown, fallback?: string): string {
  if (value === undefined && fallback) return fallback;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new MobilePairingError("Enter a valid phone name.");
  }
  return value.trim();
}

/** Tickets and retry credentials exist only in this host process for 120 seconds. */
export class MobilePairing {
  private readonly pairings = new Map<string, Pairing>();
  private readonly tickets = new Map<string, string>();
  private readonly creationRates = new Map<string, Rate>();
  private redemptionRate: Rate = { startedAt: 0, count: 0 };
  private redemptionTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly store: MobilePairingStore,
    private readonly now = Date.now,
  ) {}

  async create(
    issuerToken: string,
    input: Record<string, unknown> = {},
  ): Promise<MobilePairingCreated> {
    await this.prune();
    const issuerHash = await this.owner(issuerToken);
    if (this.closed) throw new MobilePairingError(INVALID_TICKET);
    const name = deviceName(input.name, "My phone");
    this.creationRate(issuerHash);
    for (const entry of this.pairings.values()) {
      if (entry.issuerHash === issuerHash && entry.state === "pending") this.cancelEntry(entry);
    }
    for (const entry of this.pairings.values()) {
      if (this.pairings.size < MAX_PAIRINGS) break;
      if (entry.state === "cancelled") this.remove(entry.id);
    }
    if (this.pairings.size >= MAX_PAIRINGS) {
      throw new MobilePairingError(
        "Too many phone connections are being paired. Try again shortly.",
        429,
      );
    }
    const id = randomUUID();
    const ticket = randomBytes(32).toString("base64url");
    const ticketHash = hash(ticket);
    const expiresAt = this.now() + MOBILE_PAIRING_TTL_MS;
    const expiryTimer = setTimeout(() => this.remove(id), MOBILE_PAIRING_TTL_MS);
    expiryTimer.unref();
    const entry: Pairing = {
      id,
      issuerHash,
      ticketHash,
      expiresAt,
      state: "pending",
      suggestedName: name,
      expiryTimer,
    };
    this.pairings.set(id, entry);
    this.tickets.set(ticketHash, id);
    return {
      pairingId: id,
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      environmentId: this.store.environmentId,
    };
  }

  async status(issuerToken: string, pairingId: unknown): Promise<MobilePairingStatus> {
    await this.prune();
    const issuerHash = await this.owner(issuerToken);
    const entry = this.ownedEntry(issuerHash, pairingId);
    if (!entry) return { state: "expired" };
    return {
      state: entry.state,
      ...(entry.state === "paired" ? { deviceName: entry.deviceName } : {}),
    };
  }

  async cancel(issuerToken: string, pairingId: unknown): Promise<MobilePairingStatus> {
    await this.prune();
    const issuerHash = await this.owner(issuerToken);
    const entry = this.ownedEntry(issuerHash, pairingId);
    if (!entry) return { state: "expired" };
    // Closing the QR after successful redemption never revokes the phone.
    if (entry.state === "pending") this.cancelEntry(entry);
    return {
      state: entry.state,
      ...(entry.state === "paired" ? { deviceName: entry.deviceName } : {}),
    };
  }

  async redeem(input: Record<string, unknown>): Promise<MobilePairingCredential> {
    this.redeemRate();
    return await this.enqueueClaim(input);
  }

  private enqueueClaim(input: Record<string, unknown>): Promise<MobilePairingCredential> {
    const captured = structuredClone(input);
    const result = this.redemptionTail.then(async () => {
      if (this.closed) throw new MobilePairingError(INVALID_TICKET);
      return this.store.transaction
        ? await this.store.transaction(async () => await this.claim(captured))
        : await this.claim(captured);
    });
    this.redemptionTail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async claim(input: Record<string, unknown>): Promise<MobilePairingCredential> {
    await this.prune();
    if (
      input.version !== MOBILE_PAIRING_VERSION ||
      input.environmentId !== this.store.environmentId ||
      typeof input.ticket !== "string" ||
      !SECRET_FORMAT.test(input.ticket) ||
      typeof input.claimId !== "string" ||
      !SECRET_FORMAT.test(input.claimId)
    ) {
      throw new MobilePairingError(INVALID_TICKET);
    }
    const id = this.tickets.get(hash(input.ticket));
    const entry = id ? this.pairings.get(id) : undefined;
    if (
      !entry ||
      entry.state === "cancelled" ||
      !(await this.store.hasDeviceHash(entry.issuerHash)) ||
      this.closed ||
      this.pairings.get(entry.id) !== entry ||
      entry.expiresAt <= this.now()
    ) {
      if (entry) this.remove(entry.id);
      throw new MobilePairingError(INVALID_TICKET);
    }
    const name = deviceName(input.deviceName, entry.suggestedName);
    const claimHash = hash(input.claimId);
    if (entry.state === "paired") {
      if (
        entry.claimHash !== claimHash ||
        entry.deviceName !== name ||
        !entry.credential ||
        !(await this.store.hasDeviceHash(hash(entry.credential.token)))
      ) {
        throw new MobilePairingError(INVALID_TICKET);
      }
      if (this.closed || this.pairings.get(entry.id) !== entry || entry.expiresAt <= this.now())
        throw new MobilePairingError(INVALID_TICKET);
      return { ...entry.credential };
    }
    // The FIFO prevents duplicate issuance; the production store's actor transaction
    // keeps issuer validation and device creation in one durable operation.
    let issued: { id: string; token: string };
    try {
      issued = await this.store.issueDevice(name);
      if (
        this.closed ||
        this.pairings.get(entry.id) !== entry ||
        entry.state !== "pending" ||
        entry.expiresAt <= this.now()
      )
        throw new MobilePairingError(INVALID_TICKET);
    } catch (error) {
      // A rejected issuance may already be durable. Never replay this ticket.
      this.cancelEntry(entry);
      throw error;
    }
    const credential = {
      deviceId: issued.id,
      token: issued.token,
      environmentId: this.store.environmentId,
    };
    entry.state = "paired";
    entry.claimHash = claimHash;
    entry.deviceName = name;
    entry.credential = credential;
    return { ...credential };
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.url !== "/mobile/pairing/redeem") return false;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      this.redeemRate();
      if (request.method !== "POST" || request.headers.origin !== undefined) {
        throw new MobilePairingError("Unsupported mobile pairing origin or method.", 403);
      }
      if (
        request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json"
      ) {
        throw new MobilePairingError("Mobile pairing requires JSON.", 415);
      }
      const size = Number(request.headers["content-length"] ?? 0);
      if (size > MOBILE_PAIRING_MAX_BYTES) {
        request.resume();
        throw new MobilePairingError("Mobile pairing request is too large.", 413);
      }
      const input = await this.readBody(request);
      response.end(JSON.stringify({ result: await this.enqueueClaim(input) }));
    } catch (error) {
      if (!response.destroyed)
        response.writeHead(error instanceof MobilePairingError ? error.httpStatus : 400).end(
          JSON.stringify({
            error: error instanceof MobilePairingError ? error.message : "Mobile pairing failed.",
          }),
        );
    }
    return true;
  }

  close(): void {
    this.closed = true;
    for (const id of this.pairings.keys()) this.remove(id);
    this.creationRates.clear();
    this.redemptionRate = { startedAt: 0, count: 0 };
  }

  private async owner(token: string): Promise<string> {
    const issuerHash = hash(token);
    if (
      this.closed ||
      !SECRET_FORMAT.test(token) ||
      !(await this.store.hasDeviceHash(issuerHash))
    ) {
      throw new MobilePairingError("Device credential is invalid or revoked.", 401);
    }
    return issuerHash;
  }

  private ownedEntry(issuerHash: string, id: unknown): Pairing | undefined {
    if (typeof id !== "string" || !PAIRING_ID_FORMAT.test(id)) {
      throw new MobilePairingError("Invalid mobile pairing ID.");
    }
    const entry = this.pairings.get(id);
    return entry?.issuerHash === issuerHash ? entry : undefined;
  }

  private cancelEntry(entry: Pairing): void {
    entry.state = "cancelled";
    this.tickets.delete(entry.ticketHash);
  }

  private remove(id: string): void {
    const entry = this.pairings.get(id);
    if (!entry) return;
    clearTimeout(entry.expiryTimer);
    // Explicitly drop the retry credential before releasing the entry.
    entry.credential = undefined;
    this.tickets.delete(entry.ticketHash);
    this.pairings.delete(id);
  }

  private async prune(): Promise<Awaited<void>> {
    const now = this.now();
    for (const entry of this.pairings.values()) {
      if (entry.expiresAt <= now || !(await this.store.hasDeviceHash(entry.issuerHash)))
        this.remove(entry.id);
    }
    for (const [owner, rate] of this.creationRates) {
      if (now - rate.startedAt >= RATE_WINDOW_MS) this.creationRates.delete(owner);
    }
  }

  private creationRate(owner: string): void {
    const now = this.now();
    const rate = this.creationRates.get(owner) ?? { startedAt: now, count: 0 };
    if (
      rate.count >= MAX_CREATE_PER_OWNER ||
      (!this.creationRates.has(owner) && this.creationRates.size >= 64)
    ) {
      throw new MobilePairingError("Too many pairing attempts. Try again shortly.", 429);
    }
    rate.count++;
    this.creationRates.set(owner, rate);
  }

  private redeemRate(): void {
    const now = this.now();
    if (now - this.redemptionRate.startedAt >= RATE_WINDOW_MS)
      this.redemptionRate = { startedAt: now, count: 0 };
    if (this.redemptionRate.count >= MAX_REDEMPTIONS) {
      throw new MobilePairingError("Too many pairing attempts. Try again shortly.", 429);
    }
    this.redemptionRate.count++;
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MOBILE_PAIRING_MAX_BYTES) {
        request.resume();
        throw new MobilePairingError("Mobile pairing request is too large.", 413);
      }
      chunks.push(buffer);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new MobilePairingError("Invalid mobile pairing request.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new MobilePairingError("Invalid mobile pairing request.");
    return input as Record<string, unknown>;
  }
}
