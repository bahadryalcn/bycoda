import type {AssistantJob} from "./host-contracts/assistant";

/** Priority changes admission order only, never holds, permission or running work. */
export function compareAssistantJobPriority(left:AssistantJob,right:AssistantJob){
  const rank=(job:AssistantJob)=>job.kind==="quick"?1:({low:0,normal:1,high:2}[job.priority??"normal"]);
  return rank(right)-rank(left)||left.createdAt-right.createdAt||left.id.localeCompare(right.id);
}
