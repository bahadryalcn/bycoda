import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HostStore} from "./store";
import {HostAssistant,type AssistantPorts,type AssistantUsageTurn} from "./assistant/service";
import {AssistantRequestValidationSchema,AssistantResponseValidationSchema} from "../src/shared/model/host-contracts/assistant";
import {assistantCacheUsage} from "./assistant-cache-usage";

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(ports:AssistantPorts={}){
 const dir=mkdtempSync(join(tmpdir(),"assistant-priority-cache-")),path=join(dir,"host.db");
 let store=new HostStore(path);await store.ready;
 const create=()=>new HostAssistant(store,{listProjects:async()=>[{id:"p",path:dir,name:"Project"}],...ports});
 let service=create();await service.ready;
 const request=(input:unknown,principal:"owner"|"assistant"|"chief"="owner")=>service.request(input,principal);
 const configure=async(autonomy:"report"|"jobs"="report")=>{
  const profile=(await request({op:"snapshot"})).snapshot!.profile;
  await request({op:"profile.update",expectedVersion:profile.version,patch:{name:"Owner assistant",enabled:true,setupComplete:true,autonomy,dailyTokenBudget:1000000,activeStart:0,activeEnd:0,execution:{harness:"codex",model:"fixture",modelSettings:{},runtimeMode:"supervised",maxRunMinutes:30}}});
 };
 cleanups.push(async()=>{await service.close();await store.close();rmSync(dir,{recursive:true,force:true});});
 return {request,configure,create:async(key:string)=>(await request({op:"jobs.create",projectId:"p",title:key,request:key,idempotencyKey:key})).job!,
  restart:async()=>{await service.close();await store.close();store=new HostStore(path);await store.ready;service=create();await service.ready;}};
}

it("persists owner priority with exact-version admission order across restart and preserves pause",async()=>{
 const dispatched:string[]=[];
 const f=await fixture({controlGoal:async()=>{},createGoal:async({job})=>{dispatched.push(job.title);return{goalId:`assistant-${job.id}`};}});
 await f.configure();
 const low=await f.create("low"),normal=await f.create("normal"),high=await f.create("high"),paused=await f.create("paused");
 const update=(job:typeof low,priority:string,principal:"owner"|"assistant"|"chief"="owner")=>f.request({op:"jobs.priority",id:job.id,expectedVersion:job.version,priority},principal);
 await expect(update(high,"high","chief")).rejects.toThrow();await expect(update(high,"high","assistant")).rejects.toThrow();
 const changed=(await update(high,"high")).job!;expect(changed.version).toBe(high.version+1);
 await expect(update(high,"low")).rejects.toThrow("Job changed");await update(low,"low");await update(paused,"high");
 const fresh=(await f.request({op:"jobs.get",id:paused.id})).job!;
 await f.request({op:"jobs.control",id:fresh.id,expectedVersion:fresh.version,action:"pause"});
 await f.restart();expect((await f.request({op:"jobs.get",id:high.id})).job).toMatchObject({priority:"high"});
 expect((await f.request({op:"jobs.get",id:normal.id})).job).not.toHaveProperty("priority");
 await f.configure("jobs");await f.request({op:"tick"});
 expect(dispatched).toEqual(["high","normal","low"]);
 expect((await f.request({op:"jobs.get",id:paused.id})).job).toMatchObject({status:"paused",priority:"high"});
 const active=(await f.request({op:"jobs.get",id:normal.id})).job!;
 const stopped=(await f.request({op:"jobs.control",id:active.id,expectedVersion:active.version,action:"stop"})).job!;
 await expect(update(stopped,"high")).rejects.toThrow("finished job");
});

