import type { NativeUploadPlatform } from "./ports";
import { commitDeadlineElapsed, NATIVE_UPLOAD_COMMIT_LIMITS } from "./upload-commit";
import {
  NATIVE_SERVICE_UPLOAD_LIMITS as limits,
  NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS,
  type NativeServiceUploadMethod,
  type NativeServiceUploadStatus,
} from "../../../src/shared/model/host-contracts/native-service-upload";
import { NATIVE_SERVICES_RPC_SCHEMAS } from "../../../src/shared/model/host-contracts/native-services";
import type { NativeServiceUploadTarget } from "../../../src/shared/model/host-contracts/native-service-upload";
import type { NativeDeliveryIdentity } from "../../../src/shared/model/host-contracts/native-delivery-identity";
import { NativeServiceDeliveryStatusSchema } from "../../../src/shared/model/host-contracts/native-delivery";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

type Entry = {
  principalId: string;
  status: NativeServiceUploadStatus;
  bytes?: Uint8Array;
  chunks: Map<number, { bytes: number; digest: string }>;
  /** Settles when the operation settles or the commit deadline passes; never rejects. */
  pending?: Promise<void>;
  commitDeadlineAt?: number;
  /** The receipt was finalized as unknown while the operation may still be running. */
  held?: boolean;
};

/** Bounded in-process request staging for two finite existing operations only. A commit
 * owns its exact operation promise; receipt lookup never runs it again. A commit that
 * outlives its deadline becomes a final unknown receipt (never success, never replayed)
 * and keeps its bytes and quota charged until the operation settles or the hold ends.
 * No generic forwarded method, caller-supplied owner, or disk credential. */
