import { expect, it, vi } from "vitest";
import { AssistantJobBatch, assistantJobDraftIdentity, assistantJobDraftRequest, assistantJobDraftReady,changeAssistantJobDraftKind, assistantJobProjectIds, assistantJobVisible, selectAssistantJobProjects } from "./assistantJobs";
import {AssistantRequestValidationSchema} from "../../../shared/model/host-contracts/assistant";
const rows = [{ id: "row", title: "Review both projects", request: "Owner request", projectId: "a", projectIds: ["a", "b"], idempotencyKey: "key" }];
const automationAction={kind:"automation" as const,projectId:"a",name:"Daily review",prompt:"Summarize local work",harness:"claude" as const,model:"catalog-model",modelSettings:{z:"last",a:"first"},runtimeMode:"supervised" as const,scheduleKind:"daily" as const,minute:0,time:"09:30",dayOfWeek:1,maxRunMinutes:30,maxRunsPerDay:1,isolate:true,enabled:false};
it("requires an explicit model and retains independent project, note and scheduled-automation drafts",()=>{
 const automation=changeAssistantJobDraftKind(rows[0],"automation");expect(assistantJobDraftReady(automation)).toBe(false);expect(automation.quickAction).toMatchObject({model:"",projectId:"a",enabled:false});
 const reviewed={...automation,quickAction:automationAction};const note=changeAssistantJobDraftKind(reviewed,"quick");const project=changeAssistantJobDraftKind(note,"project");
 expect(project.projectIds).toEqual(["a","b"]);expect(changeAssistantJobDraftKind(project,"automation").quickAction).toEqual(automationAction);
 expect(assistantJobDraftReady(reviewed)).toBe(true);const input=assistantJobDraftRequest(reviewed);expect(input).not.toHaveProperty("projectId");expect(input).not.toHaveProperty("projectIds");expect(input).not.toHaveProperty("runNow");expect(input).toMatchObject({kind:"quick",quickAction:{projectId:"a",model:"catalog-model",time:"09:30",isolate:true,enabled:false}});
});
it("never treats automation scopes as global or admits hidden, mismatched and multi-project automation rows",()=>{
 const source={kind:"quick" as const,projectId:"a",projectIds:["a"],quickAction:automationAction};expect(assistantJobVisible(source,id=>id==="a")).toBe(true);
 for(const changed of [source,{...source,projectId:null},{...source,projectIds:[]},{...source,projectIds:["a","b"]},{...source,quickAction:{...automationAction,projectId:"b"}}])expect(assistantJobVisible(changed,()=>false)).toBe(false);
 expect(assistantJobVisible({...source,projectId:null,projectIds:[]},()=>true)).toBe(false);
});
it("inspects an automation's accepted exact receipt after a lost reply without creating or running it twice",async()=>{
 const draft={...rows[0],kind:"quick" as const,projectIds:["a"],quickAction:automationAction};let saved:any;
 const request=vi.fn(async(input:any):Promise<any>=>{if(input.op==="snapshot")return {snapshot:{jobs:saved?[saved]:[]}};saved={...input,id:"saved",projectId:"a",projectIds:["a"],quickResult:{automationId:"actual-row"}};throw new Error("Reply lost");});
 const batch=new AssistantJobBatch(request);await expect(batch.start([draft])).rejects.toThrow("Reply lost");expect(await batch.start([draft])).toHaveLength(1);expect(request.mock.calls.filter(([input])=>input.op==="jobs.create")).toHaveLength(1);
 await expect(batch.start([{...draft,quickAction:{...automationAction,enabled:true}}])).rejects.toThrow("original job requests");
});
it("shows only canonical global quick jobs while rejecting malformed quick or missing project scope",()=>{
 const visible=vi.fn(()=>false);
 expect(assistantJobVisible({kind:"quick",projectId:null,projectIds:[],quickAction:{kind:"note",title:"Note",body:"Body"}},visible)).toBe(true);expect(visible).not.toHaveBeenCalled();
 for(const source of [{kind:"quick",projectId:"a",projectIds:[]},{kind:"quick",projectId:null,projectIds:["a"]},{projectId:null,projectIds:[]}])expect(assistantJobVisible(source as any,visible)).toBe(false);
 expect(assistantJobProjectIds({kind:"quick",projectId:null,projectIds:[]})).toEqual([]);
});
it("reviews normalized quick note content, preserves the verbatim request and never sends project or execution fields",async()=>{
 const row={...rows[0],kind:"quick" as const,request:"  Save this original request verbatim.  ",quickAction:{kind:"note" as const,title:"  Personal note  ",body:"first\r\nsecond"}};
 let saved:any;const request=vi.fn(async(input:any):Promise<any>=>{if(input.op==="snapshot")return{snapshot:{jobs:saved?[saved]:[]}};AssistantRequestValidationSchema.parse(input);expect(input).not.toHaveProperty("projectId");expect(input).not.toHaveProperty("projectIds");saved={...input,id:"quick",projectId:null,projectIds:[],status:"done",quickResult:{noteId:"note"}};return{job:saved};});
 const result=await new AssistantJobBatch(request).start([row]);expect(result[0]).toMatchObject({kind:"quick",request:row.request,quickAction:{kind:"note",title:"Personal note",body:"first\nsecond"}});
 expect(assistantJobDraftRequest(row)).toEqual({op:"jobs.create",kind:"quick",title:row.title,request:row.request,idempotencyKey:row.idempotencyKey,quickAction:{kind:"note",title:"Personal note",body:"first\nsecond"}});
});
it("reconciles a lost quick receipt without recreating a note and freezes both content and original key",async()=>{
 const row={...rows[0],kind:"quick" as const,quickAction:{kind:"note" as const,title:"Note",body:"Original"}};let saved:any;
 const request=vi.fn(async(input:any):Promise<any>=>{if(input.op==="snapshot")return {snapshot:{jobs:saved?[saved]:[]}};saved={...input,id:"quick",projectId:null,projectIds:[],status:"done",quickResult:{noteId:"original-note"}};throw new Error("Lost quick receipt");});const batch=new AssistantJobBatch(request);
 await expect(batch.start([row])).rejects.toThrow("Lost quick receipt");expect((await batch.start([row]))[0]).toMatchObject({quickResult:{noteId:"original-note"}});expect(request.mock.calls.filter(([input])=>input.op==="jobs.create")).toHaveLength(1);
 await expect(batch.start([{...row,quickAction:{...row.quickAction,body:"Changed"}}])).rejects.toThrow("Keep the original");
 const switched=changeAssistantJobDraftKind(changeAssistantJobDraftKind(rows[0],"quick"),"project");expect(switched).toMatchObject({projectId:"a",projectIds:["a","b"]});
});
it("keeps explicit lead and exact array order, preserves legacy identities and rejects invalid saved scope", () => {
  expect(assistantJobProjectIds({ projectId: "a" })).toEqual(["a"]);
  expect(assistantJobProjectIds({ projectId: "a", projectIds: ["b"] })).toEqual([]);
  expect(assistantJobProjectIds({ projectId: "a", projectIds: ["a", "a"] })).toEqual([]);
  expect(selectAssistantJobProjects("b", ["a", "b"])).toEqual({ projectId: "b", projectIds: ["b", "a"] });
  expect(selectAssistantJobProjects("removed", ["b", "a"])).toEqual({ projectId: "b", projectIds: ["b", "a"] });
  expect(assistantJobDraftIdentity(" x ", "a", ["a"])).toBe(JSON.stringify(["x", "a"]));
  expect(assistantJobDraftIdentity("x", "a", ["a", "b"])).not.toBe(assistantJobDraftIdentity("x", "b", ["a", "b"]));
  expect(assistantJobVisible(rows[0], id => id === "a")).toBe(false);
});
it("preserves all projects and the exact receipt on an uncertain retry without creating another job", async () => {
  let saved = false;
  const accepted = { ...rows[0], id: "job", status: "queued" } as any;
  const request = vi.fn(async (input: any): Promise<any> => {
    if (input.op === "snapshot") return { snapshot: { jobs: saved ? [accepted] : [] } };
    saved = true; throw new Error("Acceptance reply lost");
  });
  const batch = new AssistantJobBatch(request);
  await expect(batch.start(rows)).rejects.toThrow("reply lost");
  expect(await batch.start(rows)).toEqual([accepted]);
  expect(request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ projectId: "a", projectIds: ["a", "b"], idempotencyKey: "key" }));
  await expect(batch.start([{ ...rows[0], projectId: "b", projectIds: ["b", "a"] }])).rejects.toThrow("Keep the original");
});
it("checks complete prior receipt scope and prevents invalid or oversized batches before any dispatch", async () => {
  const request = vi.fn(async (): Promise<any> => ({ snapshot: { jobs: [{ ...rows[0], projectIds: ["a"], id: "prior" }] } }));
  await expect(new AssistantJobBatch(request).start(rows)).rejects.toThrow("identity changed");
  const empty = vi.fn();
  await expect(new AssistantJobBatch(empty).start([{ ...rows[0], projectIds: Array.from({ length: 21 }, (_, i) => String(i)) }])).rejects.toThrow("one to twenty");
  expect(empty).not.toHaveBeenCalled();
});
it("retains Room's multiline capacity and treats identical persisted intents as one accepted request",async()=>{
 const request=vi.fn(async(input:any):Promise<any>=>input.op==="snapshot"?{snapshot:{jobs:[]}}:{job:{...input,id:`saved-${input.idempotencyKey}`,status:"queued"}});
 const many=Array.from({length:11},(_,index)=>({...rows[0],id:`row-${index}`,idempotencyKey:`key-${index}`}));
 expect(await new AssistantJobBatch(request).start(many)).toHaveLength(11);
 const duplicate=new AssistantJobBatch(request);expect(await duplicate.start([rows[0],{...rows[0],id:"duplicate-row"}])).toHaveLength(1);
});
