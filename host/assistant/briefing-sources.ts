import type {HostStore} from "../store";
import type {AssistantJob,AssistantNote} from "../../src/shared/model/host-contracts/assistant";
import type {HostGoal} from "../../src/features/tasks/model/hostGoals";
import type {HostTask} from "../../src/features/tasks/model/hostTasks";
import {legacyUtcDayKey,ownerDayKey} from "../owner-day";
import {assertAssistantGoalProjects} from "../assistant-job-scope";
import {assistantJobProjectIds} from "../../src/shared/model/assistantProjects";

export type BriefingApproval={jobId:string;sessionId:string;title:string;count:number;projectIds:string[]};
/** Read-only, actual current canonical children. A saved job/session array alone is no authority. */
export async function readBriefingApprovals(store:HostStore,jobs:readonly AssistantJob[],limit=12):Promise<{items:BriefingApproval[];complete:boolean}>{
 const items:BriefingApproval[]=[],seen=new Set<string>();let complete=true;
 for(const job of jobs){
  if(job.kind==="quick"||!job.goalId||["done","cancelled","failed"].includes(job.status))continue;
  try{
   const row=await store.db.prepare("SELECT value FROM goals WHERE id=?").get(job.goalId);if(!row){complete=false;continue;}const goal=JSON.parse(row.value) as HostGoal;assertAssistantGoalProjects(job,goal);
   const rows=await store.db.prepare("SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=? ORDER BY id").all(goal.id),tasks=rows.map(row=>JSON.parse(row.value) as HostTask),projectIds=assistantJobProjectIds(job);
   if(tasks.length!==goal.taskIds.length||new Set(goal.taskIds).size!==goal.taskIds.length||tasks.some(task=>!goal.taskIds.includes(task.id)||!projectIds.includes(task.projectId))){complete=false;continue;}
   const sources=[...(goal.plannerSessionId?[{sessionId:goal.plannerSessionId,runId:goal.plannerRunId,projectId:goal.leadProjectId,title:goal.title}]:[]),...(goal.finalAcceptance?.sessionId?[{sessionId:goal.finalAcceptance.sessionId,runId:goal.finalAcceptance.runId,projectId:goal.leadProjectId,title:goal.title}]:[]),...tasks.flatMap(task=>[...(task.sessionId?[{sessionId:task.sessionId,runId:task.runId,projectId:task.projectId,title:task.title}]:[]),...(task.reviewer?.sessionId?[{sessionId:task.reviewer.sessionId,runId:task.reviewer.runId,projectId:task.projectId,title:task.title}]:[])])];
   for(const source of sources){
    if(seen.has(source.sessionId))continue;seen.add(source.sessionId);const record=await store.session(source.sessionId);
    if(!source.runId||record.runId!==source.runId||record.projectId!==source.projectId){complete=false;continue;}
    const count=record.session.blocks.filter(block=>block.approval&&!block.approval.decided).length;
    if(record.status!=="running"){if(count&&record.status==="interrupted")complete=false;continue;}if(!count)continue;
    items.push({jobId:job.id,sessionId:source.sessionId,title:source.title.slice(0,200),count,projectIds});if(items.length>=Math.max(1,Math.min(limit,20)))return{items,complete:false};
   }
  }catch{complete=false;}
 }
 return{items,complete};
}
const localDay=(at:number)=>ownerDayKey(at);
/** Actual daily notes; title date remains valid after an assistant rename. */
export function recentBriefingNotes(notes:readonly AssistantNote[],now:number):AssistantNote[]{
 const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);// Notes titled before owner-day keys used the UTC day; read both for the transition.
 const days=new Set([localDay(now),localDay(yesterday.getTime()),legacyUtcDayKey(now),legacyUtcDayKey(yesterday.getTime())]);
 return notes.filter(note=>note.tags.includes("assistant")&&days.has(note.title.match(/(?:^| · )(\d{4}-\d{2}-\d{2})$/)?.[1]??"")).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,4);
}
export function briefingNoteLines(note:AssistantNote):{text:string;eventIds:string[]}[]{
 return note.body.split(/\r?\n/).filter(line=>line.trim()).slice(-4).map(line=>({text:line.replace(/<!--\s*assistant-event:[^>]+-->/g,"").replace(/\s+/g," ").trim().slice(0,240),eventIds:[...line.matchAll(/<!--\s*assistant-event:([A-Za-z0-9_-]{1,200})\s*-->/g)].map(match=>match[1])}));
}
