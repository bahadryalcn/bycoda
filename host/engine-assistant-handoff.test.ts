import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostTasks } from "./tasks";
import { HostAssistant } from "./assistant/service";
import { assistantSessionRuntime } from "./assistant-session-runtime";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(multi=false) {
  const directory=realpathSync.native(mkdtempSync(join(tmpdir(),"bycoda-assistant-history-")));
  const store=new HostStore(join(directory,"host.db"));
  await store.ready;
  const project=await store.addProject(directory,"Continuation fixture");
  if(multi)mkdirSync(join(directory,"secondary"));
  const workerProject=multi?await store.addProject(join(directory,"secondary"),"Secondary worker"):project;
  const turns: Array<{input:SendTurnInput;finish:()=>void;boundHistory?:string}>=[];
  const bindings=new Map<string,string>();
  const provider:HostProvider={
    send:vi.fn(input=>new Promise<void>(finish=>{turns.push({input,finish,boundHistory:bindings.get(input.sessionId)});})),
    stop:vi.fn(async id=>{bindings.delete(id);}), cancel:vi.fn(async()=>{turns.at(-1)?.finish();}),
    bind:vi.fn((id,history)=>{bindings.set(id,history);}), approve:vi.fn(), answer:vi.fn(),
  };
  provider.retireOriginal=provider.stop;
  const engine=new HostEngine(store,{claude:provider});
  await engine.ready;
  const tasks=new HostTasks(store,engine);
  await tasks.ready;
  cleanups.push(async()=>{
    for(const turn of turns)turn.finish();
    await tasks.close();await engine.close();await store.close();
    rmSync(directory,{recursive:true,force:true,maxRetries:5});
  });
  const id=(await engine.command({type:"create",commandId:"create-worker",projectId:workerProject.id,workspaceMode:"current",
    harness:"claude",model:"claude:test",modelSettings:{},runtimeMode:"supervised"})).sessionId;
  const first=await engine.command({type:"send",commandId:"worker-original",sessionId:id,text:"Retain the original task and its existing files."});
  await vi.waitFor(()=>expect(turns).toHaveLength(1));
  turns[0].finish();await engine.waitForRun(id,first.runId);
  const current=await store.session(id);
  await store.save({...current,revision:current.revision+1,session:{...current.session,providerSessionId:"original-provider-history",context:{used:420000,window:1000000}}}, {type:"fixture.context"});
  await tasks.save({id:"worker",projectId:workerProject.id,title:"Retain the report",prompt:"Finish the retained report and run its original checks.",
    harness:"claude",model:"claude:test",modelSettings:{},runtimeMode:"supervised",maxRunMinutes:0,isolate:false});
  await store.db.prepare("UPDATE tasks SET value=json_set(value,'$.goalId','assistant-job','$.sessionId',?,'$.runId',?,'$.status','running','$.startedAt',?) WHERE id='worker'").run(id,first.runId,Date.now());
  const snapshot=await store.session(id);
  const source={projectId:workerProject.id,executionCwd:workerProject.cwd,authorityGeneration:snapshot.authorityGeneration,runId:snapshot.runId};
  const controller=new AbortController();
  const author={kind:"assistant" as const,name:"Arif",jobId:"job",reason:"nudge" as const,operationId:"handoff-one"};
  const input={sessionId:id,requestId:"handoff-one",source,text:"Continue the incomplete work.",author,signal:controller.signal,
    jobId:"job",guard:async()=>{}};
  const save=async(value:typeof snapshot)=>store.save({...value,revision:(await store.session(id)).revision+1},{type:"fixture.mutate"});
  return {store,engine,tasks,turns,provider,id,first,source,controller,input,project,workerProject,save};
}

