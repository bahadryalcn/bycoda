import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {HostStore} from "./store";
import {HostTasks} from "./tasks";
import {HostGoals} from "./goals";
import {HostAssistant,type AssistantPorts} from "./assistant/service";
import {assistantExecutionPorts} from "./assistant-runtime";
import {createAssistantChiefContext} from "./assistant-chief-context";
import type {HostEngine} from "./engine";
import type {HostGoal} from "../src/features/tasks/model/hostGoals";
import type {HostTask} from "../src/features/tasks/model/hostTasks";
import type {HostSession} from "../src/features/connections/model/protocol";

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const execution={harness:"codex" as const,model:"fixture-model",modelSettings:{},runtimeMode:"supervised" as const,maxRunMinutes:60};
async function fixture(extra:AssistantPorts={}) {
 const dir=mkdtempSync(join(tmpdir(),"assistant-integration-")),path=join(dir,"host.db");
 const clock={now:Date.now()};
 const engine={command:vi.fn(async()=>{throw new Error("No external engine effects in this fixture");}),updateSession:vi.fn(async()=>{throw new Error("No external engine effects in this fixture");})} as unknown as HostEngine;
 let store:HostStore,tasks:HostTasks,goals:HostGoals,service:HostAssistant;
 async function open(){store=new HostStore(path);await store.ready;tasks=new HostTasks(store,engine,()=>clock.now);goals=new HostGoals(store,engine,tasks,()=>clock.now);await goals.ready;service=new HostAssistant(store,{...assistantExecutionPorts(store,goals,tasks),chiefWake:async()=>({actions:[],tokens:10}),now:()=>clock.now,onError:()=>{},...extra});await service.ready;}
 await open();const project=await store!.addProject(dir,"Fixture");
 const request=(input:unknown)=>service.request(input,"owner");
 const snapshot=async()=>(await request({op:"snapshot"})).snapshot!;
 const configure=async(autonomy:"report"|"jobs"|"chief"="jobs",patch:Record<string,unknown>={})=>request({op:"profile.update",expectedVersion:(await snapshot()).profile.version,patch:{name:"Fixture",setupComplete:true,enabled:true,dailyTokenBudget:100000,autonomy,execution,planApproval:"always",...patch}});
 async function seed(status:HostGoal["status"]="running"){
  await configure("report");const job=(await request({op:"jobs.create",title:"Fixture job",request:"Read fixture state",projectId:project.id,idempotencyKey:`job-${Math.random()}`})).job!;
  const task={...execution,id:`task-${job.id}`,goalId:`assistant-${job.id}`,projectId:project.id,title:"Fixture child",prompt:"Fixture",status:"queued",review:false,repairAttempts:0,createdAt:clock.now,updatedAt:clock.now} as HostTask;
  const goal={...execution,id:`assistant-${job.id}`,title:job.title,prompt:job.request,projectIds:[project.id],leadProjectId:project.id,verifyDefaults:{review:true},approvePlan:true,autoMerge:false,isolate:false,finalReview:false,taskIds:status==="awaiting-approval"?[]:[task.id],status,createdAt:clock.now,updatedAt:clock.now} as HostGoal;
  await saveGoal(goal);await saveTask(task);return{job,goal,task};
 }
 async function saveGoal(goal:HostGoal){await store.db.prepare("INSERT OR REPLACE INTO goals(id,value) VALUES (?,?)").run(goal.id,JSON.stringify(goal));}
 async function saveTask(task:HostTask){await store.db.prepare("INSERT OR REPLACE INTO tasks(id,value) VALUES (?,?)").run(task.id,JSON.stringify(task));}
 async function saveSession(id:string,tokens:number|null=100,status:HostSession["status"]="idle",operationId?:string){
  const prior=await store.find(id);
  return store.save({...prior,projectId:project.id,revision:(prior?.revision??0)+1,status,updatedAt:clock.now,session:{...execution,id,cwd:dir,title:id,blocks:[{id:`block-${id}`,role:"user",text:"Fixture",startedAt:clock.now,durationMs:status==="idle"?1:undefined,...(tokens===null?{}:{turnMetrics:{inputTokens:tokens,outputTokens:0}}),...(operationId?{author:{kind:"assistant" as const,name:"Fixture",reason:"nudge" as const,jobId:"fixture",operationId}}:{})}]}} as HostSession,{});
 }
 async function close(){await service.close();await tasks.close();await store.close();}
 cleanups.push(async()=>{await close();rmSync(dir,{recursive:true,force:true});});
 return{clock,project,engine,get store(){return store;},get tasks(){return tasks;},get goals(){return goals;},get service(){return service;},request,snapshot,configure,seed,saveGoal,saveTask,saveSession,restart:async()=>{await close();await open();},job:async(id:string)=>(await snapshot()).jobs.find(job=>job.id===id)!};
}

