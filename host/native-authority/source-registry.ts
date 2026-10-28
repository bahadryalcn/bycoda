import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema } from "../../src/shared/model/host-contracts/schemas";
import type { HelperWaitOptions, NativeAuthorityHelperClient } from "./helper-client";
import { NativeHelperClientError } from "./helper-client";
import { isHelperAddress } from "./protocol";
import {
  readRetainedSource,
  RetainedSourceError,
  RetainedSourceScopeSchema,
  reserveRetainedSourceTransfer,
  retainedSourceTransferObservation,
  type NativeRetainedSource,
  type RetainedSourceScope,
} from "./retained-source";

/** Trusted deployment selection only; never construct this from an HTTP path/PID. */
export interface NativeSourceHelperProvider {
  open(
    deploymentId: string,
    address: string,
    wait?: HelperWaitOptions,
  ): Promise<{
    client: NativeAuthorityHelperClient;
    expectedSourceProfileId: string;
  }>;
  observation(): { activeHelpers: number };
  close(): Promise<unknown>;
}

export const NativeSourceUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/);
const DeploymentIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/);
export const NativeSourceRegistrationSchema = z
  .object({
    deploymentId: DeploymentIdSchema,
    address: z.string().max(120).refine(isHelperAddress),
    registrationNonce: NativeSourceUuidSchema,
    expectedHostEnvironmentId: IdentifierSchema,
  })
  .strict();
export const NativeSourceLookupSchema = NativeSourceRegistrationSchema.omit({
  address: true,
}).strict();
export const NativeSourceReferenceSchema = z
  .object({
    associationId: NativeSourceUuidSchema,
    sourceEpoch: NativeSourceUuidSchema,
  })
  .strict();
type RegistrationInput = z.infer<typeof NativeSourceRegistrationSchema>;
type Reference = z.infer<typeof NativeSourceReferenceSchema>;
const ActualScopeSchema = z.object({
  environmentId: IdentifierSchema,
  sourceStoreId: IdentifierSchema,
  sourceProfileId: IdentifierSchema,
  sourceEpoch: NativeSourceUuidSchema,
  writerProtocol: SafeCounterSchema.refine((value) => value > 0),
  qualified: z.literal(false),
});
const HelloSchema = ActualScopeSchema.extend({
  version: z.literal(1),
  kind: z.literal("source-hello-result"),
  registrationNonce: NativeSourceUuidSchema,
}).strict();
const StatusSchema = ActualScopeSchema.extend({
  version: z.literal(1),
  kind: z.literal("source-status-result"),
  requestId: SafeCounterSchema.refine((value) => value > 0),
}).strict();
export type NativeSourceAssociation = Readonly<
  z.infer<typeof ActualScopeSchema> & {
    version: 1;
    associationId: string;
  }
>;
export type NativeSourceRetirement = Readonly<
  Reference & { version: 1; retired: true; qualified: false }
>;
export type NativeSourceLookup =
  | { version: 1; state: "pending" | "absent" | "failed"; qualified: false }
  | { version: 1; state: "associated"; association: NativeSourceAssociation; qualified: false };
export class NativeSourceRegistryError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "ENVIRONMENT_CHANGED"
      | "UNAVAILABLE"
      | "CAPACITY"
      | "REPLAY"
      | "SCOPE_CHANGED"
      | "SOURCE_CLOSED"
      | "TRANSPORT_UNKNOWN"
      | "DEADLINE"
      | "SHUTDOWN",
  ) {
    super(`Native source association: ${code}`);
    this.name = "NativeSourceRegistryError";
  }
}
type Source = {
  association: NativeSourceAssociation;
  client: NativeAuthorityHelperClient;
  state: "active" | "retiring" | "closed";
  tail: Promise<void>;
  queued: number;
  nextRequestId: number;
  heartbeat?: NodeJS.Timeout;
  retirement?: Promise<NativeSourceRetirement>;
};
type Registration = {
  input: Readonly<RegistrationInput>;
  promise: Promise<NativeSourceAssociation>;
  state: "pending" | "associated" | "failed";
  client?: NativeAuthorityHelperClient;
  source?: Source;
  association?: NativeSourceAssociation;
  failure?: NativeSourceRegistryError;
  terminalAt?: number;
};
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error("Invalid native source registry limit");
  return result;
}

