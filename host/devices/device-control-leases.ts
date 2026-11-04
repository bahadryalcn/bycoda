import { randomUUID } from "node:crypto";

type Lease = {
  owner: string;
  id: string;
  expiresAt: number;
  deadline: number;
  authorized: () => Promise<boolean>;
  inFlight: number;
};
type Receipt = {
  owner: string;
  deviceId: string;
  leaseId: string;
  lease: Lease;
  payload: string;
  result: Promise<unknown>;
};

/** Host-local ownership. Tokens are never accepted as proof without the captured owner. */
export class DeviceControlLeases {
  private readonly leases = new Map<string, Lease>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly claims = new Map<string, { deviceId: string; lease: Lease }>();
  constructor(
    private readonly now = () => performance.now(),
    private readonly durationMs = 600_000,
    private readonly wallNow = () => Date.now(),
  ) {}

  private retire(lease: Lease, includeReceipts = true) {
    if (lease.inFlight) return;
    for (const [key, receipt] of this.claims) if (receipt.lease === lease) this.claims.delete(key);
    if (includeReceipts)
      for (const [key, receipt] of this.receipts)
        if (receipt.leaseId === lease.id) this.receipts.delete(key);
  }

  private async live(deviceId: string): Promise<Lease | undefined> {
    const lease = this.leases.get(deviceId);
    if (!lease) return undefined;
    let authorized = false;
    try {
      authorized = await lease.authorized();
    } catch {
      /* fail closed */
    }
    if (!authorized || lease.deadline <= this.now()) {
      // An expired or revoked owner cannot issue input, but its accepted effect
      // must finish before a different owner can acquire the physical device.
      if (lease.inFlight) return lease;
      for (const [id, current] of this.leases) if (current === lease) this.leases.delete(id);
      this.retire(lease, false);
      return undefined;
    }
    return this.leases.get(deviceId) === lease ? lease : undefined;
  }

  async status(deviceId: string) {
    const lease = await this.live(deviceId);
    return { deviceId, busy: !!lease };
  }

