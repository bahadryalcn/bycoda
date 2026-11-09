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
  const identities = new Map<string, string>();
  const beats = new Map<string, number>();
  return {
    /** Latest proof of life: a stored timestamp or the last heartbeat, whichever is newer. */
    fresh: (id: string, stored: number) => Math.max(stored, beats.get(id) ?? 0),
    /** Called once a full report is committed. */
    remember(id: string, owners: Parameters<typeof reportIdentity>[0]) {
      deps.refreshed.add(id);
      identities.set(id, reportIdentity(owners));
      beats.delete(id);
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
        // A report that already lapsed must go through the full path so its owners are held.
        const alive =
          !!captured &&
          captured.value.retiredAt === undefined &&
          captured.value.processId === input.processId &&
          deps.refreshed.has(id) &&
          identities.get(id) === input.reportIdentity &&
          deps.now() - Math.max(captured.value.receivedAt, beats.get(id) ?? 0) <= 45_000;
        if (alive) beats.set(id, deps.now());
        await deps.authenticate(owner, device);
        return alive
          ? { acknowledged: true as const }
          : { acknowledged: false as const, reason: "stale" as const };
      });
    },
  };
}