it("reports durable actual cache measurements without duplicating polls or continuation turns",async()=>{
 const at=Date.UTC(2026,10,2,12);let now=at;
 let turns:AssistantUsageTurn[]=[{key:"session:root",tokens:200,at,settled:true,cacheMetrics:{cacheReadTokens:100,cacheHitPercent:50}},{key:"session:missing",tokens:20,at,settled:true}];
 let incomplete=false;
 const f=await fixture({now:()=>now,createGoal:async({job})=>({goalId:`assistant-${job.id}`}),goalStatus:async()=>({status:"running",taskIds:[],sessionIds:[],progress:{done:0,total:1},usageTurns:turns,usageIncomplete:incomplete,tokens:220,tokensComplete:false})});
 await f.configure("jobs");await f.create("measured worker");
 const usage=async()=>(await f.request({op:"snapshot"})).snapshot!.usage;
 expect((await usage()).cacheUsage).toEqual({scope:"worker-turns",measuredTurns:1,totalTurns:2,percentageTurns:1,cacheReadTokens:100,cacheHitPercent:50,complete:false});
 await f.request({op:"tick"});await f.restart();await f.request({op:"tick"});expect((await usage()).cacheUsage?.cacheReadTokens).toBe(100);
 turns=[{...turns[0],cacheMetrics:{cacheReadTokens:140,cacheHitPercent:70}},{...turns[1],cacheMetrics:{cacheReadTokens:0,cacheHitPercent:0}}];
 await f.request({op:"tick"});expect((await usage()).cacheUsage).toEqual({scope:"worker-turns",measuredTurns:2,totalTurns:2,percentageTurns:2,cacheReadTokens:140,cacheHitPercent:35,complete:true});
 expect((await usage()).workerTokens).toBe(220);expect((await usage()).cacheUsage).not.toHaveProperty("cacheWriteTokens");
 const response=await f.request({op:"snapshot"});expect(AssistantResponseValidationSchema.safeParse(response).success).toBe(true);
 expect(AssistantResponseValidationSchema.safeParse({...response,snapshot:{...response.snapshot,usage:{...response.snapshot!.usage,cacheUsage:{...response.snapshot!.usage.cacheUsage,cacheHitPercent:101}}}}).success).toBe(false);
 incomplete=true;await f.request({op:"tick"});expect((await usage()).cacheUsage?.complete).toBe(false);
 now+=86400000;await f.request({op:"tick"});expect((await usage()).cacheUsage).toBeUndefined();
});

it("omits absent and unknown-day cache measurements and never invents a zero rate",()=>{
 expect(assistantCacheUsage([{settled:true}],false)).toBeUndefined();
 expect(assistantCacheUsage([{settled:true,cacheMetrics:{cacheReadTokens:90},cacheTimeKnown:false}],false)).toBeUndefined();
 expect(assistantCacheUsage([{settled:false,cacheTimeKnown:true,cacheMetrics:{cacheWriteTokens:20}}],false)).toEqual({scope:"worker-turns",measuredTurns:1,totalTurns:1,percentageTurns:0,cacheWriteTokens:20,complete:false});
});

it("keeps cache fields and source-bound withdrawal strict at the public boundary",()=>{
 expect(AssistantRequestValidationSchema.safeParse({op:"jobs.priority",id:"job",expectedVersion:1,priority:"urgent"}).success).toBe(false);
 expect(AssistantRequestValidationSchema.safeParse({op:"sessions.detach",sessionId:"s",expectedVersion:1}).success).toBe(false);
 expect(AssistantRequestValidationSchema.safeParse({op:"sessions.detach",sessionId:"s",jobId:"j",supervisionId:"m",expectedVersion:1}).success).toBe(false);
 expect(AssistantRequestValidationSchema.safeParse({op:"sessions.detach",sessionId:"s",jobId:"j",expectedVersion:1,approved:true}).success).toBe(false);
});

it("requires an owner and the exact linked source before dispatching session withdrawal",async()=>{
 const detached=vi.fn(async()=>({detached:true as const}));
 const f=await fixture({detachSession:detached,createGoal:async({job})=>({goalId:`assistant-${job.id}`}),goalStatus:async()=>({status:"running",taskIds:["task"],sessionIds:["worker"],progress:{done:0,total:1},tokensComplete:false})});
 await f.configure("jobs");const created=await f.create("job");const job=(await f.request({op:"jobs.get",id:created.id})).job!;
 const input={op:"sessions.detach",sessionId:"worker",jobId:job.id,expectedVersion:job.version};
 await expect(f.request(input,"chief")).rejects.toThrow();await expect(f.request({...input,sessionId:"foreign"})).rejects.toThrow("source changed");
 await expect(f.request({...input,expectedVersion:job.version-1})).rejects.toThrow("source changed");expect(detached).not.toHaveBeenCalled();
 expect(await f.request(input)).toEqual({ok:true});expect(detached).toHaveBeenCalledExactlyOnceWith({sessionId:"worker",jobId:job.id,expectedVersion:job.version});
 expect((await f.request({op:"jobs.get",id:job.id})).job).toMatchObject({status:"running",sessionIds:["worker"]});
});