async function supervised(f:Awaited<ReturnType<typeof setup>>) {
  const assistant=new HostAssistant(f.store,{listProjects:async()=>[...new Map([f.project,f.workerProject].map(project=>[project.id,{id:project.id,path:project.cwd,name:project.name}])).values()],createGoal:async()=>({goalId:"assistant-fixture"}),goalStatus:async()=>({status:"running",taskIds:["worker"],sessionIds:[f.id],progress:{done:0,total:1}})});
  await assistant.ready;cleanups.push(()=>assistant.close());
  await assistant.request({op:"profile.update",expectedVersion:0,patch:{name:"Fixture",enabled:true,setupComplete:true,autonomy:"chief",dailyTokenBudget:10000000,execution:{harness:"claude",model:"claude:test",modelSettings:{},runtimeMode:"supervised",maxRunMinutes:60}}},"owner");
  const job=(await assistant.request({op:"jobs.create",title:"Retain worker",request:"Continue incomplete work",projectId:f.project.id,projectIds:[f.project.id,f.workerProject.id],idempotencyKey:"fixture-job"},"owner")).job!;
  await f.store.db.prepare("UPDATE assistant_jobs SET value=json_set(value,'$.goalId',?,'$.sessionIds',json(?),'$.taskIds',json(?),'$.status','running') WHERE id=?").run(`assistant-${job.id}`,JSON.stringify([f.id]),JSON.stringify(["worker"]),job.id);
  await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.goalId',?) WHERE id='worker'").run(`assistant-${job.id}`);
  await f.store.db.exec("CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  await f.store.db.prepare("INSERT OR REPLACE INTO goals(id,value) VALUES(?,?)").run(`assistant-${job.id}`,JSON.stringify({id:`assistant-${job.id}`,projectIds:[...new Set([f.project.id,f.workerProject.id])],leadProjectId:f.project.id,taskIds:["worker"]}));
  const managed=assistantSessionRuntime(f.store,f.engine,assistant,f.tasks);await managed.ready;cleanups.push(()=>managed.close());
  const record=await f.store.session(f.id);await f.save({...record,session:{...record.session,context:{used:160000,window:1000000}}});
  return {assistant,managed,job,command:{op:"nudge",jobId:job.id,sessionId:f.id,requestId:"compact-nudge",text:"Continue incomplete work",reason:"nudge"}};
}

it("supervises a secondary project's actual canonical worker and refuses array-only or changed goal/task grants",async()=>{
 const f=await setup(true),s=await supervised(f),current=await f.store.session(f.id);await f.save({...current,session:{...current.session,context:{used:1000,window:1000000}}});
 expect(f.source.projectId).not.toBe(f.project.id);
 const sending=s.managed.request({...s.command,requestId:"secondary-worker"},{kind:"chief",id:"chief"});await vi.waitFor(()=>expect(f.turns).toHaveLength(2));f.turns[1].input.onAccepted?.();expect((await sending).operation?.delivery).toBe("delivered");
 expect(f.turns[1].input.cwd).toBe(f.workerProject.cwd);expect((await f.store.markAssistantManagedSession(f.id,s.job.id)).managedBy?.jobId).toBe(s.job.id);
 const canonical=(await f.tasks.list(f.workerProject.id,false))[0],projected=(await f.tasks.list(f.workerProject.id))[0];
 expect(projected.assistantFollowups).toEqual({delivered:1,unconfirmed:0});const {assistantFollowups:_,...withoutProjection}=projected;expect(withoutProjection).toEqual(canonical);
 expect(canonical).toMatchObject({projectId:f.workerProject.id,sessionId:f.id,status:"running",runId:(await f.store.session(f.id)).runId});
 expect(JSON.parse(String((await f.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(canonical.id))!.value))).not.toHaveProperty("assistantFollowups");
 f.turns[1].finish();await f.engine.waitForRun(f.id,(await f.store.session(f.id)).runId);
 // Removing the secondary project from the real Goal cannot be compensated
 // by the saved AssistantJob.projectIds convenience array.
 await f.store.db.prepare("UPDATE goals SET value=json_set(value,'$.projectIds',json(?)) WHERE id=?").run(JSON.stringify([f.project.id]),`assistant-${s.job.id}`);
 await expect(f.store.markAssistantManagedSession(f.id,s.job.id)).rejects.toThrow("complete project scope");
 await expect(s.managed.request({...s.command,requestId:"changed-goal"},{kind:"chief",id:"chief"})).rejects.toThrow("complete project scope");expect(f.turns).toHaveLength(2);
 await f.store.db.prepare("UPDATE goals SET value=json_set(value,'$.projectIds',json(?)) WHERE id=?").run(JSON.stringify([f.project.id,f.workerProject.id]),`assistant-${s.job.id}`);
 await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.projectId',?) WHERE id='worker'").run(f.project.id);
 await expect(f.store.markAssistantManagedSession(f.id,s.job.id)).rejects.toThrow("canonical goal/task");await expect(s.managed.request({...s.command,requestId:"wrong-task-project"},{kind:"chief",id:"chief"})).rejects.toThrow("canonical goal/task");
 await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.projectId',?) WHERE id='worker'").run(f.workerProject.id);
 await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.goalId','another-goal') WHERE id='worker'").run();
 await expect(f.store.markAssistantManagedSession(f.id,s.job.id)).rejects.toThrow("canonical goal/task");await expect(s.managed.request({...s.command,requestId:"changed-task"},{kind:"chief",id:"chief"})).rejects.toThrow("canonical goal/task");expect(f.turns).toHaveLength(2);
});

it("never sends after a provider failed compaction even if it emitted a smaller context and settled idle",async()=>{
  const f=await setup(),s=await supervised(f);
  f.provider.compact=vi.fn(async input=>{input.onEvent({type:"context",used:1000,window:1000000});throw new Error("Fixture compaction failed");});
  const result=await s.managed.request(s.command,{kind:"chief",id:"chief"});
  expect(result.operation).toMatchObject({action:"compact",state:"unknown",delivery:"unknown"});
  expect((await f.store.session(f.id)).status).toBe("idle");expect(f.turns).toHaveLength(1);
  expect((await f.store.session(f.id)).session.blocks.at(-1)?.text).toContain("Fixture compaction failed");
});

it("rebinds a managed task and budget ledger at compaction acceptance before scheduler settlement",async()=>{
  const f=await setup(),s=await supervised(f),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  f.provider.compact=vi.fn(async input=>{entered.resolve();await release.promise;input.onEvent({type:"context",used:1000,window:1000000});});
  const pending=s.managed.request(s.command,{kind:"chief",id:"chief"});await entered.promise;
  const compact=(await f.store.session(f.id)).runId;
  expect((await f.tasks.get("worker"))?.runId).toBe(compact);await f.tasks.tick();expect((await f.tasks.get("worker"))?.status).toBe("running");
  expect(await f.store.db.prepare("SELECT run_id FROM task_run_budget_ledger WHERE task_id='worker' AND run_id=?").get(compact)).toBeTruthy();
  release.resolve();await vi.waitFor(()=>expect(f.turns).toHaveLength(2));f.turns[1].input.onAccepted?.();
  expect((await pending).operation).toMatchObject({action:"compact",delivery:"delivered"});
  expect((await f.tasks.get("worker"))?.runId).toBe((await f.store.session(f.id)).runId);
  f.turns[1].finish();await f.engine.waitForRun(f.id,(await f.store.session(f.id)).runId);
});

it("rechecks captured authority after the engine queue and immediately before real provider entry",async()=>{
  const f=await setup(),hold=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
  const blocking=(f.engine as unknown as {operations:{run:(id:string,work:()=>Promise<void>)=>Promise<void>}}).operations.run(f.id,async()=>{entered.resolve();await hold.promise;});await entered.promise;
  let allowed=true;
  const queued=f.engine.withCommandAdmission({check:async()=>{if(!allowed)throw new Error("Fixture owner Stop");}},()=>f.engine.command({type:"send",commandId:"queued-admission",sessionId:f.id,text:"Must not dispatch"}));
  await Promise.resolve();allowed=false;hold.resolve();await blocking;await expect(queued).rejects.toThrow("owner Stop");expect(f.turns).toHaveLength(1);
  let checks=0;
  const receipt=await f.engine.withCommandAdmission({check:async stage=>{if(stage.phase==="provider"&&++checks===2)throw new Error("Fixture revoked at provider boundary");}},()=>f.engine.command({type:"send",commandId:"late-admission",sessionId:f.id,text:"Must not enter provider"}));
  await f.engine.waitForRun(f.id,receipt.runId);expect(checks).toBe(2);expect(f.turns).toHaveLength(1);
});

it("rolls back worker run rebinding and only caches budget registration after the acceptance transaction commits",async()=>{
  const f=await setup(),command={type:"send",commandId:"atomic-managed",sessionId:f.id,text:"Retain original task"};
  const input={...f.input,recheck:f.input.guard};
  await f.store.db.exec("CREATE TRIGGER fixture_refuse_receipt BEFORE INSERT ON receipts WHEN NEW.id='atomic-managed' BEGIN SELECT RAISE(ABORT,'Fixture receipt write failed'); END;");
  await expect(f.tasks.managedSessionCommand(input,command)).rejects.toThrow("receipt write failed");
  expect((await f.tasks.get("worker"))?.runId).toBe(f.first.runId);expect(f.turns).toHaveLength(1);
  await f.store.db.exec("DROP TRIGGER fixture_refuse_receipt;");
  const receipt=await f.tasks.managedSessionCommand(input,command);await vi.waitFor(()=>expect(f.turns).toHaveLength(2));
  expect(await f.store.db.prepare("SELECT run_id FROM task_run_budget_ledger WHERE task_id='worker' AND run_id=?").get(receipt.runId)).toBeTruthy();
  f.turns[1].finish();await f.engine.waitForRun(f.id,receipt.runId);
});

it("carries handoff authority through accepted task rebinding to the eventual provider boundary",async()=>{
  const f=await setup();
  const receipt=await f.tasks.continueManagedSession({...f.input,guard:async()=>{if((await f.tasks.get("worker"))?.runId!==f.first.runId)throw new Error("Fixture owner stopped after acceptance");}});
  await f.engine.waitForRun(f.id,receipt.runId);expect(f.turns).toHaveLength(1);
  expect((await f.store.session(f.id)).status).toBe("interrupted");
});

it("refuses supervisor writes to planner and independent reviewer roles while keeping their status readable",async()=>{
  const f=await setup(),s=await supervised(f);
  await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.sessionId','other-worker','$.reviewer',json(?)) WHERE id='worker'").run(JSON.stringify({sessionId:f.id,runId:f.first.runId}));
  const status=await s.managed.request({op:"status",jobId:s.job.id,sessionId:f.id},{kind:"chief",id:"chief"});expect(status.status?.sessionId).toBe(f.id);
  await expect(s.managed.request(s.command,{kind:"chief",id:"chief"})).rejects.toThrow("independent review");expect(f.turns).toHaveLength(1);
});

it("continues the real task in fresh provider history while retaining its transcript, model, folder and verification owner",async()=>{
  const f=await setup();
  const before=await f.tasks.get("worker");
  const receipt=await f.tasks.continueManagedSession(f.input);
  await vi.waitFor(()=>expect(f.turns).toHaveLength(2));
  expect(receipt.sessionId).toBe(f.id);
  expect(receipt.runId).not.toBe(f.first.runId);
  const task=await f.tasks.get("worker");
  expect(task).toMatchObject({sessionId:f.id,runId:receipt.runId,model:before!.model,prompt:before!.prompt,startedAt:before!.startedAt,status:"running"});
  const current=await f.store.session(f.id);
  expect(current.session.blocks.some(block=>block.id==="worker-original")).toBe(true);
  expect(current.session.blocks.find(block=>block.id===`${receipt.commandId}-send`)?.author).toMatchObject(f.input.author);
  expect(current.session.context).toBeUndefined();
  expect(current.session.providerSessionId).toBeUndefined();
  expect(f.provider.stop).toHaveBeenCalledWith(f.id);
  expect(f.provider.bind).toHaveBeenCalledWith(f.id,"original-provider-history",f.source.executionCwd,undefined);
  expect(f.turns[1].boundHistory).toBeUndefined();
  expect(f.turns[1].input).toMatchObject({sessionId:f.id,cwd:f.source.executionCwd,model:"claude:test",runtimeMode:"supervised"});
  expect(f.turns[1].input.text).toContain("bycoda.task-continuation.v1");
  expect(f.turns[1].input.text).toContain("Continue the incomplete work.");
  expect(f.turns[1].input.text).toContain("original checks");
  f.turns[1].finish();await f.engine.waitForRun(f.id,receipt.runId);
});

it("refuses owner drafts, active turns, model changes and paused goals without rotating provider history",async()=>{
  const f=await setup();
  const original=await f.store.session(f.id);
  await f.save({...original,session:{...original.session,blocks:[...original.session.blocks,{id:"draft",role:"user",text:"Owner unsent draft",draft:true}]}});
  await expect(f.tasks.continueManagedSession(f.input)).rejects.toThrow("pending input");
  expect((await f.store.session(f.id)).session.blocks.at(-1)?.text).toBe("Owner unsent draft");
  expect(f.provider.stop).not.toHaveBeenCalled();
  await f.save(original);
  await f.tasks.setGoalPaused("assistant-job",true);
  await expect(f.tasks.continueManagedSession(f.input)).rejects.toThrow("paused");
  await f.tasks.setGoalPaused("assistant-job",false);
  await f.save({...original,session:{...original.session,model:"changed-model"}});
  await expect(f.tasks.continueManagedSession(f.input)).rejects.toThrow("model");
  await f.save({...original,status:"running"});
  await expect(f.tasks.continueManagedSession(f.input)).rejects.toThrow("execution identity");
  expect(f.turns).toHaveLength(1);
  expect((await f.tasks.get("worker"))?.runId).toBe(f.first.runId);
});

it("rechecks owner Stop after original writer retirement and leaves the original task and history intact",async()=>{
  const f=await setup();
  let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;
  const retired=new Promise<void>(resolve=>{entered=resolve;});
  vi.spyOn(f.provider,"retireOriginal").mockImplementationOnce(async()=>{entered();await waiting;});
  const operation=f.tasks.continueManagedSession(f.input);
  await retired;
  f.controller.abort();release();
  await expect(operation).rejects.toThrow();
  expect(f.turns).toHaveLength(1);
  expect((await f.store.session(f.id)).session.providerSessionId).toBe("original-provider-history");
  expect((await f.tasks.get("worker"))?.runId).toBe(f.first.runId);
});

it("rolls back prepared history if the task cannot rebind and deduplicates an accepted exact engine continuation",async()=>{
  const f=await setup();
  const onAccepted=vi.fn(async()=>{throw new Error("Task changed at acceptance");});
  const input={...f.input,requestId:"atomic-history",brief:"Retained original work.",admitted:async()=>{},onAccepted};
  await expect(f.engine.continueSessionHistory(input)).rejects.toThrow("Task changed");
  expect((await f.store.session(f.id)).session.blocks.some(block=>block.role==="handoff")).toBe(false);
  expect((await f.store.session(f.id)).session.providerSessionId).toBe("original-provider-history");
  expect(f.turns).toHaveLength(1);
  onAccepted.mockImplementation(async()=>{});
  const receipt=await f.engine.continueSessionHistory(input);
  await vi.waitFor(()=>expect(f.turns).toHaveLength(2));
  expect(await f.engine.continueSessionHistory(input)).toEqual(receipt);
  expect(f.turns).toHaveLength(2);
  await expect(f.engine.continueSessionHistory({...input,text:"Different task"})).rejects.toThrow();
  f.turns[1].finish();await f.engine.waitForRun(f.id,receipt.runId);
});

it("routes the high-context assistant nudge through the real task and engine once and retains unknown delivery without replay",async()=>{
  const f=await setup();
  const assistant=new HostAssistant(f.store,{
    listProjects:async()=>[{id:f.project.id,path:f.source.executionCwd,name:"Project"}],
    createGoal:async()=>({goalId:"assistant-job"}),
    goalStatus:async()=>({status:"running",taskIds:["worker"],sessionIds:[f.id],progress:{done:0,total:1}}),
  });
  await assistant.ready;
  cleanups.push(()=>assistant.close());
  await assistant.request({op:"profile.update",expectedVersion:0,patch:{name:"Arif",enabled:true,setupComplete:true,
    autonomy:"chief",dailyTokenBudget:1000000,execution:{harness:"claude",model:"claude:test",modelSettings:{},runtimeMode:"supervised",maxRunMinutes:60}}},"owner");
  const job=(await assistant.request({op:"jobs.create",title:"Continue worker",request:"Finish work",projectId:f.project.id,idempotencyKey:"job"},"owner")).job!;
  // The actual service derives its own ID; bind the fixture task and job relation
  // exactly as the production goal-status projection does.
  await f.store.db.prepare("UPDATE assistant_jobs SET value=json_set(value,'$.goalId',?,'$.sessionIds',json(?),'$.taskIds',json(?),'$.status','running') WHERE id=?")
    .run(`assistant-${job.id}`,JSON.stringify([f.id]),JSON.stringify(["worker"]),job.id);
  await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.goalId',?) WHERE id='worker'").run(`assistant-${job.id}`);
  await f.store.db.exec("CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  await f.store.db.prepare("INSERT OR REPLACE INTO goals(id,value) VALUES(?,?)").run(`assistant-${job.id}`,JSON.stringify({id:`assistant-${job.id}`,projectIds:[...new Set([f.project.id,f.workerProject.id])],leadProjectId:f.project.id,taskIds:["worker"]}));
  const managed=assistantSessionRuntime(f.store,f.engine,assistant,f.tasks);
  await managed.ready;cleanups.push(()=>managed.close());
  const command={op:"nudge",jobId:job.id,sessionId:f.id,requestId:"durable-high-context",text:"Continue the incomplete work.",reason:"nudge"};
  // Actual dispatch occurs, but an observer cannot certify provider acceptance.
  const delivery=vi.spyOn(f.engine,"commandDelivery").mockResolvedValue("unknown");
  const first=await managed.request(command,{kind:"chief",id:"chief"});
  await vi.waitFor(()=>expect(f.turns).toHaveLength(2));
  expect(first.operation).toMatchObject({action:"handoff",delivery:"unknown"});
  expect(await managed.request(command,{kind:"chief",id:"chief"})).toEqual(first);
  expect(delivery).toHaveBeenCalledTimes(1);
  expect(f.turns).toHaveLength(2);
  expect((await f.tasks.get("worker"))?.runId).toBe((await f.store.session(f.id)).runId);
  f.turns[1].finish();await f.engine.waitForRun(f.id,(await f.store.session(f.id)).runId);
});
