import type {AssistantRequest,AssistantResponse} from "../../../shared/model/host-contracts/assistant";
import type {AssistantSessionManagement} from "../../sessions/model/session";
import {assistantRequest} from "./assistantClient";
import {captureAssistantHostRead} from "./assistantHostRead";
import {assistantJobProjectIds} from "./assistantJobs";
import {isProjectLocked} from "../../group-lock/model/groupLock";
export class AssistantSessionDetachError extends Error {
 constructor(message:string,readonly submitted:boolean){super(message);}
}

/** A displayed stamp is provenance. Resolve the current grant on its original Host. */
export async function prepareAssistantSessionDetach(input:{sessionId:string;cwd:string;management:AssistantSessionManagement;environmentId:string;current:()=>boolean}) {
 const guard=()=>{if(!input.current()||isProjectLocked(input.cwd))throw new Error("The original session is no longer available.");};
 guard();const owner=await captureAssistantHostRead(input.environmentId);guard();
 const record=await owner.session(input.sessionId);guard();
 if(record.session.id!==input.sessionId||record.session.cwd!==input.cwd)throw new Error("The original session is no longer available.");
 const projects=await owner.projects();guard();
 const visible=new Set(projects.filter(project=>!isProjectLocked(project.path)).map(project=>project.id));
 if(!visible.has(record.projectId))throw new Error("The original session is no longer available.");
 const request=(value:AssistantRequest):Promise<AssistantResponse>=>{guard();return assistantRequest(value,owner.environmentId);};
 let write:Extract<AssistantRequest,{op:"sessions.detach"}>,detached=false,requiredProjects=[record.projectId];
 if(input.management.jobId){
  const {job}=await request({op:"jobs.get",id:input.management.jobId});guard();
  if(!job||job.kind==="quick"||job.id!==input.management.jobId||job.goalId!==`assistant-${job.id}`||!job.sessionIds.includes(input.sessionId)||!assistantJobProjectIds(job).every(id=>visible.has(id)))throw new Error("The original supervision source changed.");
  detached=job.detachedSessionIds?.includes(input.sessionId)===true;
  requiredProjects=assistantJobProjectIds(job);
  write={op:"sessions.detach",jobId:job.id,sessionId:input.sessionId,expectedVersion:job.version};
 }else{
  const {manual}=await request({op:"manual.list"});guard();
  const grant=manual?.grants.find(grant=>grant.id===input.management.supervisionId&&grant.sessionId===input.sessionId);
  if(!grant||grant.source.projectId!==record.projectId||!visible.has(grant.source.projectId))throw new Error("The original supervision source changed.");
  detached=!grant.active;
  write={op:"sessions.detach",supervisionId:grant.id,sessionId:input.sessionId,expectedVersion:grant.version};
 }
 return Object.freeze({detached,environmentId:owner.environmentId,write:Object.freeze(write),async detach(){
  let submitted=false;
  try{
  guard();const live=await owner.projects();guard();
  const currentlyVisible=new Set(live.filter(project=>!isProjectLocked(project.path)).map(project=>project.id));
  if(!requiredProjects.every(id=>currentlyVisible.has(id)))throw new Error("The original session is no longer available.");
  submitted=true;const result=await request(write);guard();
  if(result.ok!==true)throw new Error("Supervision removal is unconfirmed. Check its status before continuing.");
  }catch(error){throw new AssistantSessionDetachError(error instanceof Error?error.message:String(error),submitted);}
 }});
}
