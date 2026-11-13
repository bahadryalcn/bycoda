import { t } from "../../../../shared/i18n";
import type { SocialJob, SocialSnapshot } from "../../model/social";
import type { ActionGate } from "../common/DisabledReason";
import type { SocialShellState } from "../shell/screens";
import type { Problem } from "./contentRules";

export type PublishGate = ActionGate & {
  /** Where the owner fixes a closed gate, when it is not in this editor. */
  fix?: "accounts";
};

export type GateInput = {
  snapshot?: SocialSnapshot;
  projectId?: string;
  shell: SocialShellState;
  /** Set when the post cannot be changed here (for example it is already scheduled). */
  locked?: string;
  busy: boolean;
  busyReason?: string;
};

function closed(reason: string): ActionGate {
  return { disabled: true, disabledReason: reason };
}

/** Shared checks for every save: loaded data, a project, a reachable Host, not locked, not busy. */
function commonGate(input: GateInput): ActionGate | undefined {
  if (input.locked) return closed(input.locked);
  if (!input.snapshot) return closed(t("Loading accounts…"));
  if (!input.projectId) return closed(t("Choose a project first."));
  if (!input.shell.hostOnline || input.shell.unreachable)
    return closed(
      t("Scheduling is offline. Scheduled posts and replies wait until the Host is back."),
    );
  if (input.busy) return closed(input.busyReason ?? t("Publishing…"));
  return undefined;
}

/** The one publish action: every problem is shown and the first one is the reason. */
export function publishGate(input: GateInput & { problems: Problem[] }): PublishGate {
  const common = commonGate(input);
  if (common) return common;
  if (!input.snapshot!.sendingEnabled)
    return {
      disabled: true,
      disabledReason: t("Sending is off. Turn it on in Accounts & Settings."),
      fix: "accounts",
    };
  if (input.problems.length) return closed(input.problems[0]!.text);
  return { disabled: false };
}

/** Saving a draft sends nothing, so it needs content and an account but not sending or valid limits. */
export function draftGate(
  input: GateInput & { hasAccounts: boolean; hasContent: boolean },
): ActionGate {
  const common = commonGate(input);
  if (common) return common;
  if (!input.hasAccounts) return closed(t("Choose at least one account."));
  if (!input.hasContent) return closed(t("Write the post or attach media."));
  return { disabled: false };
}

/** Job states that lock a saved post: queued or running, in review, or already sent. Failed and cancelled jobs do not. */
const LOCKING_JOB_STATUSES: ReadonlySet<SocialJob["status"]> = new Set([
  "queued",
  "running",
  "succeeded",
  "review",
]);

/** Whether a saved post has a job that makes it read-only in the editor. */
export function postHasLockingJob(campaignId: string, jobs: SocialJob[]): boolean {
  return jobs.some((job) => job.campaignId === campaignId && LOCKING_JOB_STATUSES.has(job.status));
}
