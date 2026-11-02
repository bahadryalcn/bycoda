import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,realpathSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {HostStore} from "../store";
import {HostEngine} from "../engine";
import {HostTasks} from "../tasks";
import {HostGoals} from "../goals";
import {HostAssistant} from "./service";
import {AssistantRepository} from "./repository";
import {assistantExecutionPorts} from "../assistant-runtime";
import {assistantDomain} from "../assistant-domain";
import {assistantActiveHours,DEFAULT_ASSISTANT_POLICY} from "../../src/shared/model/assistantPolicy";
import {AssistantRequestValidationSchema,type AssistantProfilePatch,type AssistantJob} from "../../src/shared/model/host-contracts/assistant";
import type {HostProvider} from "../providers";
const closes:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
const execution={harness:"claude" as const,model:"claude:fixture",modelSettings:{},runtimeMode:"supervised" as const,maxRunMinutes:60};
async function fixture(){
 const folder=realpathSync.native(mkdtempSync(join(tmpdir(),"assistant-policy-"))),store=new HostStore(join(folder,"host.db"));await store.ready;const project=await store.addProject(folder,"Policy project"),provider:HostProvider={send:vi.fn(async input=>{input.onAccepted?.();}),cancel:vi.fn(async()=>{}),stop:vi.fn(async()=>{}),bind:vi.fn(),approve:vi.fn(),answer:vi.fn()},engine=new HostEngine(store,{claude:provider});await engine.ready;const tasks=new HostTasks(store,engine);await tasks.ready;const goals=new HostGoals(store,engine,tasks);await goals.ready;let now=new Date(2026,10,2,8).getTime(),idleMs=0;const ports=assistantExecutionPorts(store,goals,tasks);ports.now=()=>now;ports.readPresence=async()=>({supported:true,locked:false,idleMs});ports.chiefWake=vi.fn(async()=>({tokens:3,actions:[]}));let service=new HostAssistant(store,ports);await service.ready;const repository=new AssistantRepository(store);await repository.initialize();
 engine.beforeProviderTurn=async({author})=>{if(author?.kind==="task"&&author.id.startsWith("assistant-")&&!await service.autonomousJobAllowed(author.id))throw new Error("Current assistant policy restricts new provider input.");};
 const owner=(input:unknown)=>assistantDomain(service,store)(input,{principalId:"policy-owner",authorized:async()=>true}),snapshot=async()=>(await owner({op:"snapshot"})).snapshot!,patch=async(value:AssistantProfilePatch)=>owner({op:"profile.update",expectedVersion:(await snapshot()).profile.version,patch:value});
 await patch({name:"Policy fixture",setupComplete:true,enabled:true,autonomy:"report",dailyTokenBudget:1000000,execution,quietStart:0,quietEnd:0});const job=(await owner({op:"jobs.create",title:"Actual planner admission",request:"Plan the actual reviewed result",projectId:project.id,idempotencyKey:"actual-policy-job"})).job!,goalId=`assistant-${job.id}`;
 const currentJob=async()=>JSON.parse((await store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(job.id))!.value) as AssistantJob;
 closes.push(async()=>{await service.close();await tasks.close();await engine.close();await store.close();rmSync(folder,{recursive:true,force:true});});
 return{store,engine,tasks,goals,provider,ports,repository,owner,snapshot,patch,job,goalId,currentJob,get service(){return service;},time:(hour:number,minute=0)=>{now=new Date(2026,10,2,hour,minute).getTime();},idle:(value:number)=>{idleMs=value;},restart:async()=>{await service.close();service=new HostAssistant(store,ports);await service.ready;}};
}

