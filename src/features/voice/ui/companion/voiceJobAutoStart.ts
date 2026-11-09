import type { VoiceJobDraft } from "../../model/voiceJobs";

/**
 * Whether proposed jobs wait for the owner's review. Review is shown only when the profile
 * asks for it (`confirmJobs` true). Otherwise jobs start directly, unless a draft is incomplete
 * or uses a quick kind this Host does not offer; then the review shows the missing input.
 */
export function voiceJobsNeedReview(
  jobs: readonly VoiceJobDraft[],
  capabilities: { quickNotes: boolean; quickAutomations: boolean },
  confirmJobs: boolean | undefined,
  isReady: (row: VoiceJobDraft) => boolean,
): boolean {
  if (confirmJobs === true) return true;
  return !jobs.every(
    (row) =>
      isReady(row) &&
      (row.kind !== "quick"
        ? true
        : row.quickAction?.kind === "automation"
          ? capabilities.quickAutomations
          : capabilities.quickNotes),
  );
}
