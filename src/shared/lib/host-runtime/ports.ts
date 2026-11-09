/** Platform owners supply scheduling; this core never creates a physical connection. */
import type {
  BulkDescriptor,
  HostCancellationSignal,
  SubscriptionEvent,
} from "../../model/host-contracts";

export type ManagedHostPhase = "connecting" | "ready" | "retry-wait" | "blocked" | "closed";
export type ManagedHostEvent =
  | {
      kind: "state";
      environmentId: string;
      generation: number;
      phase: ManagedHostPhase;
      category?: string | null;
    }
  | { kind: "subscription"; environmentId: string; generation: number; event: SubscriptionEvent };
export type ManagedHostRequestOptions = {
  requestId: string;
  commandId?: string;
  responseTimeoutMs?: number;
};
/** Credential-free logical operations; the platform owns sockets and every reconnect attempt. */
export interface ManagedHostConnectionPort {
  listen(listener: (event: ManagedHostEvent) => void): Promise<() => void>;
  attach(): Promise<boolean>;
  detach(): Promise<void>;
  request(
    method: string,
    params: unknown,
    options: ManagedHostRequestOptions,
  ): Promise<{ generation: number; result: unknown }>;
  cancel(requestId: string): Promise<void>;
  bulk(descriptor: BulkDescriptor, options?: { responseTimeoutMs?: number }): Promise<unknown>;
}
export type RuntimeRequestOptions = {
  commandId?: string;
  responseTimeoutMs?: number;
  signal?: HostCancellationSignal;
};

export interface RuntimeClock {
  now(): number;
  /** The returned cleanup must be idempotent and must not throw. */
  schedule(delayMs: number, callback: () => void): () => void;
}

export type RuntimeScope = {
  environmentId: string;
  principalId: string;
  /** Changes when authorization/privacy context changes, independently of socket generation. */
  accessEpoch: string;
};

export function requireSafeCounter(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
}

export function requireBoundedKey(value: string, label: string): void {
  if (!value || value.length > 256) throw new Error(`Invalid ${label}`);
}