it("preserves legacy defaults, validates ordered idle/away values and the finite nudge safety bound without overwriting saved preferences",async()=>{
 const f=await fixture(),initial=(await f.snapshot()).profile;for(const[key,value]of Object.entries(DEFAULT_ASSISTANT_POLICY))expect(initial[key as keyof typeof initial]).toBe(value);await f.patch({idleMinutes:2,awayMinutes:7,chiefWakeLimit:4,nudgeLimit:0,activeStart:22,activeEnd:6});expect(await f.service.nudgeLimit()).toBe(0);const saved=(await f.snapshot()).profile;await expect(f.patch({idleMinutes:8})).rejects.toThrow("longer than the idle");expect((await f.snapshot()).profile).toEqual(saved);for(const nudgeLimit of [-1,3])expect(AssistantRequestValidationSchema.safeParse({op:"profile.update",expectedVersion:saved.version,patch:{nudgeLimit}}).success).toBe(false);expect(AssistantRequestValidationSchema.safeParse({op:"profile.update",expectedVersion:saved.version,patch:{notificationDnd:"all"}}).success).toBe(false);await f.restart();expect((await f.snapshot()).profile.idleMinutes).toBe(2);expect((await f.snapshot()).profile.awayMinutes).toBe(7);expect(await f.service.nudgeLimit()).toBe(0);
});

it("uses the saved automatic presence thresholds while manual away remains sticky",async()=>{
 const f=await fixture();await f.patch({idleMinutes:1,awayMinutes:2});f.time(8,1);f.idle(90000);await f.service.tick();expect((await f.snapshot()).automaticPresence?.state).toBe("idle");f.time(8,2);f.idle(120000);await f.service.tick();expect((await f.snapshot()).automaticPresence?.state).toBe("away");await f.owner({op:"presence.set",state:"away"});f.time(8,3);f.idle(0);await f.service.tick();const snapshot=await f.snapshot();expect(snapshot.automaticPresence?.state).toBe("present");expect(snapshot.effectivePresence).toBe("away");expect(f.provider.send).not.toHaveBeenCalled();
});

it("holds project dispatch outside active hours, admits the initial real planner before goal ACK, and preserves owner/manual pause when hours reopen",async()=>{
 const f=await fixture();await f.patch({autonomy:"jobs",activeStart:9,activeEnd:17});await f.service.tick();expect(f.provider.send).not.toHaveBeenCalled();expect((await f.currentJob()).status).toBe("queued");expect((await f.snapshot()).workHoursActive).toBe(false);let initialAdmission=false;const hook=f.engine.beforeProviderTurn!;f.engine.beforeProviderTurn=async input=>{initialAdmission=await f.service.autonomousJobAllowed(f.goalId);await hook(input);};f.time(10);await f.service.tick();await vi.waitFor(()=>expect(f.provider.send).toHaveBeenCalledTimes(1));expect(initialAdmission).toBe(true);expect((await f.currentJob()).goalId).toBe(f.goalId);expect(await f.service.autonomousJobAllowed("ordinary-owner-goal")).toBe(true);expect(await f.service.autonomousJobAllowed("assistant-invented-job")).toBe(false);
 await f.tasks.setGoalPaused(f.goalId,true);expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(false);f.time(23);await f.service.tick();expect(await f.store.db.prepare("SELECT 1 FROM task_goal_reason_holds WHERE goal_id=? AND reason='assistant-hours'").get(f.goalId)).toBeTruthy();f.time(10);await f.service.tick();expect(await f.store.db.prepare("SELECT 1 FROM task_goal_reason_holds WHERE goal_id=? AND reason='assistant-hours'").get(f.goalId)).toBeUndefined();expect(await f.store.db.prepare("SELECT 1 FROM task_goal_holds WHERE goal_id=?").get(f.goalId)).toBeTruthy();expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(false);expect(f.provider.send).toHaveBeenCalledTimes(1);
});

it("rechecks the persisted policy after async provider admission is prepared and sends zero input when the owner closes the hours window",async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),hook=f.engine.beforeProviderTurn!;await f.patch({autonomy:"jobs",activeStart:9,activeEnd:17});f.time(10);f.engine.beforeProviderTurn=async input=>{entered.resolve();await release.promise;await hook(input);};const tick=f.service.tick();await entered.promise;await tick;await f.patch({activeStart:11,activeEnd:12});release.resolve();const goal=(await f.goals.list()).find(value=>value.id===f.goalId)!;await f.engine.waitForRun(goal.plannerSessionId!,goal.plannerRunId!);expect(f.provider.send).not.toHaveBeenCalled();expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(false);const record=await f.store.session(goal.plannerSessionId!);expect(record.status).toBe("interrupted");expect(record.runId).toBe(goal.plannerRunId);
});

