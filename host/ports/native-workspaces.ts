import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import type { createManagedWorkspaceRuntime } from "../managed-workspace-runtime";
import type { WorkspaceOwnerAuthorization } from "../workspace-service-contracts";
import type {
  NativeBufferUploadPlatform,
  NativeWorkspaceOwnerActions,
} from "../domains/native-workspaces/ports";

/** Only composition invokes this inside managed.withOwner. Every operation
 * receives the exact issued object; no copied fields or replacement authority. */
export function bindNativeWorkspaceOwner(
  managed: ReturnType<typeof createManagedWorkspaceRuntime>,
  owner: WorkspaceOwnerAuthorization,
  beforeBufferEffect: () => Promise<void>,
): NativeWorkspaceOwnerActions {
  const updateBuffers: NonNullable<
    NativeWorkspaceOwnerActions["nativeActivity"]["updateBuffersWithDelivery"]
  > = async (request, delivery) => {
    await beforeBufferEffect();
    return managed.nativeActivity.updateBuffers(request, owner, delivery);
  };
  return {
    nativeTurns: {
      begin: (request) => managed.nativeTurns.begin(request, owner),
      end: (request) => managed.nativeTurns.end(request, owner),
    },
    nativeActivity: {
      start: (request) => managed.nativeActivity.start(request, owner),
      end: (request) => managed.nativeActivity.end(request, owner),
      updateBuffers: async (request) => {
        await beforeBufferEffect();
        return managed.nativeActivity.updateBuffers(request, owner);
      },
      updateBuffersWithDelivery: updateBuffers,
      verifyBufferDelivery: (binding, proof) =>
        managed.nativeActivity.verifyBufferDelivery({ binding, proof }, owner),
      retireBuffers: (request) => managed.nativeActivity.retireBuffers(request, owner),
      reconcileBuffers: (request) => managed.nativeActivity.reconcileBuffers(request, owner),
      listBufferRecovery: (request) => managed.nativeActivity.listBufferRecovery(request, owner),
      readBufferRecovery: (request) => managed.nativeActivity.readBufferRecovery(request, owner),
      bufferRecoveryStatus: (request) =>
        managed.nativeActivity.bufferRecoveryStatus(request, owner),
    },
    nativeRewind: {
      bindTurn: (request) => managed.nativeRewind.bindTurn(request, owner),
      plan: (request) => managed.nativeRewind.plan(request, owner),
      prepare: (request) => managed.nativeRewind.prepare(request, owner),
      apply: (request) => managed.nativeRewind.apply(request, owner),
      status: (request) => managed.nativeRewind.status(request, owner),
      lookup: (request) => managed.nativeRewind.lookup(request, owner),
      cancelPreparation: (request) => managed.nativeRewind.cancelPreparation(request, owner),
      ack: (request) => managed.nativeRewind.ack(request, owner),
    },
    removal: { apply: (request) => managed.removal.apply(request, owner) },
  };
}

export const nativeBufferUploadPlatform: NativeBufferUploadPlatform = Object.freeze({
  sha256: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"),
  decodeBase64: (text: string) => Buffer.from(text, "base64"),
  encodeBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
  decodeUtf8Fatal: (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  scheduleSweep: (action: () => void, intervalMs: number) => {
    const timer = setInterval(action, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  },
});
