import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import { t } from "../../../shared/i18n";

/** Every send reads this policy; a short memory avoids two Host round trips per message. */
const POLICY_TTL_MS = 30_000;
let cached: { enabled: boolean; at: number } | undefined;
let inflight: Promise<boolean> | undefined;
/** Bumped by every save and invalidation; a read started before one must not write its stale answer. */
let version = 0;

function invalidateExactGitRewindCache(): void {
  version += 1;
  cached = undefined;
  inflight = undefined;
}

if (typeof window !== "undefined")
  window.addEventListener("bycoda:remote-machines", invalidateExactGitRewindCache);

/** Test seam. */
export const resetExactGitRewindCache = invalidateExactGitRewindCache;

/** Execution-host policy, shared by native turns and Host-owned turns. */
async function exactGitRewindRequest(enabled?: boolean): Promise<boolean> {
  if (enabled !== undefined) {
    // A save supersedes any lookup that started before it.
    version += 1;
    inflight = undefined;
  }
  const startedAt = version;
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error(t("The local Host is unavailable. Reconnect and retry."));
  const response = await remoteRequest<{ enabled: boolean }>(
    machine.id,
    enabled === undefined ? "workspaces.exactGitRewind.get" : "workspaces.exactGitRewind.set",
    enabled === undefined ? {} : { enabled },
  );
  if (typeof response?.enabled !== "boolean")
    throw new Error(t("The local Host returned an invalid setting. Reconnect and retry."));
  if (enabled !== undefined) version += 1;
  if (enabled !== undefined || version === startedAt)
    cached = { enabled: response.enabled, at: Date.now() };
  return response.enabled;
}

/** Settings surfaces retain read failures so an unavailable policy is never shown as saved. */
export const loadExactGitRewind = () => exactGitRewindRequest();
export const saveExactGitRewind = (enabled: boolean) => exactGitRewindRequest(enabled);

/** Bound for the send-path lookup; a slow Host must not hold up Send. */
const POLICY_WAIT_MS = 3_000;

/** An unavailable experimental feature must never block ordinary worktree execution. */
export async function getExactGitRewindEnabled(): Promise<boolean> {
  if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.enabled;
  // Concurrent sends share one lookup. Failures are never kept, so the next
  // send asks the Host again.
  const request = (inflight ??= loadExactGitRewind()
    .catch(() => false)
    .finally(() => {
      if (inflight === request) inflight = undefined;
    }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), POLICY_WAIT_MS);
  });
  try {
    const answer = await Promise.race([request, slow]);
    if (answer !== "slow") return answer;
    // The lookup keeps running and still fills the cache if no save happened meanwhile.
    console.warn("[workspaces] exact Git rewind policy is slow; using the last known value");
    return cached?.enabled ?? false;
  } finally {
    clearTimeout(timer);
  }
}
