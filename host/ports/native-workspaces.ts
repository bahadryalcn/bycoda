import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import type { createManagedWorkspaceRuntime } from "../managed/managed-workspace-runtime";
import type { WorkspaceOwnerAuthorization } from "../workspaces/workspace-service-contracts";
import type { NativeUploadPlatform } from "../domains/native-services/ports";
import type { NativeWorkspaceOwnerActions } from "../domains/native-workspaces/ports";

/** Only composition invokes this inside managed.withOwner. Every operation
 * receives the exact issued object; no copied fields or replacement authority. */
export function bindNativeWorkspaceOwner(
  managed: ReturnType<typeof createManagedWorkspaceRuntime>,
  owner: WorkspaceOwnerAuthorization,
  // The existing workspace composition still passes its retired buffer fence until cleanup.
  _legacyBufferFence?: () => Promise<void>,
): NativeWorkspaceOwnerActions {
  return {
    nativeTurns: {
      begin: (request) => managed.nativeTurns.begin(request, owner),
      end: (request) => managed.nativeTurns.end(request, owner),
    },
    nativeActivity: {
      start: (request) => managed.nativeActivity.start(request, owner),
      end: (request) => managed.nativeActivity.end(request, owner),
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

export const nativeUploadPlatform: NativeUploadPlatform = Object.freeze({
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
