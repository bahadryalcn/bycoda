import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,realpathSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {HostStore} from "./store";
import {HostEngine} from "./engine";
import {HostTasks} from "./tasks";
import {HostGoals} from "./goals";
import {HostAssistant} from "./assistant/service";
import {assistantExecutionPorts} from "./assistant-runtime";
import {assistantSessionRuntime} from "./assistant-session-runtime";
import {readAssistantQuestionStatus,assistantQuestionToken} from "./assistant-questions";
import type {HostProvider} from "./providers";
import type {SendTurnInput} from "../src/integrations/harness/core/types";
import {AssistantRequestValidationSchema} from "../src/shared/model/host-contracts/assistant";
import {assistantDomain} from "./assistant-domain";
import {chiefActions} from "./assistant-text";

const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
const execution={harness:"claude" as const,model:"claude:test",modelSettings:{},runtimeMode:"supervised" as const,maxRunMinutes:60};
const chief={kind:"chief" as const,id:"captured-chief"};
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};}
async function fixture(enabled=true){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),"assistant-questions-"))),store=new HostStore(join(directory,"host.db"));await store.ready;const project=await store.addProject(directory,"Question fixture"),turns:Array<{input:SendTurnInput;finish:()=>void}>=[];
 const provider:HostProvider={send:vi.fn(input=>new Promise<void>(finish=>{turns.push({input,finish});input.onAccepted?.();})),stop:vi.fn(async()=>{}),cancel:vi.fn(async()=>{turns.at(-1)?.finish();}),bind:vi.fn(),approve:vi.fn(),answer:vi.fn()};provider.retireOriginal=provider.stop;
 const engine=new HostEngine(store,{claude:provider});await engine.ready;const tasks=new HostTasks(store,engine);await tasks.ready;const goals=new HostGoals(store,engine,tasks);await goals.ready;
 const ports=assistantExecutionPorts(store,goals,tasks);ports.chiefWake=vi.fn(async()=>({actions:[],tokens:0}));
 // Seed the canonical goal relationship without launching its unrelated planner.
 // Question delivery itself uses the real engine/provider event protocol below.
 ports.createGoal=async({job})=>{const id=`assistant-${job.id}`,now=Date.now();await store.db.prepare("INSERT INTO goals(id,value) VALUES(?,?)").run(id,JSON.stringify({...execution,id,title:job.title,prompt:job.request,projectIds:[project.id],leadProjectId:project.id,verifyDefaults:{review:false},approvePlan:true,autoMerge:false,isolate:false,finalReview:false,taskIds:[],status:"running",createdAt:now,updatedAt:now}));return{goalId:id};};
 const assistant=new HostAssistant(store,ports);await assistant.ready;
 await assistant.request({op:"profile.update",expectedVersion:0,patch:{name:"Question fixture",autonomy:"chief",allowRoutineQuestions:enabled,enabled:true,setupComplete:true,dailyTokenBudget:1000000,execution,planApproval:"always"}},"owner");
 const job=(await assistant.request({op:"jobs.create",title:"Assigned report",request:"Write the assigned local report using the existing source data",projectId:project.id,idempotencyKey:"question-job"},"owner")).job!;
 const created=await engine.command({type:"create",commandId:"question-worker-create",projectId:project.id,workspaceMode:"current",...execution}),sessionId=created.sessionId,first=await engine.command({type:"send",commandId:"question-worker-root",sessionId,text:"Write the assigned local report using existing source data"});await vi.waitFor(()=>expect(turns).toHaveLength(1));
 await tasks.save({id:"question-task",projectId:project.id,title:"Report worker",prompt:job.request,...execution,maxRunMinutes:0,isolate:false,review:false});
 await store.db.prepare("UPDATE tasks SET value=json_set(value,'$.goalId',?,'$.sessionId',?,'$.runId',?,'$.status','running','$.startedAt',?) WHERE id='question-task'").run(job.goalId,sessionId,first.runId,Date.now());
 await store.db.prepare("UPDATE goals SET value=json_set(value,'$.taskIds',json(?),'$.status','running') WHERE id=?").run(JSON.stringify(["question-task"]),job.goalId);
 await store.db.prepare("UPDATE assistant_jobs SET value=json_set(value,'$.taskIds',json(?),'$.sessionIds',json(?),'$.status','running') WHERE id=?").run(JSON.stringify(["question-task"]),JSON.stringify([sessionId]),job.id);
 let managed=assistantSessionRuntime(store,engine,assistant,tasks);await managed.ready;ports.onPause=()=>managed.stop();ports.onResume=()=>managed.resume();ports.onJobPause=id=>managed.pauseJob(id);ports.onJobResume=id=>managed.resumeJob(id);
 ports.answerSession=async input=>{const response=await managed.request({op:"answer",...input},chief);if(response.operation?.delivery!=="submitted")throw new Error("Question submission remains unknown; inspect its original receipt.");};
 closes.push(async()=>{await managed.close();await assistant.close();for(const turn of turns)turn.finish();await tasks.close();await engine.close();await store.close();rmSync(directory,{recursive:true,force:true,maxRetries:5});});
 const ask=async(prompt="Which order should the report use?",requestId=7)=>{turns[0].input.onEvent({type:"question.asked",requestId,occurrenceId:"untrusted-provider-id",providerTurnId:"provider-turn",callId:"report-question",dismissAction:"skip",questions:[{id:"order",prompt,multiSelect:false,allowCustom:true,options:[{id:"chronological",label:"Chronological"},{id:"topic",label:"By topic"}]}]});await vi.waitFor(async()=>expect((await store.session(sessionId)).session.pendingQuestion?.requestId).toBe(requestId));};
 turns[0].input.onEvent({type:"context",used:1000,window:1000000});
 await vi.waitFor(async()=>expect((await store.session(sessionId)).session.context?.used).toBe(1000));
 const source=async()=>readAssistantQuestionStatus(store,await store.session(sessionId),job.id,await assistant.routineQuestionsAllowed());
 const answer=async(requestId="answer-one")=>({op:"answer" as const,jobId:job.id,sessionId,requestId,questionToken:(await source())!.questionToken!,answers:{order:["topic"]}});
 const configure=async(patch:Record<string,unknown>)=>{const profile=(await assistant.request({op:"snapshot"},"owner")).snapshot!.profile;return assistant.request({op:"profile.update",expectedVersion:profile.version,patch},"owner");};
 const save=async(mutate:(record:Awaited<ReturnType<HostStore["session"]>>)=>Awaited<ReturnType<HostStore["session"]>>)=>{const current=await store.session(sessionId);await store.save({...mutate(current),revision:current.revision+1},{type:"fixture.change"});};
 return{store,engine,tasks,goals,assistant,ports,provider,turns,project,job,sessionId,first,ask,source,answer,configure,save,get managed(){return managed;},restartManaged:async()=>{await managed.close();managed=assistantSessionRuntime(store,engine,assistant,tasks);await managed.ready;}};
}