export function createNativeServiceUploadService(ports: {
  environmentId: string;
  platform: NativeUploadPlatform;
  execute(
    target: NativeServiceUploadTarget,
    params: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<unknown>;
  deliver?(
    target: NativeServiceUploadTarget,
    identity: NativeDeliveryIdentity,
    paramsJson: string,
    context: HostDomainContext,
  ): Promise<unknown>;
  now?(): number;
  commitDeadlineMs?: number;
  commitHoldMs?: number;
}) {
  const entries = new Map<string, Entry>();
  const now = ports.now ?? Date.now;
  const commitDeadlineMs = ports.commitDeadlineMs ?? NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs;
  const commitHoldMs = Math.max(
    ports.commitHoldMs ?? NATIVE_UPLOAD_COMMIT_LIMITS.holdMs,
    limits.ttlMs,
  );
  let stopped = false;
  const key = (principalId: string, uploadId: string) =>
    JSON.stringify([ports.environmentId, principalId, uploadId]);
  const release = (entry: Entry) => {
    entry.bytes = undefined;
  };
  const snapshot = (entry: Entry) => structuredClone(entry.status);
  /** Final unknown receipt for a commit past its deadline. The operation may still be
   * running, so bytes and quota stay charged until it settles or the hold elapses. */
  const expireCommit = (entry: Entry) => {
    if (entry.status.state !== "committing") return;
    entry.status.state = "failed";
    entry.status.outcome = { delivery: "unknown", code: "operation-unconfirmed" };
    entry.status.expiresAt = now() + commitHoldMs;
    entry.held = true;
  };
  /** The operation promise settled: its staging allocation is safe to release. */
  const settled = (entry: Entry) => {
    release(entry);
    if (entry.held) {
      entry.held = false;
      entry.status.expiresAt = now() + limits.ttlMs;
    }
  };
  const prune = () => {
    for (const [id, entry] of entries) {
      if (entry.commitDeadlineAt !== undefined && entry.commitDeadlineAt <= now())
        expireCommit(entry);
      if (entry.status.state !== "committing" && entry.status.expiresAt <= now()) {
        // A held entry past its hold is abandoned; a later settlement only no-ops.
        release(entry);
        entries.delete(id);
      }
    }
  };
  const stopSweep = ports.platform.scheduleSweep(prune, 30_000);
  const digest = ports.platform.sha256;
  const fail = (entry: Entry, delivery: "not-sent" | "unknown") => {
    entry.status.state = "failed";
    entry.status.outcome = {
      delivery,
      code: delivery === "not-sent" ? "invalid-input" : "operation-unconfirmed",
    };
    entry.status.expiresAt = now() + limits.ttlMs;
    release(entry);
  };
  function call(
    method: "native.services.upload.status",
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeServiceUploadStatus | null>;
  function call(
    method: Exclude<NativeServiceUploadMethod, "native.services.upload.status">,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeServiceUploadStatus>;
  function call(
    method: NativeServiceUploadMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeServiceUploadStatus | null>;
  async function call(
    method: NativeServiceUploadMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ) {
    await assertDomainAuthority(context);
    if (!context.principalId || !context.nativeServices) throw new HostDomainAuthorizationError();
    if (stopped) throw new Error("Native service upload is unavailable");
    const params = NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].params.parse(raw);
    const principalId = context.principalId;
    prune();
    const id = key(principalId, params.uploadId);
    let entry = entries.get(id);
    if (method === "native.services.upload.begin") {
      const input = params as {
        uploadId: string;
        target: NativeServiceUploadTarget;
        byteLength: number;
        sha256: string;
        delivery?: NativeDeliveryIdentity;
      };
      if (
        input.delivery &&
        (input.delivery.byteLength !== input.byteLength || input.delivery.sha256 !== input.sha256)
      )
        throw new Error("Native service delivery upload identity changed");
      if (entry) {
        if (
          entry.status.target !== input.target ||
          entry.status.byteLength !== input.byteLength ||
          entry.status.sha256 !== input.sha256 ||
          JSON.stringify(entry.status.delivery) !== JSON.stringify(input.delivery)
        )
          throw new Error("Native service upload identity changed");
      } else {
        const all = [...entries.values()];
        const own = all.filter((value) => value.principalId === principalId);
        const active = all.filter((value) => !!value.bytes);
        const ownedActive = active.filter((value) => value.principalId === principalId);
        const resident = (values: Entry[]) =>
          values.reduce((sum, value) => sum + (value.bytes?.byteLength ?? 0), 0);
        if (
          all.length >= limits.maxRetained ||
          own.length >= limits.maxRetainedPerPrincipal ||
          active.length >= limits.maxActive ||
          ownedActive.length >= limits.maxActivePerPrincipal ||
          resident(active) + input.byteLength > limits.maxResidentBytes ||
          resident(ownedActive) + input.byteLength > limits.maxResidentBytesPerPrincipal
        )
          throw new Error("Native service upload capacity is unavailable");
        entry = {
          principalId,
          bytes: new Uint8Array(input.byteLength),
          chunks: new Map(),
          status: {
            ...input,
            receivedBytes: 0,
            state: "receiving",
            expiresAt: now() + limits.ttlMs,
          },
        };
        entries.set(id, entry);
      }
    } else if (!entry) {
      if (method === "native.services.upload.status") {
        await assertDomainAuthority(context);
        return null;
      }
      throw new Error("Native service upload is unavailable or expired");
    }
    if (!entry) throw new Error("Native service upload is unavailable");
    if (method === "native.services.upload.append") {
      const input = params as { uploadId: string; offset: number; data: string };
      if (!input.data.length || input.data.length > 4 * Math.ceil(limits.chunkBytes / 3))
        throw new Error("Invalid native service upload chunk");
      const bytes = ports.platform.decodeBase64(input.data);
      if (
        !bytes.length ||
        bytes.length > limits.chunkBytes ||
        ports.platform.encodeBase64(bytes) !== input.data
      )
        throw new Error("Invalid native service upload chunk");
      const hash = digest(bytes),
        prior = entry.chunks.get(input.offset);
      if (prior) {
        if (prior.bytes !== bytes.length || prior.digest !== hash)
          throw new Error("Native service upload chunk changed");
      } else {
        if (entry.status.state !== "receiving" || !entry.bytes)
          throw new Error("Native service upload no longer accepts chunks");
        if (
          input.offset !== entry.status.receivedBytes ||
          bytes.length > entry.status.byteLength - input.offset ||
          entry.chunks.size >= limits.maxChunks
        )
          throw new Error("Native service upload offset or chunk count is invalid");
        entry.bytes.set(bytes, input.offset);
        entry.chunks.set(input.offset, { bytes: bytes.length, digest: hash });
        entry.status.receivedBytes += bytes.length;
        entry.status.expiresAt = now() + limits.ttlMs;
      }
    } else if (method === "native.services.upload.cancel" && entry.status.state === "receiving") {
      entry.status.state = "cancelled";
      entry.status.expiresAt = now() + limits.ttlMs;
      release(entry);
    } else if (method === "native.services.upload.commit") {
      if (entry.status.state === "receiving") {
        if (entry.status.receivedBytes !== entry.status.byteLength)
          throw new Error("Native service upload is incomplete");
        let request: Record<string, unknown>, originalJson: string;
        try {
          if (!entry.bytes || digest(entry.bytes) !== entry.status.sha256)
            throw new Error("Digest mismatch");
          originalJson = ports.platform.decodeUtf8Fatal(entry.bytes);
          request = NATIVE_SERVICES_RPC_SCHEMAS[entry.status.target].params.parse(
            JSON.parse(originalJson),
          );
        } catch {
          fail(entry, "not-sent");
          await assertDomainAuthority(context);
          return snapshot(entry);
        }
        entry.status.state = "committing";
        const accepted = entry;
        accepted.commitDeadlineAt = now() + commitDeadlineMs;
        // The staging allocation remains charged until the actual operation settles or,
        // after the deadline, the hold ends. Past the deadline the receipt is unknown.
        const operation = (async () => {
          try {
            await assertDomainAuthority(context);
            // Past the deadline the receipt is already final: never dispatch afterwards.
            if (accepted.status.state !== "committing") return;
            const result = await (accepted.status.delivery
              ? ports.deliver?.(
                  accepted.status.target,
                  accepted.status.delivery,
                  originalJson,
                  context,
                )
              : ports.execute(accepted.status.target, request, context));
            let retained: unknown;
            if (accepted.status.delivery) {
              const recorded = NativeServiceDeliveryStatusSchema.parse(result);
              if (
                recorded.state !== "recorded" ||
                recorded.originalId !== accepted.status.delivery.originalId ||
                recorded.sha256 !== accepted.status.delivery.sha256 ||
                recorded.byteLength !== accepted.status.delivery.byteLength ||
                recorded.target !== accepted.status.target
              )
                throw new Error("Native service delivery receipt remains unknown or changed");
              retained = recorded;
            } else
              retained = NATIVE_SERVICES_RPC_SCHEMAS[accepted.status.target].result.parse(
                JSON.parse(JSON.stringify(result ?? null)),
              );
            await assertDomainAuthority(context);
            // A late success never rewrites an unknown receipt into a completed one.
            if (accepted.status.state !== "committing") return;
            accepted.status.state = "completed";
            accepted.status.result = JSON.parse(JSON.stringify(retained));
            accepted.status.expiresAt = now() + limits.ttlMs;
          } catch {
            if (accepted.status.state === "committing") fail(accepted, "unknown");
          } finally {
            settled(accepted);
          }
        })();
        accepted.pending = commitDeadlineElapsed(operation, commitDeadlineMs).then((elapsed) => {
          if (elapsed) expireCommit(accepted);
        });
      }
      await entry.pending;
    }
    await assertDomainAuthority(context);
    return snapshot(entry);
  }
  return {
    call,
    async close() {
      stopped = true;
      stopSweep();
      // Every pending commit is bounded by its deadline, so shutdown cannot hang.
      await Promise.all([...entries.values()].map((entry) => entry.pending));
      for (const entry of entries.values()) release(entry);
      entries.clear();
    },
  };
}