it("persists late worker/reviewer identity without progress changes and reconciles actual per-turn metrics once",async()=>{
 const f=await fixture();const {job,goal,task}=await f.seed();
 await f.configure();await f.service.tick();
 expect((await f.job(job.id)).progress).toEqual({done:0,total:1});
 await f.saveSession("worker",200);task.sessionId="worker";await f.saveTask(task);await f.service.tick();
 expect((await f.job(job.id)).sessionIds).toContain("worker");
 expect((await f.store.session("worker")).managedBy).toEqual(expect.objectContaining({assistant:true,jobId:job.id}));
 await f.saveSession("reviewer",50);task.reviewer={sessionId:"reviewer"} as HostTask["reviewer"];await f.saveTask(task);await f.service.tick();
 expect((await f.job(job.id)).sessionIds).toEqual(expect.arrayContaining(["worker","reviewer"]));
 await f.saveSession("planner",75);goal.plannerSessionId="planner";await f.saveGoal(goal);await f.service.tick();
 expect((await f.snapshot()).usage.observedWorkerTokens).toBe(325);
 await f.service.tick();expect((await f.snapshot()).usage.workerTokens).toBe(325);
 await f.saveSession("reviewer",null);await f.service.tick();
 expect((await f.job(job.id)).tokensComplete).toBe(false);expect((await f.snapshot()).usage.workerUsageIncomplete).toBe(true);
});

it("separates reporting, Goal/Task execution and Chief interventions without widening session ownership",async()=>{
 const wake=vi.fn(async()=>({actions:[],tokens:0})),replan=vi.fn(async()=>{}),manage=vi.fn(async()=>{});
 const f=await fixture({chiefWake:wake,replanGoal:replan,manageSession:manage});const {job}=await f.seed("awaiting-approval");
 await f.service.tick();expect((await f.job(job.id)).goalId).toBeUndefined();expect(wake).not.toHaveBeenCalled();
 await f.configure("jobs");await f.service.tick();let current=await f.job(job.id);
 expect(current.goalId).toBe(`assistant-${job.id}`);expect(current.status).toBe("waiting");expect(wake).not.toHaveBeenCalled();expect(await f.service.supervisionAllowed()).toBe(false);
 const nudge={op:"sessions.nudge",jobId:job.id,sessionId:"worker",requestId:"autonomy-nudge",text:"Continue",reason:"nudge"};
 await expect(f.service.request(nudge,"chief")).rejects.toThrow("supervisor grant");await expect(f.service.request({op:"jobs.replan",id:job.id,expectedVersion:current.version,feedback:"Recover"},"chief")).rejects.toThrow("Chief autonomy");
 expect(manage).not.toHaveBeenCalled();expect(replan).not.toHaveBeenCalled();
 await f.configure("chief");await f.service.tick();expect(wake).toHaveBeenCalledOnce();expect(await f.service.supervisionAllowed()).toBe(true);
 await f.service.request(nudge,"chief");expect(manage).toHaveBeenCalledOnce();
 await f.configure("jobs");f.clock.now+=3600000;await f.service.tick();expect(wake).toHaveBeenCalledOnce();await expect(f.service.request({...nudge,requestId:"after-downgrade"},"chief")).rejects.toThrow("supervisor grant");
 for(const autonomy of ["report","jobs","chief"] as const){await f.configure(autonomy);current=await f.job(job.id);await f.request({op:"jobs.replan",id:job.id,expectedVersion:current.version,feedback:"Explicit owner request"});}
 expect(replan).toHaveBeenCalledTimes(3);
});