it("submits an occurrence-bound routine answer through the actual Engine and stamps assistant authorship only after the question protocol resolves",async()=>{
 const f=await fixture();await f.ask();const record=await f.store.session(f.sessionId);expect(record.session.pendingQuestion?.occurrenceId).not.toBe("untrusted-provider-id");expect((await f.source())?.questionOwnerRequired).toBe(false);
 vi.mocked(f.provider.answer).mockImplementation((_id,requestId,reply)=>{f.turns[0].input.onEvent({type:"question.resolved",requestId,decision:"answered",...(reply.kind==="answered"?{reply}:{})});});
 const command=await f.answer(),result=await f.managed.request(command,chief);expect(result.operation).toMatchObject({action:"answer",delivery:"submitted",state:"settled"});expect(f.provider.answer).toHaveBeenCalledTimes(1);expect(f.provider.approve).not.toHaveBeenCalled();expect(f.turns).toHaveLength(1);
 const actual=await f.store.session(f.sessionId),reply=actual.session.blocks.find(block=>!!block.questionAnswers);expect(reply?.author).toMatchObject({kind:"assistant",jobId:f.job.id,name:"Question fixture",reason:"answer"});expect(reply?.continuationOf).toBe("question-worker-root");expect(actual.session.blocks.find(block=>block.id==="question-worker-root")?.author).toBeUndefined();
 expect((await f.assistant.request({op:"snapshot"},"owner")).snapshot!.usage.reservedWorkerTokens).toBeGreaterThan(0);
 f.turns[0].input.onEvent({type:"turn.metrics",inputTokens:100,outputTokens:50});f.turns[0].finish();await f.engine.waitForRun(f.sessionId,f.first.runId);await f.assistant.tick();const usage=(await f.assistant.request({op:"snapshot"},"owner")).snapshot!.usage;expect(usage.observedWorkerTokens).toBe(150);expect(usage.reservedWorkerTokens).toBe(0);expect(usage.workerTokens).toBe(150);
 expect((await f.managed.request(command,chief)).operation?.delivery).toBe("submitted");expect(f.provider.answer).toHaveBeenCalledTimes(1);
});