it("admits only the canonical initial planner intent before its goal ACK and refuses missing/mismatched/fabricated ownership",async()=>{
 const f=await fixture();await f.patch({autonomy:"jobs"});await f.service.tick();await vi.waitFor(()=>expect(f.provider.send).toHaveBeenCalledTimes(1));const original=(await f.store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(f.job.id))!.value;
 await f.store.db.prepare("UPDATE assistant_jobs SET value=json_remove(json_set(value,'$.status','planning','$.dispatchState','unknown'),'$.goalId') WHERE id=?").run(f.job.id);expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(true);
 await f.store.db.prepare("UPDATE assistant_jobs SET value=json_set(value,'$.dispatchState','submitted') WHERE id=?").run(f.job.id);expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(false);
 await f.store.db.prepare("UPDATE assistant_jobs SET value=? WHERE id=?").run(original,f.job.id);const goal=(await f.store.db.prepare("SELECT value FROM goals WHERE id=?").get(f.goalId))!.value;await f.store.db.prepare("UPDATE goals SET value=json_set(value,'$.leadProjectId','foreign-project') WHERE id=?").run(f.goalId);expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(false);await f.store.db.prepare("UPDATE goals SET value=? WHERE id=?").run(goal,f.goalId);expect(await f.service.autonomousJobAllowed(f.goalId)).toBe(true);expect(f.provider.send).toHaveBeenCalledTimes(1);
});

it("honors per-presence notification settings without overriding DND or fabricating delivery",async()=>{
 const f=await fixture(),now=Date.now();for(const[id,kind]of [["budget","budget.exhausted"],["done","job.done"]] as const)await f.repository.put("runtime",{id:`notification:${id}`,version:0,createdAt:now,updatedAt:now,value:{id,kind,title:"Policy notification",body:"Actual pending metadata",createdAt:now}});await f.patch({notificationPresent:"none",notificationAway:"all"});let snapshot=await f.snapshot();expect(snapshot.notifications?.every(item=>!item.eligible&&item.deferredReason==="settings")).toBe(true);await f.owner({op:"presence.set",state:"away"});expect((await f.snapshot()).notifications?.every(item=>item.eligible)).toBe(true);await f.owner({op:"presence.set",state:"dnd"});expect((await f.snapshot()).notifications?.every(item=>!item.eligible&&item.deferredReason==="dnd")).toBe(true);const rows=await f.store.db.prepare("SELECT value FROM assistant_runtime WHERE id LIKE 'notification:%'").all();expect(rows.every(row=>!JSON.parse(row.value).value.acknowledgedAt)).toBe(true);
});

it("limits charged Chief wakes by the owner's saved hourly cap and admits more only after an explicit cap increase",async()=>{
 const f=await fixture();await f.patch({autonomy:"chief",chiefWakeLimit:1});await f.service.tick();await vi.waitFor(()=>expect(f.provider.send).toHaveBeenCalledTimes(1));expect(f.ports.chiefWake).toHaveBeenCalledTimes(1);const at=Date.now();await f.repository.put("runtime",{id:"chiefEvent:second-event",version:0,createdAt:at,updatedAt:at,value:{event:{id:"second-event",version:1,createdAt:at,updatedAt:at,kind:"job.waiting",summary:"Actual owner attention change",jobId:f.job.id}}});await f.service.tick();expect(f.ports.chiefWake).toHaveBeenCalledTimes(1);await f.patch({chiefWakeLimit:2});await f.service.tick();expect(f.ports.chiefWake).toHaveBeenCalledTimes(2);expect((await f.snapshot()).usage.chiefTokens).toBe(6);
});

it.each([{start:22,end:6,hour:23,active:true},{start:22,end:6,hour:5,active:true},{start:22,end:6,hour:6,active:false},{start:9,end:17,hour:9,active:true},{start:9,end:17,hour:17,active:false},{start:0,end:0,hour:23,active:true}])("uses local wall-clock active hours %#",({start,end,hour,active})=>{expect(assistantActiveHours({activeStart:start,activeEnd:end},new Date(2026,10,2,hour).getTime())).toBe(active);});