it("settles a correlated send reservation against observed usage without summing both",async()=>{
 const f=await fixture();const {job,task}=await f.seed();await f.configure("chief");await f.service.tick();
 await f.service.reserveSessionTokens({requestId:"operation:send",jobId:job.id,phase:"send",estimatedTokens:500});
 await f.saveSession("worker",200,"idle","operation");task.sessionId="worker";await f.saveTask(task);await f.service.tick();
 const usage=(await f.snapshot()).usage;expect(usage.observedWorkerTokens).toBe(200);expect(usage.reservedWorkerTokens).toBe(0);expect(usage.workerTokens).toBe(200);
});

it("retains pending event delivery across restart and bounds periodic active-job review",async()=>{
 const wake=vi.fn(async()=>({actions:[],tokens:10}));wake.mockRejectedValueOnce(new Error("Fixture preflight unavailable"));
 const f=await fixture({chiefWake:wake});await f.seed("awaiting-approval");await f.configure("chief");await f.service.tick();expect(wake).toHaveBeenCalledOnce();
 await f.restart();f.clock.now+=61000;await f.service.tick();expect(wake).toHaveBeenCalledTimes(2);
 for(let i=0;i<4;i++)await f.service.tick();expect(wake).toHaveBeenCalledTimes(2);
 f.clock.now+=1800000;await f.service.tick();expect(wake).toHaveBeenCalledTimes(3);
 const activity=(await f.snapshot()).activity;expect(activity.some(event=>event.kind==="chief.woke")).toBe(true);
});

it("keeps a blocked goal recoverable and follows running children while its job is manually paused",async()=>{
 const awake=vi.fn(async(requested:boolean)=>({supported:true,requested,active:requested}));
 const f=await fixture({keepAwake:awake});const {job,goal,task}=await f.seed();task.status="blocked";await f.saveTask(task);
 await f.configure("jobs",{keepAwakeWhileWorking:true});await f.service.tick();expect((await f.job(job.id)).status).toBe("waiting");
 task.status="queued";goal.status="running";await f.saveTask(task);await f.saveGoal(goal);await f.saveSession("worker",100,"running");task.sessionId="worker";await f.saveTask(task);await f.service.tick();
 let current=await f.job(job.id);expect(current.status).toBe("running");
 await f.request({op:"jobs.control",id:job.id,expectedVersion:current.version,action:"pause"});await f.service.tick();
 expect((await f.job(job.id)).status).toBe("paused");expect(awake).toHaveBeenLastCalledWith(true);
 await f.saveSession("worker",100,"idle");await f.service.tick();expect(awake).toHaveBeenLastCalledWith(false);
});

it("recovers the same completed Chief receipt after a core restart without another provider call",async()=>{
 let context:ReturnType<typeof createAssistantChiefContext>;
 const text=vi.fn(async()=>({text:'{"actions":[]}'}));
 const f=await fixture({chiefWake:input=>context.wake(input)});context=createAssistantChiefContext(f.store,text);
 await f.seed("awaiting-approval");await f.configure("chief");await f.service.tick();expect(text).toHaveBeenCalledOnce();
 const row=await f.store.db.prepare("SELECT value FROM assistant_runtime WHERE id='chiefIntent'").get();
 const persisted=JSON.parse(row!.value),intent={...persisted.value,status:"running"};
 await f.store.db.prepare("INSERT OR REPLACE INTO assistant_runtime(id,value,version,updated_at) VALUES(?,?,?,?)").run("chiefPendingIntent",JSON.stringify({...persisted,id:"chiefPendingIntent",value:intent}),1,f.clock.now);
 await f.restart();context=createAssistantChiefContext(f.store,text);await f.service.tick();
 expect(text).toHaveBeenCalledOnce();
 expect(JSON.parse((await f.store.db.prepare("SELECT value FROM assistant_runtime WHERE id='chiefIntent'").get())!.value).value.operationId).toBe(intent.operationId);
});