it("keeps off-policy and authority/publication questions with the owner and never answers an actual approval",async()=>{
 const f=await fixture(false);await f.ask();expect((await f.source())?.questionOwnerRequired).toBe(true);await expect(f.managed.request(await f.answer(),chief)).rejects.toThrow("enabled");await f.configure({allowRoutineQuestions:true});
 for(const[index,prompt]of ["May I install a dependency?","Should I send the report by email?","Merge and push these changes?","Can I delete the old files?","What password should I use?","Bu dosyaları silebilir miyim?"].entries()){await f.ask(prompt,index+8);expect((await f.source())?.questionOwnerRequired).toBe(true);await expect(f.managed.request(await f.answer(`unsafe-${index}`),chief)).rejects.toThrow();}
 await f.ask("Which order should the report use?",90);f.turns[0].input.onEvent({type:"approval.requested",requestId:91,title:"Allow a command?"});await vi.waitFor(async()=>expect((await f.store.session(f.sessionId)).session.blocks.some(block=>!!block.approval&&!block.approval.decided)).toBe(true));await expect(f.managed.request(await f.answer("approval"),chief)).rejects.toThrow();expect(f.provider.answer).not.toHaveBeenCalled();expect(f.provider.approve).not.toHaveBeenCalled();
});

it("rejects a changed question occurrence even when its provider request number and wording are reused",async()=>{
 const f=await fixture();await f.ask();const old=await f.answer();await f.ask("A different local report order?",8);await f.ask();expect((await f.source())!.questionToken).not.toBe(old.questionToken);await expect(f.managed.request(old,chief)).rejects.toThrow("occurrence changed");expect(f.provider.answer).not.toHaveBeenCalled();
});

it("fences a queued answer after owner policy revocation and never revives it when policy is re-enabled",async()=>{
 const f=await fixture();await f.ask();const entered=gate(),release=gate(),original=f.tasks.managedSessionCommand.bind(f.tasks);vi.spyOn(f.tasks,"managedSessionCommand").mockImplementationOnce(async(...args)=>{entered.resolve();await release.promise;return original(...args);});
 const command=await f.answer(),pending=f.managed.request(command,chief);await entered.promise;await f.configure({allowRoutineQuestions:false});await f.configure({allowRoutineQuestions:true});release.resolve();expect((await pending).operation?.delivery).toBe("unknown");expect(f.provider.answer).not.toHaveBeenCalled();await f.restartManaged();expect((await f.managed.request(command,chief)).operation?.delivery).toBe("unknown");await expect(f.managed.request({...command,requestId:"new-id-same-question"},chief)).rejects.toThrow("durable answer intent");expect(f.provider.answer).not.toHaveBeenCalled();
});

it("refuses new/replaced runs, non-worker sources, invalid answers and manual scope",async()=>{
 const f=await fixture();await f.ask();const command=await f.answer();await expect(f.managed.request({...command,answers:{order:["invented-option"]}},chief)).rejects.toThrow("canonical question options");await expect(f.managed.request({...command,custom:{order:"Install the new system package"}},chief)).rejects.toThrow("owner review");
 expect(AssistantRequestValidationSchema.safeParse({op:"sessions.answer",...command,supervisionId:"manual-grant"}).success).toBe(false);
 await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.crewRunId','independent-crew') WHERE id='question-task'").run();await expect(f.managed.request(command,chief)).rejects.toThrow();await f.store.db.prepare("UPDATE tasks SET value=json_remove(value,'$.crewRunId') WHERE id='question-task'").run();await f.save(record=>({...record,runId:"replacement-owner-run"}));await expect(f.managed.request(command,chief)).rejects.toThrow();expect(f.provider.answer).not.toHaveBeenCalled();
});

