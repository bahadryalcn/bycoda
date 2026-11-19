import { createHash } from "node:crypto";

/** Identity of the exact report a window set last delivered: owner ids, their update stamps and
 * report nonces. It is derived from the same fields on the Host and in Rust, never from bytes, so a
 * heartbeat can name "the report I last sent" without minting a version, archive or certificate. */
export function reportIdentity(
  owners: readonly {
    ownerId: string;
    updatedAt: number;
    source?: { reportNonce: string | null };
  }[],
) {
  const lines = owners
    .map((owner) => `${owner.ownerId}|${owner.updatedAt}|${owner.source?.reportNonce ?? ""}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

type Current = { value: { processId: number; retiredAt?: number; receivedAt: number } } | null;

/** The lease a report holds without a heartbeat. Same 45 s the native gate and recovery use. */
const LEASE_MS = 45_000;

/** In-memory lease of one report: the identity it last delivered, when it was received and the last
 * heartbeat that extended it. `beat` stays 0 until a heartbeat arrives. */
type Lease = { identity: string; received: number; beat: number };

/** The 45 s freshness of a report is in-memory only (a restarted Host treats every report as
 * stale), so a heartbeat extends it here and leaves the durable snapshot, history and clock alone. */
export function createNativeBufferHeartbeat<Auth, Capability>(deps: {
  now: () => number;
  refreshed: Set<string>;
  mutate: <T>(owner: Auth, action: () => Promise<T>) => Promise<T>;
  authenticate: (owner: Auth, expected?: string) => Promise<string>;
  captureOwner: (capability: Capability) => Auth;
  current: (id: string) => Promise<Current>;
  reportKey: (value: { device: string; clientId: string; instanceId: string }) => string;
  identity: (value: unknown, label: string) => void;
}) {
  const leases = new Map<string, Lease>();
  // A lapsed lease already answers stale and reads as stale everywhere (`refreshed` absent or the
  // time check fails), so forgetting it changes no decision and only frees memory.
  function forget(id: string) {
    leases.delete(id);
    deps.refreshed.delete(id);
  }
  function pruneLapsed() {
    const at = deps.now();
    for (const [id, lease] of leases)
      if (at - Math.max(lease.received, lease.beat) > LEASE_MS) forget(id);
  }
  return {
    /** Latest proof of life: a stored timestamp or the last heartbeat, whichever is newer. */
    fresh: (id: string, stored: number) => Math.max(stored, leases.get(id)?.beat ?? 0),
    /** Called once a full report is committed. */
    remember(id: string, owners: Parameters<typeof reportIdentity>[0], received: number) {
      pruneLapsed();
      deps.refreshed.add(id);
      leases.set(id, { identity: reportIdentity(owners), received, beat: 0 });
    },
    /** Called once a report is retired: it can never be alive again, so its lease is dropped. */
    retire(id: string) {
      forget(id);
    },
    heartbeat(
      request: { clientId: string; instanceId: string; processId: number; reportIdentity: string },
      capability: Capability,
    ) {
      const input = structuredClone(request),
        owner = deps.captureOwner(capability);
      return deps.mutate(owner, async () => {
        const device = await deps.authenticate(owner);
        deps.identity(input.clientId, "client identity");
        deps.identity(input.instanceId, "instance identity");
        const id = deps.reportKey({
          device,
          clientId: input.clientId,
          instanceId: input.instanceId,
        });
        const captured = await deps.current(id);
        pruneLapsed();
        const lease = leases.get(id);
        // A report that already lapsed must go through the full path so its owners are held.
        const alive =
          !!captured &&
          !!lease &&
          captured.value.retiredAt === undefined &&
          captured.value.processId === input.processId &&
          deps.refreshed.has(id) &&
          lease.identity === input.reportIdentity &&
          deps.now() - Math.max(captured.value.receivedAt, lease.beat) <= LEASE_MS;
        if (alive && lease) lease.beat = deps.now();
        await deps.authenticate(owner, device);
        return alive
          ? { acknowledged: true as const }
          : { acknowledged: false as const, reason: "stale" as const };
      });
    },
  };
}