it("parks uncertain reasoning across restart until a narrow owner retry creates a new review",async()=>{
 const wake=vi.fn(async()=>{throw Object.assign(new Error("Fixture uncertain reasoning"),{code:"ASSISTANT_CHIEF_CONTEXT_UNKNOWN"});});
 const f=await fixture({chiefWake:wake});await f.seed("awaiting-approval");await f.configure("chief");await f.service.tick();expect(wake).toHaveBeenCalledOnce();
 await f.restart();f.clock.now+=3600000;await f.service.tick();expect(wake).toHaveBeenCalledOnce();
 expect((await f.snapshot()).activity.some(event=>event.kind==="chief.contextUnknown")).toBe(true);
 expect((await f.snapshot()).chiefReview?.blocked).toBe(true);
 await expect(f.service.request({op:"chief.retry"},"assistant")).rejects.toThrow("owner");
 await f.request({op:"chief.retry"});expect(wake).toHaveBeenCalledTimes(2);expect((await f.snapshot()).paused).toBe(false);
});

it("refunds a known zero-provider context preflight and parks it until capacity changes without draining daily budget",async()=>{
 let context:ReturnType<typeof createAssistantChiefContext>;
 const text=vi.fn(async()=>({text:'{"actions":[]}'}));
 const f=await fixture({chiefWake:input=>context.wake(input)});context=createAssistantChiefContext(f.store,text);
 await f.seed("awaiting-approval");
 const rule="Owner preference ".repeat(230);
 await f.request({op:"memory.save",kind:"rule",scope:"all",source:"typed",text:rule,quote:rule,active:true,forbiddenTerms:[]});
 await f.configure("chief",{perWakeTokenCap:1000});await f.service.tick();
 expect(text).not.toHaveBeenCalled();let snap=await f.snapshot();expect(snap.usage.chiefTokens).toBe(0);expect(snap.chiefReview?.blocked).toBe(true);
 for(let i=0;i<3;i++){f.clock.now+=3600000;await f.service.tick();}expect((await f.snapshot()).usage.chiefTokens).toBe(0);expect(text).not.toHaveBeenCalled();
 await f.configure("chief",{perWakeTokenCap:8000});await f.service.tick();expect(text).toHaveBeenCalledOnce();expect((await f.snapshot()).chiefReview).toBeUndefined();
});