/** Locator associations only. No actor registration, supported census or authority port. */
export class NativeSourceRegistry {
  readonly environmentId: string;
  private readonly maximum: number;
  private readonly timeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly historyLimit: number;
  private readonly tombstoneMs: number;
  private readonly statusLimit: number;
  private readonly records = new Map<string, Registration>();
  private readonly reservations = new Set<Registration>();
  private readonly addresses = new Map<string, Registration>();
  private readonly associations = new Map<string, Registration>();
  private readonly jobs = new Set<Promise<unknown>>();
  private readonly shutdown = new AbortController();
  private closed = false;
  private closing?: Promise<void>;
  private readonly provider: NativeSourceHelperProvider;

  constructor(options: {
    /** Exclusive ownership, including in-flight/failed-start cleanup on close. */
    provider: NativeSourceHelperProvider;
    environmentId: string;
    maxSources?: number;
    operationTimeoutMs?: number;
    heartbeatMs?: number;
    historyLimit?: number;
    tombstoneMs?: number;
    maxQueuedStatus?: number;
  }) {
    this.provider = options.provider;
    this.environmentId = IdentifierSchema.parse(options.environmentId);
    this.maximum = limit(options.maxSources, 4, 4);
    this.timeoutMs = limit(options.operationTimeoutMs, 5_000, 30_000);
    this.heartbeatMs = limit(options.heartbeatMs, 10_000, 10_000);
    this.historyLimit = limit(options.historyLimit, 256, 256);
    this.tombstoneMs = limit(options.tombstoneMs, 300_000, 300_000);
    this.statusLimit = limit(options.maxQueuedStatus, 8, 8);
  }