  async claim(
    deviceId: string,
    owner: string,
    requestId: string,
    authorized: () => Promise<boolean>,
  ) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
      throw new Error("Invalid device request identity");
    if (!(await authorized())) throw new Error("DEVICE_AUTHORITY_REVOKED");
    const key = JSON.stringify([owner, requestId]);
    const receipt = this.claims.get(key);
    if (receipt) {
      if (receipt.deviceId !== deviceId) throw new Error("DEVICE_REQUEST_CONFLICT");
      await this.assert(deviceId, owner, receipt.lease.id);
      return { deviceId, leaseId: receipt.lease.id, expiresAt: receipt.lease.expiresAt };
    }
    const existing = await this.live(deviceId);
    if (existing) throw new Error("DEVICE_CONTROL_BUSY");
    // Recheck after async authorization: a competing claim may have won.
    const current = this.leases.get(deviceId);
    if (current && current !== existing) throw new Error("DEVICE_CONTROL_BUSY");
    if (this.claims.size >= 4096) throw new Error("DEVICE_RECEIPT_CAPACITY");
    const lease: Lease = {
      owner,
      id: randomUUID(),
      expiresAt: this.wallNow() + this.durationMs,
      deadline: this.now() + this.durationMs,
      authorized,
      inFlight: 0,
    };
    this.leases.set(deviceId, lease);
    this.claims.set(key, { deviceId, lease });
    return { deviceId, leaseId: lease.id, expiresAt: lease.expiresAt };
  }

  async assert(deviceId: string, owner: string, leaseId: string) {
    const lease = await this.live(deviceId);
    if (
      !lease ||
      lease.owner !== owner ||
      lease.id !== leaseId ||
      lease.deadline <= this.now() ||
      !(await lease.authorized().catch(() => false)) ||
      this.leases.get(deviceId) !== lease ||
      lease.deadline <= this.now()
    )
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
  }

  async release(deviceId: string, owner: string, leaseId: string) {
    await this.assert(deviceId, owner, leaseId);
    const current = this.leases.get(deviceId);
    if (!current || current.owner !== owner || current.id !== leaseId)
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    if (current.inFlight) throw new Error("DEVICE_CONTROL_BUSY");
    for (const [id, lease] of this.leases) if (lease === current) this.leases.delete(id);
    this.retire(current);
    return { released: true };
  }

  async renew(deviceId: string, owner: string, leaseId: string) {
    await this.assert(deviceId, owner, leaseId);
    const lease = this.leases.get(deviceId);
    if (!lease || lease.owner !== owner || lease.id !== leaseId || lease.deadline <= this.now())
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    lease.deadline = this.now() + this.durationMs;
    lease.expiresAt = this.wallNow() + this.durationMs;
    return { deviceId, leaseId, expiresAt: lease.expiresAt };
  }

  /** Bind a boot result only after the selected-device boot operation proves it. */
  async bindBootTarget(deviceId: string, targetId: string, owner: string, leaseId: string) {
    await this.assert(deviceId, owner, leaseId);
    if (!targetId || targetId.length > 200) throw new Error("Invalid device ID");
    const target = await this.live(targetId);
    const lease = this.leases.get(deviceId);
    if (!lease || lease.owner !== owner || lease.id !== leaseId || lease.deadline <= this.now())
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    if (target && target !== lease) throw new Error("DEVICE_CONTROL_BUSY");
    const current = this.leases.get(targetId);
    if (current && current !== lease) throw new Error("DEVICE_CONTROL_BUSY");
    this.leases.set(targetId, lease);
  }

  async execute<T>(
    deviceId: string,
    owner: string,
    leaseId: string,
    requestId: string,
    payload: unknown,
    operation: (track: <U>(work: Promise<U>) => Promise<U>) => Promise<T>,
    onReplay?: () => void,
  ): Promise<T> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
      throw new Error("Invalid device request identity");
    const key = JSON.stringify([owner, requestId]);
    const encoded = JSON.stringify(payload);
    const prior = async () => {
      const existing = this.receipts.get(key);
      if (!existing) return undefined;
      if (
        existing.deviceId !== deviceId ||
        existing.leaseId !== leaseId ||
        existing.payload !== encoded
      )
        throw new Error("DEVICE_REQUEST_CONFLICT");
      if (!(await existing.lease.authorized().catch(() => false)))
        throw new Error("DEVICE_AUTHORITY_REVOKED");
      return existing;
    };
    const existing = await prior();
    if (existing) {
      onReplay?.();
      return existing.result as Promise<T>;
    }
    await this.assert(deviceId, owner, leaseId);
    const raced = await prior();
    if (raced) {
      onReplay?.();
      return raced.result as Promise<T>;
    }
    for (const [receiptKey, receipt] of this.receipts)
      if (
        !receipt.lease.inFlight &&
        this.leases.get(receipt.deviceId) !== receipt.lease &&
        this.now() >= receipt.lease.deadline + 600_000
      )
        this.receipts.delete(receiptKey);
    if (this.receipts.size >= 4096) throw new Error("DEVICE_RECEIPT_CAPACITY");
    const lease = this.leases.get(deviceId);
    if (!lease || lease.owner !== owner || lease.id !== leaseId || lease.deadline <= this.now())
      throw new Error("DEVICE_CONTROL_LEASE_INVALID");
    if (lease.inFlight) throw new Error("DEVICE_CONTROL_BUSY");
    lease.inFlight++;
    const track = <U>(work: Promise<U>): Promise<U> => {
      lease.inFlight++;
      void work.then(
        () => {
          lease.inFlight--;
        },
        () => {
          lease.inFlight--;
        },
      );
      return work;
    };
    const result = Promise.resolve()
      .then(() => operation(track))
      .finally(() => {
        lease.inFlight--;
      });
    this.receipts.set(key, { owner, deviceId, leaseId, lease, payload: encoded, result });
    return result;
  }
}