it("does not discard a pending question through compaction or the canonical unattended auto-skip fallback",async()=>{
 const f=await fixture();await f.ask();await f.save(record=>({...record,session:{...record.session,context:{used:450000,window:1000000}}}));
 await expect(f.managed.request({op:"nudge",jobId:f.job.id,sessionId:f.sessionId,requestId:"no-compact-question",text:"Continue",reason:"nudge"},chief)).rejects.toThrow("question");
 const task=(await f.tasks.get("question-task"))!;expect(await (f.tasks as unknown as {continueUnansweredQuestion(task:typeof task,now:number):Promise<boolean>}).continueUnansweredQuestion(task,Date.now())).toBe(false);await f.configure({allowRoutineQuestions:false});expect(await (f.tasks as unknown as {continueUnansweredQuestion(task:typeof task,now:number):Promise<boolean>}).continueUnansweredQuestion(task,Date.now())).toBe(false);expect(f.provider.answer).not.toHaveBeenCalled();expect((await f.store.session(f.sessionId)).session.pendingQuestion).toBeTruthy();
});

it.each([
 {label:"unknown",context:undefined},
 {label:"soft token limit",context:{used:150000,window:1000000}},
 {label:"soft window limit",context:{used:50000,window:100000}},
 {label:"hard token limit",context:{used:450000,window:1000000}},
])("parks a pending question instead of answering into $label context",async({context})=>{
 const f=await fixture();await f.ask();const command=await f.answer();
 await f.save(record=>({...record,session:{...record.session,context}}));
 expect(await f.source()).toMatchObject({questionOwnerRequired:true,questionOwnerReason:expect.stringContaining("context maintenance")});
 await expect(f.managed.request(command,chief)).rejects.toThrow("context maintenance");
 expect(f.provider.answer).not.toHaveBeenCalled();expect((await f.store.session(f.sessionId)).session.pendingQuestion).toBeTruthy();
});

it("uses the actual saved worker thresholds and rechecks a stricter owner change before answering",async()=>{
 const f=await fixture();await f.configure({workerSoftContext:250000,workerHardContext:500000});await f.ask();
 await f.save(record=>({...record,session:{...record.session,context:{used:200000,window:1000000}}}));
 expect((await f.source())?.questionOwnerRequired).toBe(false);
 const command=await f.answer(),entered=gate(),release=gate(),original=f.tasks.managedSessionCommand.bind(f.tasks);
 vi.spyOn(f.tasks,"managedSessionCommand").mockImplementationOnce(async(...args)=>{entered.resolve();await release.promise;return original(...args);});
 const pending=f.managed.request(command,chief);await entered.promise;await f.configure({workerSoftContext:100000,workerHardContext:300000});release.resolve();
 expect((await pending).operation?.delivery).toBe("unknown");expect(f.provider.answer).not.toHaveBeenCalled();expect((await f.store.session(f.sessionId)).session.pendingQuestion).toBeTruthy();
});

it("rechecks growing context at the actual worker answer effect without discarding its question",async()=>{
 const f=await fixture();await f.ask();const entered=gate(),release=gate(),original=f.tasks.managedSessionCommand.bind(f.tasks);
 vi.spyOn(f.tasks,"managedSessionCommand").mockImplementationOnce(async(...args)=>{entered.resolve();await release.promise;return original(...args);});
 const command=await f.answer(),pending=f.managed.request(command,chief);await entered.promise;
 await f.save(record=>({...record,session:{...record.session,context:{used:450000,window:1000000}}}));release.resolve();
 expect((await pending).operation?.delivery).toBe("unknown");expect(f.provider.answer).not.toHaveBeenCalled();
 expect((await f.store.session(f.sessionId)).session.pendingQuestion).toBeTruthy();
});

