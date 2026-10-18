import { invoke } from "@tauri-apps/api/core";
import type { SshEndpoint } from "./serverInventory";
import type { SshRuntimeConfiguration } from "./sshGroupDefaults";

export type SshRunbook = {
  id: string;
  name: string;
  revision: number;
  script: string;
  shell: "posix" | "powershell";
  targetIds: string[];
  limits: { concurrency: number; timeoutSeconds: number };
  triggers?: {
    startupServerIds: string[];
    intervalMinutes?: number | null;
    nextRunAt?: number | null;
  } | null;
};
export type SshRunbookDraft = Omit<SshRunbook, "limits"> & {
  concurrency: string;
  timeoutSeconds: string;
  intervalMinutes?: string;
};
export type SshRunbookReview = {
  review: { reviewId: string; digest: string; expiresInSeconds: number };
  profile: SshRunbook;
  targets: {
    serverId: string;
    endpoint: SshEndpoint;
    configuration?: SshRuntimeConfiguration | null;
  }[];
};
export type SshRunState = "queued" | "running" | "exited" | "failed" | "cancelled" | "unknown";
export type SshRunStatus = {
  runId: string;
  automationId: string;
  revision: number;
  owner: string;
  digest: string;
  targets: {
    serverId: string;
    state: SshRunState;
    exitCode: number | null;
    reason: string | null;
  }[];
};
export function sshRunbookDraft(profile?: SshRunbook, targetId?: string): SshRunbookDraft {
  return profile
    ? {
        id: profile.id,
        revision: profile.revision,
        name: profile.name,
        script: profile.script,
        shell: profile.shell,
        targetIds: [...profile.targetIds],
        concurrency: String(profile.limits.concurrency),
        timeoutSeconds: String(profile.limits.timeoutSeconds),
        triggers: profile.triggers ? structuredClone(profile.triggers) : undefined,
        intervalMinutes:
          profile.triggers?.intervalMinutes == null ? "" : String(profile.triggers.intervalMinutes),
      }
    : {
        id: crypto.randomUUID(),
        revision: 0,
        name: "",
        script: "",
        shell: "posix",
        targetIds: targetId ? [targetId] : [],
        concurrency: "1",
        timeoutSeconds: "60",
        intervalMinutes: "",
      };
}
export function sshRunbookFromDraft(draft: SshRunbookDraft): SshRunbook | undefined {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const name = draft.name.trim();
  const controls = (value: string, script = false) =>
    [...value].some((char) => {
      const code = char.codePointAt(0)!;
      return (code < 32 && !(script && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
    });
  if (
    !/^[A-Za-z0-9_-]{1,80}$/.test(draft.id) ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 0 ||
    !name ||
    bytes(name) > 200 ||
    controls(name) ||
    !draft.script.trim() ||
    bytes(draft.script) > 65536 ||
    controls(draft.script, true) ||
    /-----BEGIN[^\r\n]*PRIVATE KEY-----/.test(draft.script) ||
    !["posix", "powershell"].includes(draft.shell) ||
    !draft.targetIds.length ||
    draft.targetIds.length > 16 ||
    new Set(draft.targetIds).size !== draft.targetIds.length ||
    draft.targetIds.some((id) => !/^[A-Za-z0-9_:./-]{1,200}$/.test(id)) ||
    !/^[1-4]$/.test(draft.concurrency) ||
    !/^\d+$/.test(draft.timeoutSeconds) ||
    +draft.timeoutSeconds < 1 ||
    +draft.timeoutSeconds > 86400 ||
    (draft.intervalMinutes != null &&
      draft.intervalMinutes !== "" &&
      (!/^\d+$/.test(draft.intervalMinutes) ||
        +draft.intervalMinutes < 1 ||
        +draft.intervalMinutes > 525600)) ||
    (draft.triggers?.startupServerIds ?? []).some(
      (id, index, all) => !draft.targetIds.includes(id) || all.indexOf(id) !== index,
    )
  )
    return undefined;
  return {
    id: draft.id,
    revision: draft.revision,
    name,
    script: draft.script,
    shell: draft.shell,
    targetIds: [...draft.targetIds],
    limits: { concurrency: +draft.concurrency, timeoutSeconds: +draft.timeoutSeconds },
    ...(draft.triggers || draft.intervalMinutes
      ? {
          triggers: {
            startupServerIds: [...(draft.triggers?.startupServerIds ?? [])],
            intervalMinutes: draft.intervalMinutes ? +draft.intervalMinutes : null,
            nextRunAt: draft.triggers?.nextRunAt ?? null,
          },
        }
      : {}),
  };
}
export function sameSshRunbook(
  left: SshRunbook | undefined,
  right: SshRunbook | undefined,
): boolean {
  if (!left || !right) return false;
  const snapshot = (value: SshRunbook) =>
    JSON.stringify([
      value.id,
      value.revision,
      value.name,
      value.script,
      value.shell,
      value.targetIds,
      value.limits.concurrency,
      value.limits.timeoutSeconds,
      value.triggers?.startupServerIds ?? [],
      value.triggers?.intervalMinutes ?? null,
      value.triggers?.nextRunAt ?? null,
    ]);
  return snapshot(left) === snapshot(right);
}
export const sshRunActive = (status: SshRunStatus | undefined) =>
  !!status?.targets.some((target) => target.state === "queued" || target.state === "running");
export const listSshRunbooks = () => invoke<SshRunbook[]>("ssh_runbooks_list");
export const saveSshRunbook = (profile: SshRunbook, expectedRevision: number | null) =>
  invoke<SshRunbook>("ssh_runbook_save", { profile, expectedRevision });
export const removeSshRunbook = (id: string, expectedRevision: number) =>
  invoke<void>("ssh_runbook_remove", { id, expectedRevision });
export const reviewSshRunbook = (
  automationId: string,
  expectedRevision: number,
  intentId?: string,
) =>
  invoke<SshRunbookReview>("ssh_runbook_preview", {
    automationId,
    expectedRevision,
    ...(intentId ? { intentId } : {}),
  });
export const startSshRunbook = (
  automationId: string,
  expectedRevision: number,
  reviewId: string,
  runId: string,
  options?: { intentId?: string; proxyApprovals?: { serverId: string; ticketId: string }[] },
) =>
  invoke<SshRunStatus>("ssh_runbook_start", {
    automationId,
    expectedRevision,
    reviewId,
    runId,
    ...options,
  });
export const statusSshRunbook = (runId: string) =>
  invoke<SshRunStatus>("ssh_runbook_status", { runId });
export const cancelSshRunbook = (runId: string, serverId?: string) =>
  invoke<void>("ssh_runbook_cancel", { runId, ...(serverId ? { serverId } : {}) });

export function sshRunReasonMessage(reason: string): string {
  const labels: Record<string, string> = {
    interrupted_after_restart:
      "Execution status was recovered after restart. Check the target before another run.",
    persistence_failed: "Status could not be saved. Verify remote state before another run.",
    cancelled_before_start: "Cancelled before starting this target.",
    preparation_failed: "SSH setup failed. Review the target configuration.",
    spawn_failed: "SSH could not start. Check local SSH availability.",
    remote_outcome_unknown: "Remote outcome is unknown. Check the target before another run.",
    process_observation_failed: "SSH status was lost. Check the target before another run.",
    cancel_requested_remote_outcome_unknown:
      "Local SSH was stopped. The remote script may still be running.",
    timeout_remote_outcome_unknown:
      "The timeout stopped local SSH. The remote script may still be running.",
  };
  return labels[reason] ?? "Remote outcome is unknown. Check the target before another run.";
}

export type SshRunbookIntent = {
  id: string;
  automationId: string;
  revision: number;
  trigger: "scheduled" | "startup";
  serverId?: string | null;
  createdAt: number;
  status: "pendingReview" | "dismissed" | "consumed";
};
export const pendingSshRunbookIntents = () =>
  invoke<SshRunbookIntent[]>("ssh_runbook_pending_intents");
export const dismissSshRunbookIntent = (intentId: string) =>
  invoke<void>("ssh_runbook_dismiss_intent", { intentId });
export const triggerSshRunbookIntent = (
  automationId: string,
  expectedRevision: number,
  serverId: string,
) =>
  invoke<SshRunbookIntent>("ssh_runbook_trigger_intent", {
    automationId,
    expectedRevision,
    serverId,
  });

export const abandonMissingSshRunbookStart = (
  runId: string,
  automationId: string,
  revision: number,
) => invoke<void>("ssh_runbook_abandon_missing", { runId, automationId, revision });
