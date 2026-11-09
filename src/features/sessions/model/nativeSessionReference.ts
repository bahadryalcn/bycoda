import { invoke } from "@tauri-apps/api/core";
import type { LocalSessionLocator } from "./localSessionReference";

export interface NativeSessionReferenceMetadata {
  locator: LocalSessionLocator;
  title: string;
  cwd: string;
  archived: boolean;
  updatedAt: number;
}

/** Resolves only a stored row; never constructs an origin from renderer state. */
export async function nativeSessionReference(
  sessionId: string,
): Promise<LocalSessionLocator | null> {
  const metadata = await invoke<NativeSessionReferenceMetadata | null>("session_reference_get", {
    sessionId,
  });
  return metadata?.locator ?? null;
}

/** Native validates the current store/profile before returning any row metadata. */
export function resolveNativeSessionReference(
  locator: Extract<LocalSessionLocator, { kind: "native" }>,
): Promise<NativeSessionReferenceMetadata | null> {
  return invoke("session_reference_resolve", {
    sourceStoreId: locator.sourceStoreId,
    sourceProfileId: locator.sourceProfileId,
    sessionId: locator.sessionId,
  });
}
