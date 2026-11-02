import type {AssistantJob,AssistantJobDeleteReview} from "../../../shared/model/host-contracts/assistant";
import {sameAssistantProjectSet} from "../../../shared/model/assistantProjects";
import {assistantJobProjectIds,assistantJobVisible} from "./assistantJobs";
export type AssistantJobTasksTarget={jobId:string;goalId:string;projectId:string;projectIds:string[];environmentId:string};
/** A model's task IDs or the visible summary cannot substitute for a canonical deletion review. */
export function verifiedAssistantJobDeleteReview(job:AssistantJob,review:AssistantJobDeleteReview|undefined,visible:(id:string)=>boolean):AssistantJobDeleteReview|undefined{
 if(job.kind==="quick"||!job.goalId||!review||review.jobId!==job.id||review.jobVersion!==job.version||review.goalId!==job.goalId||!/^[a-f0-9]{64}$/.test(review.sourceToken)||!assistantJobVisible(job,visible)||!sameAssistantProjectSet(review.projectIds,assistantJobProjectIds(job))||!review.projectIds.every(visible)||new Set(review.tasks.map(task=>task.id)).size!==review.tasks.length||review.tasks.some(task=>!task.id||!review.projectIds.includes(task.projectId)||!visible(task.projectId)))return;
 return structuredClone(review);
}
