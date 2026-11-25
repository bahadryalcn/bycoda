import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  remoteRequest,
} from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import type { ProviderRateLimits, QuotaSource } from "./rateLimits";

const method = "usage.quota.read";

/** An old or unconfigured Host keeps the desktop's existing native adapter. */
export function readHostAccountQuota(
  provider: QuotaSource,
  accountId: string,
  intent: "read" | "refresh" | "approved",
  maxAgeMs?: number,
): Promise<ProviderRateLimits | undefined> | undefined {
  if (isTauri()) return readLocalHostQuota(provider, accountId, intent, maxAgeMs);
}

async function readLocalHostQuota(
  provider: QuotaSource,
  accountId: string,
  intent: "read" | "refresh" | "approved",
  maxAgeMs?: number,
): Promise<ProviderRateLimits | undefined> {
  const machine = (await invoke<RemoteMachine[]>("remote_machines")).find(isLocalSyncMachine);
  if (!machine) return undefined;
  const cached = cachedRemoteCapabilities(machine.environmentId);
  const capabilities = cached?.includes(method)
    ? cached
    : await loadRemoteCapabilities(machine.environmentId);
  if (!capabilities?.includes(method)) return undefined;
  // Once the Host claims quota ownership, a failed read must not launch a second
  // provider request through the desktop adapter.
  return remoteRequest<ProviderRateLimits>(
    machine.id,
    method,
    { provider, accountId, intent, maxAgeMs },
    false,
    false,
    machine.environmentId,
  );
}
