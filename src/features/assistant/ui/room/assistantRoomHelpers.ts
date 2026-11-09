import type { AssistantJob } from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { assistantRequest as ownerRequest } from "../../model/assistantClient";
import type { AssistantGoalApprovalTarget } from "../../model/assistantBriefing";
import { type AssistantJobDraft } from "../../model/assistantJobs";
import { type AssistantJobTasksTarget } from "../../model/assistantJobDeletion";
import type { AssistantAutomationTarget } from "../../model/assistantAutomationReveal";

export const tabs = [
  "Today",
  "Conversations",
  "Jobs",
  "Sessions",
  "Notes",
  "History",
  "Memory",
] as const;
export type View = (typeof tabs)[number];
export type OwnerRequest = typeof ownerRequest;
export type Project = { id?: string; path: string; name: string };
export type AssistantViewProps = {
  initialTab?: Lowercase<View> | "settings";
  navigationToken?: number;
  projectPath?: string;
  sessionId?: string;
  projects?: readonly Project[];
  visibleProjectPaths?: readonly string[];
  /** Only pass an identity captured with the displayed Room source. */
  environmentId?: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onOpenGoal?: (target: AssistantGoalApprovalTarget) => void | Promise<void>;
  onOpenAutomation?: (target: AssistantAutomationTarget) => void | Promise<void>;
  onReviewJobTasks?: (target: AssistantJobTasksTarget) => void | Promise<void>;
  onOpenProject?: (path: string) => void | Promise<void>;
  onClose?: () => void;
};
export const finished = (job: AssistantJob) => ["done", "failed", "cancelled"].includes(job.status);
export function statusLabel(status: AssistantJob["status"]) {
  return t(
    {
      queued: "Queued",
      planning: "Planning",
      running: "Running",
      stalled: "Stalled",
      waiting: "Waiting for you",
      done: "Done",
      failed: "Failed",
      paused: "Paused",
      cancelled: "Cancelled",
    }[status],
  );
}
export function jobStatusLabel(job: AssistantJob) {
  return job.kind === "quick" && job.status === "done"
    ? job.quickAction.kind === "note" && job.quickResult?.noteId
      ? t("Note saved")
      : job.quickAction.kind === "automation" && job.quickResult?.automationId
        ? t("Automation created")
        : statusLabel(job.status)
    : statusLabel(job.status);
}
/** Short date and minute-precision time; seconds only belong in a tooltip (`dateFull`). */
export const date = (at: number) => formatDate(at, { dateStyle: "medium", timeStyle: "short" });
export const dateFull = (at: number) => formatDate(at, { dateStyle: "long", timeStyle: "medium" });
export const matches = (query: string, ...values: (string | undefined)[]) =>
  !query.trim() ||
  values.some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
export type Pending = { key: string; label: string } | null;
export type JobDraft = Omit<AssistantJobDraft, "idempotencyKey" | "projectIds"> & {
  projectIds: string[];
  key: string;
};

export const jobIntentsKey = "bycoda.assistant.job-intents";
/** Null when storage cannot be read; callers then fall back to the in-memory map. */
export function readJobIntents(): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(jobIntentsKey) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return null;
  }
}
/**
 * Read-modify-write of the shared job-intent map: other windows may have added or removed
 * keys since this window last read them, so the mutation applies to the stored map, not to a
 * stale whole-map copy.
 */
export function commitJobIntents(
  memory: { current: Record<string, string> },
  mutate: (intents: Record<string, string>) => void,
) {
  const intents = readJobIntents() ?? { ...memory.current };
  mutate(intents);
  memory.current = intents;
  try {
    localStorage.setItem(jobIntentsKey, JSON.stringify(intents));
  } catch {
    /* Keep the current intent in memory. */
  }
  return intents;
}

export function draftText(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Reviewed rows ready for the start path, with the Host they were frozen on (when frozen). */
export type PreparedJobReview = {
  rows: JobDraft[];
  frozen: boolean;
  environmentId?: string;
};

/** Semantic badge tone per job status: planning and running read as active, waiting as attention. */
export function jobStatusTone(job: AssistantJob) {
  switch (job.status) {
    case "failed":
      return "danger" as const;
    case "done":
      return "success" as const;
    case "waiting":
    case "stalled":
      return "warning" as const;
    case "running":
      return "accent" as const;
    case "planning":
    case "queued":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}
