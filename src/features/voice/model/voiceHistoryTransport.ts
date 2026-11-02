import {hostToolRequest} from "../../connections/model/hostFeatureClient";
import {knownRemoteMachine,remoteMachineFor,remoteRequest,remoteSessionFor} from "../../connections/model/connections";
import {hostSessionBinding} from "../../connections/model/sessionExecutionBinding";
import type {Session} from "../../sessions/model/session";
import {parseRemotePath,remotePath,remoteProjectFor} from "../../connections/model/remoteProjects";
import {pathKey} from "../../../shared/lib/paths";
import {AssistantResponseValidationSchema,type AssistantRequest,type AssistantResponse} from "../../../shared/model/host-contracts/assistant";
import type {RemoteMachine} from "../../connections/model/protocol";
import {captureAssistantHostRead} from "../../assistant/model/assistantHostRead";

export type VoiceHistoryRequest=(request:AssistantRequest)=>Promise<AssistantResponse>;
export type VoiceHistoryTransport={key:string;remote:boolean;request:VoiceHistoryRequest;environmentId?:()=>Promise<string>};
/** Freeze the first verified local environment for this binding, including later retries. */
export function captureLocalVoiceHistory():VoiceHistoryTransport{
 let captured:ReturnType<typeof captureAssistantHostRead>|undefined;
 const owner=()=>captured??=(captureAssistantHostRead().catch(error=>{captured=undefined;throw error;}));
 return{key:"local",remote:false,environmentId:async()=>(await owner()).environmentId,request:async input=>{
  const expected=(await owner()).environmentId;
  return AssistantResponseValidationSchema.parse(await hostToolRequest("","assistant.v1","assistant.request",input,{kind:"local"},expected));
 }};
}
type Ports={
  known:typeof knownRemoteMachine;machine:typeof remoteMachineFor;project:typeof remoteProjectFor;
  describe:(machineId:string,environmentId:string)=>Promise<{environmentId:string;capabilities:string[]}>;
  request:(machineId:string,environmentId:string,input:AssistantRequest)=>Promise<AssistantResponse>;
};
const defaults:Ports={
  known:knownRemoteMachine,machine:remoteMachineFor,project:remoteProjectFor,
  describe:(machineId,environmentId)=>remoteRequest(machineId,"environment.describe",{},false,false,environmentId),
  request:async(machineId,environmentId,input)=>AssistantResponseValidationSchema.parse(await hostToolRequest("","assistant.v1","assistant.request",input,{kind:"machine",machineId},environmentId)),
};
/** A display shell/native conversation ID is not a Host session association. */
export function captureVoiceHistorySession(session:Pick<Session,"id"|"hostBinding">|undefined,projectPath:string,global=false):string|undefined{
  if(!session)return;
  if(projectPath.startsWith("remote://"))return global?undefined:remoteSessionFor(session.id);
  try{const binding=hostSessionBinding(session);return binding?.created?binding.sessionId:undefined;}catch{return;}
}

/** A finite history port. It never routes remote data through the local Room cache
 * and never creates/registers a project to make a missing history target succeed. */
export function captureRemoteVoiceHistory(projectPath:string,ports:Ports=defaults):VoiceHistoryTransport{
  const parsed=parseRemotePath(projectPath);if(!parsed)throw new Error("The remote conversation project is invalid.");
  const environmentId=parsed.environmentId,hostPath=parsed.hostPath;
  const remembered=ports.project(projectPath),saved=remembered?structuredClone(remembered):undefined;
  if(saved&&(saved.environmentId!==environmentId||pathKey(saved.cwd)!==pathKey(hostPath)))throw new Error("The remote conversation project changed.");
  let machine:RemoteMachine|undefined;const known=ports.known(environmentId);if(known)machine=structuredClone(known);
  let projectId=saved?.projectId,threadId:string|undefined;
  const key=`remote:${environmentId}:${machine?.id??"unresolved"}:${projectId??"unresolved"}:${pathKey(hostPath)}`;
  async function verify(){
    if(!machine){const found=await ports.machine(environmentId);if(!found)throw new Error("The captured remote Host is unavailable. Reconnect it and retry.");machine=structuredClone(found);}
    if(machine.environmentId!==environmentId)throw new Error("The captured remote Host changed.");
    const descriptor=await ports.describe(machine.id,environmentId);
    if(descriptor?.environmentId!==environmentId||!Array.isArray(descriptor.capabilities)||!descriptor.capabilities.includes("assistant.v1"))throw new Error("The selected remote Host does not provide compatible conversation history.");
    const listed=await ports.request(machine.id,environmentId,{op:"projects.list"});
    const matches=listed.projects?.filter(project=>pathKey(project.path)===pathKey(hostPath))??[];
    const project=projectId?matches.find(value=>value.id===projectId):matches.length===1?matches[0]:undefined;
    if(!project)throw new Error("The remote project could not be verified for conversation history.");
    projectId??=project.id;
    return {machineId:machine.id,project};
  }
  return {key,remote:true,environmentId:async()=>environmentId,request:async(input)=>{
    if(!["projects.list","threads.open","threads.messages","threads.append"].includes(input.op))throw new Error("This remote voice route only stores its captured conversation history.");
    const {machineId,project}=await verify();
    if(input.op==="projects.list")return {projects:[{...project,path:remotePath(environmentId,project.path)}]};
    if(input.op==="threads.open"){
      if(input.projectId!==project.id)throw new Error("The remote conversation project changed.");
      const result=await ports.request(machineId,environmentId,input);
      if(!result.thread||result.thread.projectId!==project.id||threadId&&result.thread.id!==threadId)throw new Error("The remote conversation identity changed. Its original writes remain pending.");
      threadId??=result.thread.id;return result;
    }
    if(!("threadId" in input)||!threadId||input.threadId!==threadId)throw new Error("The remote voice history request targets another conversation.");
    const result=await ports.request(machineId,environmentId,input);
    if(result.messages?.some(message=>message.threadId!==threadId)||result.message&&result.message.threadId!==threadId)throw new Error("The remote conversation response belongs to another thread.");
    return result;
  }};
}