it("simulates five unattended jobs, actual usage thresholds, restart, and independent owner pause without polling messages",async()=>{
 const wake=vi.fn(async()=>({actions:[],tokens:0}));const f=await fixture({chiefWake:wake});
 f.clock.now=Math.floor(Date.now()/86400000)*86400000+900000;
 const jobs=[];for(let i=0;i<5;i++)jobs.push(await f.seed(i===1?"awaiting-approval":"running"));
 for(const [index,entry] of jobs.entries()){
  await f.saveSession(`night-${index}`,index===0?70000:0);entry.task.sessionId=`night-${index}`;
  if(index===2)entry.task.status="blocked";if(index===3)entry.task.status="done";
  await f.saveTask(entry.task);
 }
 await f.configure("chief");await f.service.tick();
 expect((await f.job(jobs[2].job.id)).status).toBe("waiting");expect((await f.job(jobs[1].job.id)).status).toBe("waiting");expect((await f.job(jobs[3].job.id)).status).toBe("done");
 for(let interval=1;interval<=32;interval++){f.clock.now+=15*60000;await f.service.tick();if(interval===16)await f.restart();}expect(wake.mock.calls.length).toBeLessThanOrEqual(18);
 const calls=wake.mock.calls.length;await f.service.tick();await f.service.tick();expect(wake).toHaveBeenCalledTimes(calls);
 await f.saveSession("night-0",80000);await f.service.tick();expect((await f.snapshot()).usage.mode).toBe("report");
 expect(await f.store.db.prepare("SELECT goal_id FROM task_goal_reason_holds WHERE goal_id=?").get(jobs[0].goal.id)).toBeUndefined();
 await f.saveSession("night-0",100000);await f.service.tick();expect((await f.snapshot()).usage.mode).toBe("paused");
 await expect(f.tasks.startTask(jobs[0].task.id)).rejects.toThrow("goal is paused");
 await f.tasks.setGoalPaused(jobs[0].goal.id,true);f.clock.now+=86400000;await f.service.tick();
 expect((await f.snapshot()).usage.mode).toBe("run");await expect(f.tasks.startTask(jobs[0].task.id)).rejects.toThrow("goal is paused");
 expect((f.engine.command as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
});

it("keeps manual away and DND sticky while automatic idle, lock and failed reads stay separate",async()=>{
 const observation={supported:true,locked:false,idleMs:0};let fails=false;
 const f=await fixture({readPresence:async()=>{if(fails)throw new Error("Fixture presence unavailable");return observation;}});await f.configure();await f.service.tick();
 expect((await f.snapshot()).effectivePresence).toBe("present");
 await f.request({op:"presence.set",state:"away"});f.clock.now+=61000;await f.service.tick();
 expect((await f.snapshot()).presence.state).toBe("away");expect((await f.snapshot()).automaticPresence!.state).toBe("present");expect((await f.snapshot()).effectivePresence).toBe("away");
 await f.request({op:"presence.set",state:"dnd"});observation.locked=true;f.clock.now+=61000;await f.service.tick();
 expect((await f.snapshot()).effectivePresence).toBe("dnd");expect((await f.snapshot()).automaticPresence!.state).toBe("locked");
 await f.request({op:"presence.set",state:"present"});observation.locked=false;observation.idleMs=600000;f.clock.now+=61000;await f.service.tick();expect((await f.snapshot()).effectivePresence).toBe("idle");
 observation.idleMs=3600000;f.clock.now+=61000;await f.service.tick();expect((await f.snapshot()).effectivePresence).toBe("away");
 fails=true;f.clock.now+=61000;await f.service.tick();expect((await f.snapshot()).effectivePresence).toBe("unknown");
 fails=false;observation.idleMs=0;f.clock.now+=61000;await f.service.tick();expect((await f.snapshot()).effectivePresence).toBe("present");
 f.clock.now+=91000;expect((await f.snapshot()).effectivePresence).toBe("unknown");
});

it("persists one return briefing and deferred notifications through restart, quiet hours and owner acknowledgement",async()=>{
 const observation={supported:true,locked:false,idleMs:0};
 const f=await fixture({readPresence:async()=>observation});await f.seed("awaiting-approval");await f.configure("jobs",{quietStart:0,quietEnd:0});await f.service.tick();
 observation.locked=true;f.clock.now+=61000;await f.service.tick();f.clock.now+=31*60000;await f.service.tick();
 observation.locked=false;f.clock.now+=16000;await f.service.tick();
 let snap=await f.snapshot();expect(snap.briefing).not.toBeNull();expect(snap.notifications!.filter(n=>n.kind==="briefing")).toHaveLength(1);expect(snap.notifications!.every(n=>n.eligible)).toBe(true);
 const briefingId=snap.briefing!.id;await f.service.tick();expect((await f.snapshot()).briefing!.id).toBe(briefingId);
 const hour=new Date(f.clock.now).getHours();await f.configure("jobs",{quietStart:hour,quietEnd:(hour+1)%24});
 expect((await f.snapshot()).notifications!.every(n=>n.deferredReason==="quiet")).toBe(true);
 await f.request({op:"presence.set",state:"dnd"});await f.restart();snap=await f.snapshot();expect(snap.notifications!.every(n=>n.deferredReason==="dnd")).toBe(true);
 await expect(f.service.request({op:"notifications.ack",id:briefingId},"assistant")).rejects.toThrow("owner");
 await f.request({op:"notifications.ack",id:briefingId});expect((await f.snapshot()).notifications!.some(n=>n.id===briefingId)).toBe(false);
 await f.restart();expect((await f.snapshot()).notifications!.some(n=>n.id===briefingId)).toBe(false);
});

it("prepares daily summaries once per date while away without treating preparation as delivery",async()=>{
 const f=await fixture({readPresence:async()=>({supported:false,locked:true})});await f.configure();await f.request({op:"presence.set",state:"away"});
 const day=new Date(f.clock.now).toISOString().slice(0,10);
 await f.request({op:"briefing.daily",day});await f.request({op:"briefing.daily",day});
 let notifications=(await f.snapshot()).notifications!;expect(notifications.filter(n=>n.kind==="briefing")).toHaveLength(1);expect(notifications[0].eligible).toBe(false);
 await f.restart();await f.request({op:"briefing.daily",day});notifications=(await f.snapshot()).notifications!;expect(notifications.filter(n=>n.kind==="briefing")).toHaveLength(1);
 await expect(f.service.request({op:"briefing.daily",day},"chief")).rejects.toThrow("owner");await expect(f.request({op:"briefing.daily",day:"2026-99-99"})).rejects.toThrow("calendar");
});
