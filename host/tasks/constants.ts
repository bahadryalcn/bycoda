import { DEFAULT_MAX_RUNNING_TASKS } from "../../src/features/tasks/model/hostSettings";
export const TICK_MS = 30000;

export const TASK_HISTORY_RETAINED = 10_000;

/** How many tasks a machine works on at once until its owner changes it. */
export const MAX_RUNNING_TASKS = DEFAULT_MAX_RUNNING_TASKS;

/** How long a task's check command may run. */
export const VERIFY_TIMEOUT_MS = 15 * 60000;

export const VERIFY_OUTPUT_LIMIT = 4000;

export const DIFF_STAT_LIMIT = 2000;

export const RETRY_FEEDBACK_LIMIT = 12000;

export const SHARED_EDITS_LIMIT = 60;

export const MAX_REPAIR_ATTEMPTS = 3;

export const OWNER_NOTICE_LIMIT = 30;

/** Automatic retries of a worker run that failed for a transient runtime reason. */
export const MAX_RUNTIME_RETRIES = 2;

/** Automatic continuations when an unattended worker asks the owner a question. */
export const MAX_QUESTION_CONTINUATIONS = 2;

/** Fresh reviews started because the working copy changed while a reviewer inspected it. */
export const MAX_REVIEW_RERUNS = 2;

export const RUNTIME_RETRY_NOTICE = "runtime-retry:";

export const REVIEW_RERUN_NOTICE = "review-rerun:";

export const QUESTION_NOTICE = "question:";