it("preserves an uncertain actual provider answer and does not replay it under a fresh operation ID",async()=>{
 const f=await fixture();await f.ask();vi.mocked(f.provider.answer).mockImplementation(()=>{throw new Error("Unknown transport write");});const command=await f.answer(),result=await f.managed.request(command,chief);expect(result.operation?.delivery).toBe("unknown");expect(f.provider.answer).toHaveBeenCalledTimes(1);await f.restartManaged();expect((await f.managed.request(command,chief)).operation?.delivery).toBe("unknown");await expect(f.managed.request({...command,requestId:"fresh-unknown-id"},chief)).rejects.toThrow();expect(f.provider.answer).toHaveBeenCalledTimes(1);expect((await f.assistant.request({op:"snapshot"},"owner")).snapshot!.usage.reservedWorkerTokens).toBeGreaterThan(0);
});

it("rechecks the exact question at the final engine effect after delayed command admission",async()=>{
 const f=await fixture();await f.ask();const entered=gate(),release=gate(),original=f.tasks.managedSessionCommand.bind(f.tasks);vi.spyOn(f.tasks,"managedSessionCommand").mockImplementationOnce(async(...args)=>{entered.resolve();await release.promise;return original(...args);});const command=await f.answer(),pending=f.managed.request(command,chief);await entered.promise;await f.ask("A new order question with a different occurrence?",8);release.resolve();expect((await pending).operation?.delivery).toBe("unknown");expect(f.provider.answer).not.toHaveBeenCalled();expect((await f.store.session(f.sessionId)).session.pendingQuestion?.requestId).toBe(8);
});

it("exposes the finite Chief action while an authenticated owner RPC cannot impersonate that principal",async()=>{
 const f=await fixture();await f.ask();const{op:_,...payload}=await f.answer(),action={op:"sessions.answer",...payload};expect(chiefActions(JSON.stringify({actions:[action]}))).toEqual([action]);await expect(assistantDomain(f.assistant,f.store)(action,{principalId:"owner-route",authorized:async()=>true})).rejects.toThrow("Chief autonomy");expect(f.provider.answer).not.toHaveBeenCalled();
});

it("refuses overlapping canonical planner/reviewer ownership even if a worker row also names the same session",async()=>{
 const f=await fixture();await f.ask();const command=await f.answer();
 await f.store.db.prepare("UPDATE goals SET value=json_set(value,'$.plannerSessionId',?) WHERE id=?").run(f.sessionId,f.job.goalId);expect((await f.source())?.questionOwnerRequired).toBe(true);await expect(f.managed.request(command,chief)).rejects.toThrow("planner");
 await f.store.db.prepare("UPDATE goals SET value=json_remove(value,'$.plannerSessionId') WHERE id=?").run(f.job.goalId);await f.store.db.prepare("UPDATE tasks SET value=json_set(value,'$.reviewer.sessionId',?) WHERE id='question-task'").run(f.sessionId);await expect(f.managed.request(command,chief)).rejects.toThrow("reviewer");expect(f.provider.answer).not.toHaveBeenCalled();
});

it("rechecks owner Stop after command acceptance and before the actual provider answer callback",async()=>{
 const f=await fixture();await f.ask();const entered=gate(),release=gate(),seam=f.tasks as unknown as {admitCommand:HostEngine["withCommandAdmission"]},original=seam.admitCommand;seam.admitCommand=(admission,work)=>original({...admission,check:async stage=>{await admission.check(stage);if(stage.phase==="provider"){entered.resolve();await release.promise;await admission.check(stage);}}},work);
 const command=await f.answer(),pending=f.managed.request(command,chief);await entered.promise;expect((await f.store.session(f.sessionId)).session.pendingQuestion?.delivery).toBe("sending");await f.assistant.request({op:"pauseAll"},"owner");release.resolve();expect((await pending).operation?.delivery).toBe("unknown");expect(f.provider.answer).not.toHaveBeenCalled();expect((await f.store.session(f.sessionId)).runId).toBe(f.first.runId);expect(assistantQuestionToken(await f.store.session(f.sessionId))).toBe(command.questionToken);
});
