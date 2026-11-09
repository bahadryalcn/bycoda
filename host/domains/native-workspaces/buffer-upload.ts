import type { NativeBufferUploadPlatform } from "./ports";
import {
  NATIVE_BUFFER_UPLOAD_LIMITS as limits,
  NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS,
  type NativeBufferUploadMethod,
  type NativeBufferUploadStatus,
} from "../../../src/shared/model/host-contracts/native-buffer-upload";
import { NativeBufferUpdateParamsSchema } from "../../../src/shared/model/host-contracts/native-workspaces";
import type { NativeDeliveryIdentity } from "../../../src/shared/model/host-contracts/native-delivery-identity";
import { NativeBufferDeliveryRecordedSchema } from "../../../src/shared/model/host-contracts/native-delivery-identity";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

type Entry = {
  principalId: string;
  status: NativeBufferUploadStatus;
  bytes?: Uint8Array;
  chunks: Map<number, { bytes: number; digest: string }>;
  pending?: Promise<void>;
};

/** Bounded in-process request staging for one existing operation only. A commit
 * owns its exact update promise through settlement; receipt lookup never runs it
 * again. No generic forwarded method, caller-supplied owner, or disk credential. */
export function createNativeBufferUploadService(ports: {
  environmentId: string;
  platform: NativeBufferUploadPlatform;
  update(params: Record<string, unknown>, context: HostDomainContext): Promise<unknown>;
  deliver?(
    identity: NativeDeliveryIdentity,
    paramsJson: string,
    context: HostDomainContext,
  ): Promise<unknown>;
  now?(): number;
}) {
  const entries = new Map<string, Entry>();
  const now = ports.now ?? Date.now;
  let stopped = false;
  const key = (principalId: string, uploadId: string) =>
    JSON.stringify([ports.environmentId, principalId, uploadId]);
  const release = (entry: Entry) => {
    entry.bytes = undefined;
  };
  const snapshot = (entry: Entry) => structuredClone(entry.status);
  const prune = () => {
    for (const [id, entry] of entries) {
      if (entry.status.state !== "committing" && entry.status.expiresAt <= now()) {
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
      code: delivery === "not-sent" ? "invalid-input" : "update-unconfirmed",
    };
    entry.status.expiresAt = now() + limits.ttlMs;
    release(entry);
  };
  function call(
    method: "native.buffers.upload.status",
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeBufferUploadStatus | null>;
  function call(
    method: Exclude<NativeBufferUploadMethod, "native.buffers.upload.status">,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeBufferUploadStatus>;
  function call(
    method: NativeBufferUploadMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ): Promise<NativeBufferUploadStatus | null>;
  async function call(
    method: NativeBufferUploadMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
  ) {
    await assertDomainAuthority(context);
    if (!context.principalId || !context.workspaceOwner) throw new HostDomainAuthorizationError();
    if (stopped) throw new Error("Native buffer upload is unavailable");
    const params = NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].params.parse(raw);
    const principalId = context.principalId;
    prune();
    const id = key(principalId, params.uploadId);
    let entry = entries.get(id);
    if (method === "native.buffers.upload.start") {
      const input = params as {
        uploadId: string;
        byteLength: number;
        sha256: string;
        delivery?: NativeDeliveryIdentity;
      };
      if (
        input.delivery &&
        (input.delivery.byteLength !== input.byteLength || input.delivery.sha256 !== input.sha256)
      )
        throw new Error("Native buffer delivery upload identity changed");
      if (entry) {
        if (
          entry.status.byteLength !== input.byteLength ||
          entry.status.sha256 !== input.sha256 ||
          JSON.stringify(entry.status.delivery) !== JSON.stringify(input.delivery)
        )
          throw new Error("Native buffer upload identity changed");
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
          throw new Error("Native buffer upload capacity is unavailable");
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
      if (method === "native.buffers.upload.status") {
        await assertDomainAuthority(context);
        return null;
      }
      throw new Error("Native buffer upload is unavailable or expired");
    }
    if (!entry) throw new Error("Native buffer upload is unavailable");
    if (method === "native.buffers.upload.write") {
      const input = params as { uploadId: string; offset: number; data: string };
      if (!input.data.length || input.data.length > 4 * Math.ceil(limits.chunkBytes / 3))
        throw new Error("Invalid native buffer upload chunk");
      const bytes = ports.platform.decodeBase64(input.data);
      if (
        !bytes.length ||
        bytes.length > limits.chunkBytes ||
        ports.platform.encodeBase64(bytes) !== input.data
      )
        throw new Error("Invalid native buffer upload chunk");
      const hash = digest(bytes),
        prior = entry.chunks.get(input.offset);
      if (prior) {
        if (prior.bytes !== bytes.length || prior.digest !== hash)
          throw new Error("Native buffer upload chunk changed");
      } else {
        if (entry.status.state !== "receiving" || !entry.bytes)
          throw new Error("Native buffer upload no longer accepts chunks");
        if (
          input.offset !== entry.status.receivedBytes ||
          bytes.length > entry.status.byteLength - input.offset ||
          entry.chunks.size >= limits.maxChunks
        )
          throw new Error("Native buffer upload offset or chunk count is invalid");
        entry.bytes.set(bytes, input.offset);
        entry.chunks.set(input.offset, { bytes: bytes.length, digest: hash });
        entry.status.receivedBytes += bytes.length;
        entry.status.expiresAt = now() + limits.ttlMs;
      }
    } else if (method === "native.buffers.upload.abort" && entry.status.state === "receiving") {
      entry.status.state = "aborted";
      entry.status.expiresAt = now() + limits.ttlMs;
      release(entry);
    } else if (method === "native.buffers.upload.commit") {
      if (entry.status.state === "receiving") {
        if (entry.status.receivedBytes !== entry.status.byteLength)
          throw new Error("Native buffer upload is incomplete");
        let request: Record<string, unknown>, originalJson: string;
        try {
          if (!entry.bytes || digest(entry.bytes) !== entry.status.sha256)
            throw new Error("Digest mismatch");
          originalJson = ports.platform.decodeUtf8Fatal(entry.bytes);
          request = NativeBufferUpdateParamsSchema.parse(JSON.parse(originalJson));
        } catch {
          fail(entry, "not-sent");
          await assertDomainAuthority(context);
          return snapshot(entry);
        }
        entry.status.state = "committing";
        const accepted = entry;
        // The staging allocation remains charged until the actual update settles.
        accepted.pending = (async () => {
          try {
            await assertDomainAuthority(context);
            const result = await (accepted.status.delivery
              ? ports.deliver?.(accepted.status.delivery, originalJson, context)
              : ports.update(request, context));
            const recorded = accepted.status.delivery
              ? NativeBufferDeliveryRecordedSchema.parse(result)
              : undefined;
            if (
              recorded &&
              (recorded.originalId !== accepted.status.delivery?.originalId ||
                recorded.sha256 !== accepted.status.delivery.sha256 ||
                recorded.byteLength !== accepted.status.delivery.byteLength)
            )
              throw new Error("Native buffer delivery receipt identity changed");
            if (
              !recorded &&
              (!result ||
                typeof result !== "object" ||
                !("acknowledged" in result) ||
                result.acknowledged !== true)
            )
              throw new Error("Native buffer update acknowledgement is unavailable");
            await assertDomainAuthority(context);
            accepted.status.state = "completed";
            accepted.status.result = recorded ?? { acknowledged: true };
            accepted.status.expiresAt = now() + limits.ttlMs;
            release(accepted);
          } catch {
            fail(accepted, "unknown");
          }
        })();
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
      await Promise.all([...entries.values()].map((entry) => entry.pending));
      entries.clear();
    },
  };
}