  register(raw: RegistrationInput): Promise<NativeSourceAssociation> {
    let input: RegistrationInput;
    try {
      input = NativeSourceRegistrationSchema.parse(raw);
      this.checkEnvironment(input.expectedHostEnvironmentId);
    } catch (error) {
      return Promise.reject(this.classify(error));
    }
    if (this.closed) return Promise.reject(new NativeSourceRegistryError("SHUTDOWN"));
    this.prune();
    const existing = this.records.get(input.registrationNonce);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input))
        return Promise.reject(new NativeSourceRegistryError("REPLAY"));
      if (existing.state === "associated" && existing.client?.observation().exited) {
        this.fail(existing, new NativeSourceRegistryError("SOURCE_CLOSED"));
        if (existing.source) void this.retire(existing).catch(() => {});
      }
      if (existing.state === "failed")
        return Promise.reject(existing.failure ?? new NativeSourceRegistryError("SOURCE_CLOSED"));
      return existing.promise; // Recover a lost ACK without creating a second helper.
    }
    if (this.records.size >= this.historyLimit)
      return Promise.reject(new NativeSourceRegistryError("CAPACITY"));
    let resolve!: (association: NativeSourceAssociation) => void;
    let reject!: (error: NativeSourceRegistryError) => void;
    const promise = new Promise<NativeSourceAssociation>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const record: Registration = { input: Object.freeze(input), promise, state: "pending" };
    this.records.set(input.registrationNonce, record); // Before FS verification, startup or any await.
    if (this.addresses.has(input.address) || this.capacityUsed() >= this.maximum) {
      const error = new NativeSourceRegistryError(
        this.addresses.has(input.address) ? "REPLAY" : "CAPACITY",
      );
      this.fail(record, error);
      record.terminalAt = performance.now();
      reject(error);
      return promise;
    }
    this.reservations.add(record);
    this.addresses.set(input.address, record);
    const job = this.track(this.open(record));
    void job.then(resolve, reject);
    return promise;
  }

  /** Memory-only recovery. Absent is not a domain not-admitted or liveness proof. */
  lookup(raw: z.infer<typeof NativeSourceLookupSchema>): NativeSourceLookup {
    let input: z.infer<typeof NativeSourceLookupSchema>;
    try {
      input = NativeSourceLookupSchema.parse(raw);
      this.checkEnvironment(input.expectedHostEnvironmentId);
    } catch (error) {
      throw this.classify(error);
    }
    const record = this.records.get(input.registrationNonce);
    if (
      !record ||
      (record.terminalAt !== undefined && performance.now() - record.terminalAt >= this.tombstoneMs)
    ) {
      return { version: 1, state: "absent", qualified: false };
    }
    if (record.input.deploymentId !== input.deploymentId)
      throw new NativeSourceRegistryError("SCOPE_CHANGED");
    if (record.state === "associated" && record.association && !record.client?.observation().exited)
      return { version: 1, state: "associated", association: record.association, qualified: false };
    return {
      version: 1,
      state: record.state === "pending" ? "pending" : "failed",
      qualified: false,
    };
  }

  status(raw: Reference): Promise<NativeSourceAssociation> {
    let record: Registration;
    try {
      record = this.reference(raw);
    } catch (error) {
      return Promise.reject(this.classify(error));
    }
    const source = record.source!;
    if (this.closed || source.state !== "active")
      return Promise.reject(new NativeSourceRegistryError("SOURCE_CLOSED"));
    if (source.queued >= this.statusLimit)
      return Promise.reject(new NativeSourceRegistryError("CAPACITY"));
    const deadline = performance.now() + this.timeoutMs;
    clearTimeout(source.heartbeat);
    source.queued += 1;
    const task = source.tail.then(async () => {
      if (source.state === "closed") throw new NativeSourceRegistryError("SOURCE_CLOSED");
      const requestId = source.nextRequestId++;
      if (!Number.isSafeInteger(requestId)) throw new NativeSourceRegistryError("CAPACITY");
      try {
        await source.client.send(
          {
            version: 1,
            kind: "source-status",
            requestId,
            sourceEpoch: source.association.sourceEpoch,
          },
          this.wait(deadline),
        );
        let reply: z.infer<typeof StatusSchema>;
        try {
          reply = StatusSchema.parse(await source.client.receive(this.wait(deadline)));
        } catch (error) {
          throw error instanceof z.ZodError
            ? new NativeSourceRegistryError("SCOPE_CHANGED")
            : error;
        }
        if (
          reply.requestId !== requestId ||
          !this.sameScope(source.association, reply) ||
          source.client.observation().exited
        ) {
          throw new NativeSourceRegistryError("SCOPE_CHANGED");
        }
        return Object.freeze({ ...source.association });
      } catch (error) {
        const failure = this.classify(error);
        this.fail(record, failure);
        source.state = "closed";
        await this.closeClient(source.client);
        throw failure;
      }
    });
    source.tail = task.then(
      () => {},
      () => {},
    );
    const tracked = this.track(
      task.finally(() => {
        source.queued -= 1;
        if (source.queued === 0) this.armHeartbeat(record);
      }),
    );
    void tracked.catch(() => {
      void this.retire(record).catch(() => {});
    });
    return tracked;
  }

  /** Trusted internal read only: no bootstrap/RPC route or migration activation. */
  readRetainedSnapshot(
    raw: Reference,
    rawScope: RetainedSourceScope,
  ): Promise<NativeRetainedSource> {
    let record: Registration;
    let scope: RetainedSourceScope;
    try {
      record = this.reference(raw);
      scope = RetainedSourceScopeSchema.parse(rawScope);
    } catch (error) {
      return Promise.reject(this.classify(error));
    }
    const source = record.source!;
    if (this.closed || source.state !== "active")
      return Promise.reject(new NativeSourceRegistryError("SOURCE_CLOSED"));
    if (source.queued >= this.statusLimit)
      return Promise.reject(new NativeSourceRegistryError("CAPACITY"));
    let release: () => void;
    try {
      release = reserveRetainedSourceTransfer();
    } catch (error) {
      return Promise.reject(this.classify(error));
    }
    const deadline = performance.now() + this.timeoutMs;
    clearTimeout(source.heartbeat);
    source.queued += 1;
    const task = source.tail.then(async () => {
      try {
        const result = await readRetainedSource(source.association, scope, async (command) => {
          if (source.state === "closed") throw new NativeSourceRegistryError("SOURCE_CLOSED");
          const requestId = source.nextRequestId++;
          if (!Number.isSafeInteger(requestId)) throw new NativeSourceRegistryError("CAPACITY");
          await source.client.send(
            { version: 1, ...command, requestId, sourceEpoch: source.association.sourceEpoch },
            this.wait(deadline),
          );
          const value = await source.client.receive(this.wait(deadline));
          if (source.client.observation().exited)
            throw new NativeSourceRegistryError("SOURCE_CLOSED");
          return { requestId, value };
        });
        this.wait(deadline);
        if (source.state === "closed" || source.client.observation().exited)
          throw new NativeSourceRegistryError("SOURCE_CLOSED");
        return result;
      } catch (error) {
        const failure = this.classify(error);
        this.fail(record, failure);
        source.state = "closed";
        await this.closeClient(source.client);
        throw failure;
      }
    });
    source.tail = task.then(
      () => {},
      () => {},
    );
    const tracked = this.track(
      task.finally(() => {
        release(); // Explicit export close, or actual failed helper exit, settled.
        source.queued -= 1;
        if (source.queued === 0) this.armHeartbeat(record);
      }),
    );
    void tracked.catch(() => {
      void this.retire(record).catch(() => {});
    });
    return tracked;
  }

  unregister(raw: Reference): Promise<NativeSourceRetirement> {
    let record: Registration;
    try {
      record = this.reference(raw);
    } catch (error) {
      return Promise.reject(this.classify(error));
    }
    return this.retire(record);
  }

  observation() {
    return {
      qualified: false as const,
      closing: this.closed,
      sources: this.reservations.size,
      acceptedOperations: this.jobs.size,
      chargedSources: this.capacityUsed(),
      activeHelpers: this.provider.observation().activeHelpers,
      ...retainedSourceTransferObservation(),
    };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.shutdown.abort();
    for (const record of this.reservations) {
      if (record.source) {
        clearTimeout(record.source.heartbeat);
        record.source.state = "closed";
      }
    }
    this.closing = (async () => {
      // Provider owns failed-start children that were never exposed as clients.
      const providerResult = await Promise.allSettled([
        this.provider.close(),
        ...[...this.reservations].flatMap((record) =>
          record.client ? [this.closeClient(record.client)] : [],
        ),
      ]);
      while (this.jobs.size) await Promise.allSettled(this.jobs);
      await Promise.all(
        [...this.reservations].flatMap((record) =>
          record.client ? [this.closeClient(record.client)] : [],
        ),
      );
      if (this.provider.observation().activeHelpers)
        throw new NativeSourceRegistryError("TRANSPORT_UNKNOWN");
      for (const record of this.reservations) {
        this.fail(record, new NativeSourceRegistryError("SHUTDOWN"));
        this.release(record);
      }
      const rejected = providerResult.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw this.classify(rejected.reason);
    })();
    return this.closing;
  }

  private async open(record: Registration): Promise<NativeSourceAssociation> {
    const deadline = performance.now() + this.timeoutMs;
    try {
      const opened = await this.provider.open(
        record.input.deploymentId,
        record.input.address,
        this.wait(deadline),
      );
      record.client = opened.client;
      const expectedProfile = IdentifierSchema.parse(opened.expectedSourceProfileId);
      if (this.closed) throw new NativeSourceRegistryError("SHUTDOWN");
      await opened.client.send(
        {
          version: 1,
          kind: "source-hello",
          registrationNonce: record.input.registrationNonce,
          environmentId: this.environmentId,
        },
        this.wait(deadline),
      );
      let hello: z.infer<typeof HelloSchema>;
      try {
        hello = HelloSchema.parse(await opened.client.receive(this.wait(deadline)));
      } catch (error) {
        throw error instanceof z.ZodError ? new NativeSourceRegistryError("SCOPE_CHANGED") : error;
      }
      if (
        hello.registrationNonce !== record.input.registrationNonce ||
        hello.environmentId !== this.environmentId ||
        hello.sourceProfileId !== expectedProfile ||
        opened.client.observation().exited
      )
        throw new NativeSourceRegistryError("SCOPE_CHANGED");
      for (const other of this.records.values()) {
        if (other !== record && other.association?.sourceEpoch === hello.sourceEpoch)
          throw new NativeSourceRegistryError("REPLAY");
      }
      if (this.closed) throw new NativeSourceRegistryError("SHUTDOWN");
      const associationId = randomUUID();
      if (this.associations.has(associationId)) throw new NativeSourceRegistryError("CAPACITY");
      const association: NativeSourceAssociation = Object.freeze({
        version: 1,
        associationId,
        environmentId: hello.environmentId,
        sourceStoreId: hello.sourceStoreId,
        sourceProfileId: hello.sourceProfileId,
        sourceEpoch: hello.sourceEpoch,
        writerProtocol: hello.writerProtocol,
        qualified: false,
      });
      const source: Source = {
        association,
        client: opened.client,
        state: "active",
        tail: Promise.resolve(),
        queued: 0,
        nextRequestId: 1,
      };
      record.source = source;
      record.association = association;
      record.state = "associated";
      this.associations.set(associationId, record);
      void source.client.exited.then(() => {
        if (source.state === "active")
          this.fail(record, new NativeSourceRegistryError("SOURCE_CLOSED"));
        source.state = "closed";
        clearTimeout(source.heartbeat);
        void this.retire(record).catch(() => {});
      });
      this.armHeartbeat(record);
      return association;
    } catch (error) {
      const failure = this.classify(error);
      this.fail(record, failure);
      if (record.client) await this.closeClient(record.client);
      this.release(record);
      throw failure;
    }
  }

  private retire(record: Registration): Promise<NativeSourceRetirement> {
    const source = record.source!;
    if (source.retirement) return source.retirement;
    source.state = source.state === "closed" ? "closed" : "retiring";
    this.fail(record, record.failure ?? new NativeSourceRegistryError("SOURCE_CLOSED"));
    clearTimeout(source.heartbeat);
    source.retirement = this.track(
      (async () => {
        await source.tail;
        await this.closeClient(source.client);
        this.fail(record, record.failure ?? new NativeSourceRegistryError("SOURCE_CLOSED"));
        this.release(record);
        return Object.freeze({
          version: 1 as const,
          associationId: source.association.associationId,
          sourceEpoch: source.association.sourceEpoch,
          retired: true as const,
          qualified: false as const,
        });
      })(),
    );
    return source.retirement;
  }
  private async closeClient(client: NativeAuthorityHelperClient): Promise<void> {
    await client.close({ timeoutMs: this.timeoutMs }).catch(() => {});
    await client.exited; // A close request or failure is not actual exit.
  }
  private armHeartbeat(record: Registration): void {
    const source = record.source!;
    clearTimeout(source.heartbeat);
    if (this.closed || source.state !== "active" || source.queued) return;
    source.heartbeat = setTimeout(() => {
      void this.status({
        associationId: source.association.associationId,
        sourceEpoch: source.association.sourceEpoch,
      }).catch(() => {});
    }, this.heartbeatMs);
    source.heartbeat.unref();
  }
  private reference(raw: Reference): Registration {
    let reference: Reference;
    try {
      reference = NativeSourceReferenceSchema.parse(raw);
    } catch {
      throw new NativeSourceRegistryError("INVALID_REQUEST");
    }
    const record = this.associations.get(reference.associationId);
    if (!record?.source) throw new NativeSourceRegistryError("SOURCE_CLOSED");
    if (record.source.association.sourceEpoch !== reference.sourceEpoch)
      throw new NativeSourceRegistryError("SCOPE_CHANGED");
    return record;
  }
  private capacityUsed(): number {
    let unexposedOrSettling = 0;
    for (const record of this.reservations) {
      if (!record.client || record.client.observation().exited) unexposedOrSettling += 1;
    }
    return this.provider.observation().activeHelpers + unexposedOrSettling;
  }
  private release(record: Registration): void {
    this.reservations.delete(record);
    if (this.addresses.get(record.input.address) === record)
      this.addresses.delete(record.input.address);
    if (record.source) this.associations.delete(record.source.association.associationId);
    record.terminalAt = performance.now();
  }
  private fail(record: Registration, error: NativeSourceRegistryError): void {
    record.state = "failed";
    record.failure ??= error;
    if (record.source) clearTimeout(record.source.heartbeat);
  }
  private wait(deadline: number): HelperWaitOptions {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw new NativeSourceRegistryError("DEADLINE");
    return { timeoutMs: Math.min(remaining, 30_000), signal: this.shutdown.signal };
  }
  private checkEnvironment(environmentId: string): void {
    if (environmentId !== this.environmentId)
      throw new NativeSourceRegistryError("ENVIRONMENT_CHANGED");
  }
  private sameScope(a: NativeSourceAssociation, b: z.infer<typeof ActualScopeSchema>): boolean {
    return (
      a.environmentId === b.environmentId &&
      a.sourceStoreId === b.sourceStoreId &&
      a.sourceProfileId === b.sourceProfileId &&
      a.sourceEpoch === b.sourceEpoch &&
      a.writerProtocol === b.writerProtocol
    );
  }
  private classify(error: unknown): NativeSourceRegistryError {
    if (error instanceof NativeSourceRegistryError) return error;
    if (error instanceof RetainedSourceError)
      return new NativeSourceRegistryError(
        error.code === "CAPACITY" ? "CAPACITY" : "SCOPE_CHANGED",
      );
    if (error instanceof z.ZodError) return new NativeSourceRegistryError("INVALID_REQUEST");
    if (error instanceof NativeHelperClientError)
      return new NativeSourceRegistryError(
        error.code === "DEADLINE" ? "DEADLINE" : "TRANSPORT_UNKNOWN",
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "DEPLOYMENT_UNAVAILABLE"
    )
      return new NativeSourceRegistryError("UNAVAILABLE");
    return new NativeSourceRegistryError("TRANSPORT_UNKNOWN");
  }
  private prune(): void {
    const now = performance.now();
    for (const [nonce, record] of this.records) {
      if (record.terminalAt !== undefined && now - record.terminalAt >= this.tombstoneMs)
        this.records.delete(nonce);
    }
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.jobs.add(promise);
    void promise.then(
      () => this.jobs.delete(promise),
      () => this.jobs.delete(promise),
    );
    return promise;
  }
}
