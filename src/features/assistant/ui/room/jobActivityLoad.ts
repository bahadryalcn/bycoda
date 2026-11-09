import type {
  AssistantActivity,
  AssistantRequest,
  AssistantResponse,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";

export const JOB_ACTIVITY_LIMIT = 50;

/**
 * The per-job log, newest first, through the Room's request helper. A response without the
 * list is a failure, not an empty log: an unconfirmed read must not look like "no activity".
 */
export async function loadJobActivity(
  request: (input: AssistantRequest) => Promise<AssistantResponse>,
  jobId: string,
  limit = JOB_ACTIVITY_LIMIT,
): Promise<AssistantActivity[]> {
  const response = await request({ op: "jobs.activity", id: jobId, limit });
  if (!Array.isArray(response.jobActivity))
    throw new Error(t("Job activity could not be confirmed. Retry."));
  return response.jobActivity;
}
