import type {
  AssistantSnapshot,
  AssistantMessage,
} from "../../src/shared/model/host-contracts/assistant";
import {Button} from "../../src/shared/ui/Button";
import {saveOwnerQuestionPresentation} from "../../src/features/assistant/model/assistantOwnerQuestionPresentations";
import {DEFAULT_ASSISTANT_POLICY} from "../../src/shared/model/assistantPolicy";
const now = Date.now();
let questionAckLost=false;
let questionMutationCount=0;
const summaryFixture=new URLSearchParams(location.search).has("summary-refresh");
const summaryRefreshReceipts=new Set<string>();
const summaryRefreshRequests:any[]=[];
let summaryRefreshMutations=0;
export const snapshot: AssistantSnapshot = {
  profile: {
    ...DEFAULT_ASSISTANT_POLICY,
    name: "Arif",
    showTitle: true,
    avatar: "A",
    addressAs: "",
    language: "auto",
    autonomy: "jobs",
    allowRoutineQuestions:false,
    planApproval: "large",
    dailyTokenBudget: 2000000,
    perWakeTokenCap: 8000,
    enabled: true,
    setupComplete: true,
    voiceSetupComplete: false,
    proactiveSpeech: "never",
    keepAwakeWhileWorking: false,
    quietStart: 22,
    quietEnd: 8,
    chiefSoftContext: 150000,
    chiefHardContext: 250000,
    workerSoftContext:150000,
    workerHardContext:300000,
    workerCompactPercent:50,
    workerHandoffPercent:80,
    stallMinutes: 15,
    execution: null,
    chiefExecution: null,
    replyExecution: null,
    planningExecution: null,
    version: 3,
    updatedAt: now,
  },
  jobs: [
    {
      id: "job-one",
      version: 1,
      title: "Improve session recovery",
      request: "Improve session recovery and check cancellation",
      projectId: "one",
      status: "running",
      goalId: "goal-one",
      taskIds: ["task-one", "task-two"],
      sessionIds: ["session-one", "session-compact"],
      progress: { done: 2, total: 4 },
      createdAt: now - 3600000,
      updatedAt: now - 30000,
      summary: "Checking the recovery path after cancellation",
      tokens: 42000,
      idempotencyKey: "one",
      dispatchState: "submitted",
    },
    {
      id: "job-two",
      version: 1,
      title: "Prepare the release notes",
      request: "Prepare the release notes",
      projectId: "one",
      status: "waiting",
      goalId: "goal-two",
      taskIds: ["task-three"],
      sessionIds: ["session-two"],
      progress: { done: 1, total: 2 },
      createdAt: now - 3200000,
      updatedAt: now - 120000,
      summary: "The draft is ready for your review",
      tokens: 12000,
      idempotencyKey: "two",
      dispatchState: "submitted",
    },
  ],
  memory: [
    {
      id: "memory-one",
      version: 1,
      createdAt: now - 86400000,
      updatedAt: now,
      kind: "rule",
      text: "Let me finish speaking before you reply.",
      scope: "voice",
      source: "typed",
      quote: "Let me finish speaking before you reply.",
      active: true,
      forbiddenTerms: [],
    },
    {
      id: "memory-two",
      version: 1,
      createdAt: now - 86400000,
      updatedAt: now,
      kind: "profile",
      text: "Prefer concise updates with source evidence.",
      scope: "all",
      source: "typed",
      quote: "Prefer concise updates with source evidence.",
      active: true,
      forbiddenTerms: [],
    },
  ],
  threads: [
    {
      id: "thread-one",
      version: 1,
      createdAt: now - 3600000,
      updatedAt: now,
      summary: "",
      projectId: "one",
    },
    {
      id: "thread-global",
      version: 1,
      createdAt: now - 3600000,
      updatedAt: now,
      summary: "",
    },
  ],
  activity: [
    {
      id: "act-one",
      version: 1,
      createdAt: now - 60000,
      updatedAt: now,
      kind: "task.started",
      summary: "Started checking session recovery",
      jobId: "job-one",
      sessionId: "session-one",
    },
    {
      id: "act-two",
      version: 1,
      createdAt: now - 120000,
      updatedAt: now,
      kind: "job.waiting",
      summary: "Release note draft is waiting for your review",
      jobId: "job-two",
    },
  ],
  notes: [
    {
      id: "note-one",
      title: "Today's progress",
      body: "## Session recovery\n\nCancellation checks are running. The release notes are ready for your review.\n\nNo changes have been published.",
      tags: ["assistant"],
      createdAt: now,
      updatedAt: now,
    },
  ],
  trash: [
    {
      id: "jobs:old-job",
      kind: "jobs",
      projectId: "one",
      title: "An earlier research request",
      deletedAt: now - 600000,
      expiresAt: now + 6 * 86400000,
    },
  ],
  presence: { state: "present", since: now - 60000, updatedAt: now },
  usage: {
    day: "2026-11-02",
    chiefTokens: 21000,
    workerTokens: 54000,
    total: 75000,
    mode: "run",
    estimated: true,
  },
  keepAwake: { supported: true, requested: false, active: false },
  paused: false,
  lastHeartbeatAt: now - 12000,
  briefing: {
    id: "brief-one",
    projectIds:["one"],
    text: "Recovery checks are running. The release note draft is waiting for your review.",
    createdAt: now,
  },
  capabilities: { jobs: true, chief: true, notes: true, quickNotes:true,quickAutomations:true, conversations: true },
};

if(new URLSearchParams(location.search).has("redesign-empty")){
 snapshot.jobs=[];snapshot.threads=[];snapshot.activity=[];snapshot.notes=[];snapshot.memory=[];snapshot.trash=[];snapshot.briefing=null;
}
const completionFixture=new URLSearchParams(location.search).has("completion");
if(completionFixture){snapshot.usage.cacheUsage={scope:"worker-turns",measuredTurns:2,totalTurns:4,percentageTurns:1,cacheReadTokens:12000,cacheHitPercent:35,complete:false};snapshot.jobs=snapshot.jobs.slice(0,1);}
const requestedName = new URLSearchParams(location.search).get("name");
const briefingFixture=new URLSearchParams(location.search).has("briefing");
const manualFixture=new URLSearchParams(location.search).has("manual");
const privacyFixture=new URLSearchParams(location.search).has("privacy");
const multiFixture=new URLSearchParams(location.search).has("multi");
const deletionFixture=new URLSearchParams(location.search).has("delete-bundle");
let deletionUncertain=false;
const deletedFixtureJobs=new Map<string,AssistantSnapshot["jobs"][number]>();
if(deletionFixture){snapshot.jobs=snapshot.jobs.slice(0,1);snapshot.jobs[0].goalId=`assistant-${snapshot.jobs[0].id}`;}
let uncertainJobSaved=false;
let uncertainNoteSaved=false;
let uncertainQuickSaved=false;
const deletedFixtureNotes=new Map<string,AssistantSnapshot["notes"][number]>();let fixtureRestoreAttempts=0;
if(privacyFixture){
 snapshot.jobs.push({...snapshot.jobs[0],id:"secret-job",projectId:"hidden",title:"Secret project request",request:"Secret source request",summary:"Secret source summary",taskIds:["secret-task"],sessionIds:["secret-session"]});
 snapshot.threads.push({id:"secret-thread",projectId:"hidden",version:1,createdAt:now,updatedAt:now,summary:"Secret thread"});
 snapshot.activity.push({id:"secret-activity",jobId:"secret-job",kind:"job.started",summary:"Secret source activity",version:1,createdAt:now,updatedAt:now});
 snapshot.trash.push({id:"jobs:secret-trash",kind:"jobs",projectId:"hidden",title:"Secret deleted request",deletedAt:now,expiresAt:now+86400000});
 snapshot.briefing={id:"private-briefing",text:"Secret mixed project briefing",projectIds:["one","hidden"],createdAt:now};
}
snapshot.manualPolicy={enabled:manualFixture,version:1,projectIds:manualFixture?["one","hidden"]:[]};
snapshot.manualGrants=manualFixture?[{id:"manual-grant",sessionId:"manual-enrolled",title:"Review the deployment draft",version:2,active:true,
 source:{projectId:"one",executionCwd:"/fixture",harness:"codex",model:"fixture",modelSettings:{},runtimeMode:"supervised"},sourceToken:"b".repeat(64),enrolledAt:now-60000,updatedAt:now-10000}]:[];
const manualCandidates=manualFixture?[
 {sessionId:"manual-enrolled",projectId:"one",title:"Review the deployment draft",sourceToken:"a".repeat(64),eligible:true,enrolledSourceChanged:true},
 {sessionId:"manual-owner",projectId:"one",title:"Plan the dashboard improvements",sourceToken:"c".repeat(64),eligible:true},
 {sessionId:"manual-review",projectId:"one",title:"Independent task review",sourceToken:"d".repeat(64),eligible:false,reason:"This conversation has a canonical task, planner, review, automation, steward or Crew owner."},
 {sessionId:"manual-secret",projectId:"hidden",title:"Secret conversation",sourceToken:"e".repeat(64),eligible:true}
]:[];
const manualResponse=()=>({manual:{policy:snapshot.manualPolicy!,grants:snapshot.manualGrants!,candidates:manualCandidates}});
if(manualFixture){snapshot.profile.autonomy="chief";snapshot.jobs=[];}
if(briefingFixture){
 snapshot.profile.voiceSetupComplete=true;
 snapshot.lastSpokenLanguage="en";
 if(new URLSearchParams(location.search).has("language-unknown"))snapshot.lastSpokenLanguage=null;
 snapshot.jobs.forEach(job=>{job.goalId=`assistant-${job.id}`;});
 snapshot.automaticPresence={state:"present",supported:true,since:now,updatedAt:now,idleMs:0};snapshot.effectivePresence="present";
 if(new URLSearchParams(location.search).get("presence")==="unknown"){
  snapshot.automaticPresence={state:"unknown",supported:false,since:now,updatedAt:now};snapshot.effectivePresence="unknown";
 }
}
if(new URLSearchParams(location.search).has("chief-blocked")){snapshot.profile.autonomy="chief";snapshot.chiefReview={blocked:true,message:"The last reasoning result is uncertain. Inspect History, then retry review."};}
if (requestedName?.trim())
  snapshot.profile.name = requestedName.trim().slice(0, 80);
if(new URLSearchParams(location.search).has("policy"))Object.assign(snapshot.profile,{activeStart:22,activeEnd:6,idleMinutes:10,awayMinutes:60,notificationAway:"urgent",nudgeLimit:0});
if(new URLSearchParams(location.search).has("owner-questions"))snapshot.ownerQuestions=[{
 id:"fixture-owner-choice",version:1,jobId:"job-one",projectIds:["one"],origin:"chief",sourceToken:"a".repeat(64),sourceCurrent:true,status:"open",createdAt:now,updatedAt:now,
 prompt:{requestId:1,occurrenceId:"fixture-choice-occurrence",title:"Recovery scope",behavior:"nonBlocking",questions:[{id:"host-scope",prompt:"How should the recovery change be delivered?",multiSelect:false,allowCustom:true,options:[{id:"host-small",label:"Small safe change",description:"Preserve saved settings and verify retries."},{id:"host-complete",label:"Complete the existing requirement",description:"Keep the same approvals and review every affected path."}]}]},
},{id:"fixture-voice-choice",version:1,jobId:null,threadId:"thread-global",ownerMessageId:"fixture-accepted-owner",projectIds:[],origin:"voice-proposal",sourceToken:"b".repeat(64),sourceCurrent:true,status:"open",createdAt:now,updatedAt:now,prompt:{requestId:2,occurrenceId:"fixture-voice-occurrence",title:"Saved voice choice",behavior:"nonBlocking",questions:[{id:"host-voice",prompt:"Which result should I prepare for your return?",multiSelect:false,allowCustom:false,options:[{id:"host-summary",label:"A short status note"},{id:"host-plan",label:"A reviewed work plan"}]}]}}];
if(new URLSearchParams(location.search).has("question-presentation")){
 snapshot.ownerQuestions=[];
 saveOwnerQuestionPresentation(localStorage,{format:1,environmentId:"fixture-local-host",input:{op:"questions.present",threadId:"thread-one",ownerMessageId:"pending-owner",requestId:"pending-voice-presentation",causalContextId:"fixture-captured-context",contextProjectIds:["one"],title:"Retained planning choice",questions:[{prompt:"Which recovery plan should I prepare?",multiSelect:false,allowCustom:false,options:[{label:"Preserve the existing scope"},{label:"Review the complete plan"}]}]}});
}
const messages: AssistantMessage[] = [
  {
    id: "global-message",
    version: 1,
    createdAt: now - 120000,
    updatedAt: now - 120000,
    threadId: "thread-global",
    role: "user",
    via: "text",
    text: "Nightly follow-up across projects",
    jobIds: [],
  },
  {
    id: "message-one",
    version: 1,
    createdAt: now - 600000,
    updatedAt: now - 600000,
    threadId: "thread-one",
    role: "user",
    via: "voice",
    text: "Keep an eye on recovery and prepare the release notes.",
    jobIds: ["job-one", "job-two"],
  },
  {
    id: "message-two",
    version: 1,
    createdAt: now - 590000,
    updatedAt: now - 590000,
    threadId: "thread-one",
    role: "assistant",
    via: "text",
    text: "I have two jobs. Recovery checks are running, and the release notes will wait for your review before publishing.",
    jobIds: ["job-one", "job-two"],
  },
];
if(privacyFixture)messages.push({id:"secret-message",threadId:"secret-thread",text:"Secret transcript source",role:"assistant",via:"text",version:1,createdAt:now,updatedAt:now,jobIds:["secret-job"]},
 {id:"secret-linked-global",threadId:"thread-global",text:"Secret linked global source",role:"assistant",via:"text",version:1,createdAt:now,updatedAt:now,jobIds:["secret-job"]});
export async function hostToolRequest(
  _cwd: string,
  _capability: string,
  _method: string,
  input: any,
) {
  if(_method==="environment.describe")return {environmentId:"fixture-local-host"};
  if(_method==="goals.list")return briefingFixture?[{id:"assistant-job-two",projectIds:["one"],status:"awaiting-approval",plan:{tasks:[{id:"task-review",title:"Review release notes"}]},updatedAt:now}]:[];
  if(_method==="desktop.helper.request")return {phase:"missing"};
  if (_method === "sessions.get")
    return {
      projectId: "one",
      revision: 1,
      status: input.sessionId === "session-two" ? "idle" : "running",
      updatedAt: now - 12000,
      session: {
        id: input.sessionId,
        title:
          input.sessionId === "session-one"
            ? "Recovery implementation"
            : input.sessionId === "session-compact"
              ? "Recovery checks"
              : "Release notes review",
        cwd: "/fixture",
        harness: "codex",
        model: "fixture",
        blocks: [],
        busy: input.sessionId !== "session-two",
        context: {
          used:
            input.sessionId === "session-one"
              ? 42000
              : input.sessionId === "session-compact"
                ? 200000
                : 420000,
          window: 1000000,
        },
        managedBy: {
          assistant: true,
          jobId: input.sessionId === "session-two" ? "job-two" : "job-one",
          managedAt: now - 3600000,
        },
      },
    };
  if(_method==="desktop.helper.request")return {phase:input.op==="prepare"?"preparing":"missing",...(input.op==="prepare"?{stage:"building"}:{})};
  if (_method === "desktop.request")
    return {
      configuration: {
        enabled: false,
        binaryPath: "",
        binarySha256: "",
        allowedApps: [],
        allowPhysicalInput: false,
        version: 0,
      },
      status: {
        installed: new URLSearchParams(location.search).has("desktop"),
        verified: new URLSearchParams(location.search).has("desktop"),
        enabled: new URLSearchParams(location.search).has("desktop") && input.op!=="stop",
        stopped: input.op==="stop",
        active: new URLSearchParams(location.search).has("desktop") && input.op!=="stop",
        ...(new URLSearchParams(location.search).has("desktop")&&input.op!=="stop"?{currentAction:{app:"Notepad",action:"set-value"}}:{}),
        upstreamRef: "fixture",
        protocol: "2.5",
      },
    };
  switch (input.op) {
    case "questions.present":{
      (window as any).__presentationRequest=structuredClone(input);
      const existing=snapshot.ownerQuestions?.find(question=>question.id==="recovered-presentation");if(existing)return{ownerQuestion:existing};
      const ownerQuestion={id:"recovered-presentation",version:1,jobId:null,threadId:input.threadId,ownerMessageId:input.ownerMessageId,projectIds:["one"],origin:"voice-proposal" as const,sourceToken:"c".repeat(64),sourceCurrent:true,status:"open" as const,createdAt:now,updatedAt:now,prompt:{requestId:3,occurrenceId:"recovered-presentation-occurrence",title:input.title,behavior:"nonBlocking" as const,questions:input.questions.map((question,index)=>({...question,id:`canonical-recovered-${index}`,options:question.options.map((option,n)=>({...option,id:`canonical-option-${n}`}))}))}};
      snapshot.ownerQuestions=[...(snapshot.ownerQuestions??[]),ownerQuestion];return{ownerQuestion};
    }
    case "questions.get":{
      const ownerQuestion=snapshot.ownerQuestions?.find(question=>question.id===input.id)??null;
      return{ownerQuestion,...(ownerQuestion?.lastOwnerAction?.requestId===input.requestId?{ownerQuestionReceipt:ownerQuestion.lastOwnerAction}:{})};
    }
    case "questions.answer":case "questions.snooze":{
      const question=snapshot.ownerQuestions?.find(question=>question.id===input.id);if(!question||question.version!==input.expectedVersion)throw new Error("Question changed");
      const receipt={requestId:input.requestId,kind:input.op==="questions.answer"?"answer" as const:"snooze" as const,version:question.version+1,at:Date.now(),input};
      question.version=receipt.version;question.lastOwnerAction=receipt;
      if(input.op==="questions.answer"){question.status="answered";question.answer={requestId:input.requestId,answers:input.answers,custom:input.custom,answeredAt:receipt.at,version:receipt.version};}
      else{question.status="snoozed";question.snoozedUntil=input.until;}
      (window as any).__ownerQuestionMutations=++questionMutationCount;
      if(new URLSearchParams(location.search).has("question-lost")&&!questionAckLost){questionAckLost=true;throw new Error("Connection interrupted after question commit");}
      return{ownerQuestion:question,ownerQuestionReceipt:receipt};
    }
    case "notes.delete":{
      const note=snapshot.notes.find(note=>note.id===input.id)!;const trashId=`notetrash:backup-${note.id}`;deletedFixtureNotes.set(trashId,note);snapshot.notes=snapshot.notes.filter(item=>item.id!==note.id);snapshot.trash.push({id:trashId,kind:"notetrash",title:note.title,deletedAt:now,expiresAt:now+604800000});return{ok:true,trashId};
    }
    case "notes.get":return {note:new URLSearchParams(location.search).has("quick-deleted")?null:snapshot.notes.find(note=>note.id===input.id)??null};
    case "notes.save":{
      const note={id:input.id,title:input.title,body:input.body,tags:["assistant"],updatedAt:now,createdAt:now};
      snapshot.notes.push(note);
      if(new URLSearchParams(location.search).has("note-retry")&&!uncertainNoteSaved){uncertainNoteSaved=true;throw new Error("Connection interrupted after note commit");}
      return {note};
    }
    case "jobs.create":{
      const saved=snapshot.jobs.find(job=>job.idempotencyKey===input.idempotencyKey);
      if(saved)return {job:saved};
      if(input.kind==="quick"&&input.quickAction.kind==="automation"){
        const {goalId:_goal,...base}=snapshot.jobs[0];
        const prior=snapshot.jobs.find(job=>job.idempotencyKey===input.idempotencyKey);if(prior)return{job:prior};
        document.body.dataset.automationCreates=String(Number(document.body.dataset.automationCreates??0)+1);
        const id=`automation-${input.idempotencyKey}`;
        const job={...base,id:`quick-${input.idempotencyKey}`,kind:"quick" as const,title:input.title,request:input.request,projectId:input.quickAction.projectId,projectIds:[input.quickAction.projectId],status:"done" as const,taskIds:[],sessionIds:[],progress:{done:1,total:1},summary:"The reviewed scheduled automation was created. It has not run.",tokens:0,idempotencyKey:input.idempotencyKey,quickAction:input.quickAction,quickResult:{automationId:id},createdAt:now,updatedAt:now};
        snapshot.jobs.push(job);fixtureAutomations.push({id,projectId:input.quickAction.projectId});
        if(new URLSearchParams(location.search).has("quick-automation")&&!uncertainQuickSaved){uncertainQuickSaved=true;throw new Error("Automation receipt lost after commit");}return{job};
      }
      if(input.kind==="quick"){
        if("projectId" in input||"projectIds" in input)throw new Error("Quick request must have no project fields");
        document.body.dataset.quickCreates=String(Number(document.body.dataset.quickCreates??0)+1);
        const {goalId:_goal,...base}=snapshot.jobs[0];const noteId=`note-${input.idempotencyKey}`;
        const job={...base,id:`quick-${input.idempotencyKey}`,kind:"quick" as const,title:input.title,request:input.request,projectId:null,projectIds:[],status:"done" as const,taskIds:[],sessionIds:[],progress:{done:1,total:1},summary:"The reviewed global note was created.",tokens:0,idempotencyKey:input.idempotencyKey,quickAction:input.quickAction,quickResult:{noteId},createdAt:now,updatedAt:now};
        snapshot.jobs.push(job);snapshot.notes.push({id:noteId,title:input.quickAction.title,body:input.quickAction.body,tags:["assistant"],createdAt:now,updatedAt:now});
        if(new URLSearchParams(location.search).has("quick")&&!uncertainQuickSaved){uncertainQuickSaved=true;throw new Error("Quick receipt lost after note commit");}return{job};
      }
      const job={...snapshot.jobs[0],id:`created-${input.idempotencyKey}`,version:1,title:input.title,request:input.request,projectId:input.projectId,projectIds:input.projectIds??[input.projectId],status:"queued" as const,goalId:undefined,taskIds:[],sessionIds:[],progress:{done:0,total:0},summary:"",tokens:0,idempotencyKey:input.idempotencyKey,dispatchState:"pending" as const,createdAt:now,updatedAt:now};
      snapshot.jobs.push(job);
      if(multiFixture&&!uncertainJobSaved){uncertainJobSaved=true;throw new Error("Connection interrupted after acceptance");}
      return {job};
    }
    case "manual.list":return manualResponse();
    case "manual.policy":snapshot.manualPolicy={enabled:input.enabled,version:snapshot.manualPolicy!.version+1,projectIds:input.projectIds};return manualResponse();
    case "manual.enroll":await new Promise(resolve=>setTimeout(resolve,8000));return manualResponse();
    case "manual.revoke":snapshot.manualGrants=snapshot.manualGrants!.map(grant=>grant.id===input.id?{...grant,active:false,version:grant.version+1}:grant);return manualResponse();
    case "chief.retry":
      snapshot.chiefReview=undefined;
      return {ok:true};
    case "snapshot":
      return { snapshot: new URLSearchParams(location.search).has("question-lost")?{...snapshot,ownerQuestions:snapshot.ownerQuestions?.map(question=>{const {lastOwnerAction:_receipt,...value}=question;return value;})}:snapshot };
    case "briefing.daily":{const exact=completionFixture?{id:`fixture-daily-${input.day}`,text:"Today's saved fixture summary: the recovery checks are complete; the current worker still needs owner review.",createdAt:new Date(`${input.day}T00:05:00`).getTime(),projectIds:["one"]}:snapshot.briefing;return {ok:true,snapshot:{...structuredClone(snapshot),briefing:exact}};}
    case "jobs.get":return {job:snapshot.jobs.find(job=>job.id===input.id)};
    case "jobs.priority":{const job=snapshot.jobs.find(job=>job.id===input.id)!;if(job.kind==="quick")throw new Error("Fixture project only");job.priority=input.priority;job.version++;return {job};}
    case "jobs.replan":{(window as any).__fixtureReplanCalls=((window as any).__fixtureReplanCalls??0)+1;throw new Error("Fixture: replan result is unconfirmed");}
    case "presence.set":snapshot.presence={state:input.state,since:now,updatedAt:now};return {ok:true};
    case "conversations.retention":snapshot.conversationRetentionDays=input.days;return {ok:true};
    case "threads.clear":{
      const thread=snapshot.threads.find(thread=>thread.id===input.threadId)!;
      if(thread.version!==input.expectedVersion)throw new Error("Fixture thread changed");
      for(let index=messages.length-1;index>=0;index--)if(messages[index].threadId===thread.id)messages.splice(index,1);
      thread.version++;return {thread};
    }
    case "projects.list":
      return { projects: [{ id: "one", path: "/fixture", name: "MonoCode" },...(multiFixture?[{id:"two",path:"/backend",name:"Backend"}]:[]),...(manualFixture||privacyFixture?[{id:"hidden",path:"/secret",name:"Secret project"}]:[])] };
    case "threads.summary.refresh":{
      if(!summaryFixture)throw new Error("Summary refresh is not part of this fixture");
      summaryRefreshRequests.push(structuredClone(input));(window as any).__summaryRefreshRequests=summaryRefreshRequests;
      const thread=snapshot.threads.find(thread=>thread.id===input.threadId)!;
      if(summaryRefreshReceipts.has(input.requestId))return{thread:structuredClone(thread)};
      summaryRefreshReceipts.add(input.requestId);summaryRefreshMutations++;(window as any).__summaryRefreshMutations=summaryRefreshMutations;
      thread.version++;thread.summaryState={status:summaryRefreshMutations===1?"working":summaryRefreshMutations===2?"blocked":"ready",updatedAt:now+summaryRefreshMutations,message:"Private fixture diagnostic must never appear"};
      if(summaryRefreshMutations===3){thread.summary="Private fixture summary must never appear";thread.summaryProof={id:"fixture-summary-proof",version:1,projectIds:["one"],throughMessageId:"msg-one",messageCount:20,createdAt:now+3,inputTruncated:false,omittedMessages:0};}
      if(summaryRefreshMutations===1)throw new Error("Fixture summary ACK lost after commit");
      return{thread:structuredClone(thread)};
    }
    case "threads.messages":
      return {
        ...(summaryFixture?{thread:(()=>{const thread=snapshot.threads.find(thread=>thread.id===input.threadId)!;thread.summaryState??={status:"pending",updatedAt:now};return structuredClone(thread);})()}:{}),
        messages: messages.filter(
          (message) => message.threadId === input.threadId,
        ),
      };
    case "conversations.search":
      return {
        messages: messages.filter((message) =>
          message.text.toLowerCase().includes(input.query.toLowerCase()),
        ),
      };
    case "memory.search":
      return {
        entries: snapshot.memory.filter((entry) =>
          entry.text.toLowerCase().includes(input.query.toLowerCase()),
        ),
      };
    case "jobs.deleteReview":{
      const job=snapshot.jobs.find(job=>job.id===input.id)!;
      return {deleteReview:{jobId:job.id,jobVersion:job.version,sourceToken:"a".repeat(64),goalId:job.goalId,projectIds:[job.projectId],tasks:[{id:"task-one",title:"Inspect actual recovery source",projectId:job.projectId,status:"running",updatedAt:now},{id:"task-two",title:"Verify the provider handoff contract",projectId:job.projectId,status:"queued",updatedAt:now}]}};
    }
    case "jobs.deleteAbort":{
      const job=snapshot.jobs.find(job=>job.id===input.id)!;job.version++;job.status="paused";job.pendingTaskDeletion=false;job.awaitingOwnerRestart=true;job.summary="The job and tasks were kept paused for your review.";return{job};
    }
    case "jobs.control": {
      const job = snapshot.jobs.find((job) => job.id === input.id)!;
      if(input.action==="delete"){
        if(input.expectedVersion!==job.version)throw new Error("Job changed; refresh before changing it.");
        if(input.deleteTasks&&deletionFixture&&!new URLSearchParams(location.search).has("delete-success")&&!deletionUncertain){deletionUncertain=true;job.version++;job.status="waiting";job.pendingTaskDeletion=true;job.summary="Original retirement is unknown. Keep the job and tasks for review.";throw new Error("Original retirement is unknown. No task was deleted.");}
        const id=`jobs:${job.id}`;job.version++;job.status="cancelled";deletedFixtureJobs.set(id,structuredClone(job));snapshot.jobs=snapshot.jobs.filter(row=>row.id!==job.id);snapshot.trash.push({id,title:job.title,kind:"jobs",projectId:job.projectId,projectIds:job.projectId?[job.projectId]:[],deletedAt:now,expiresAt:now+7*86400000,...(input.deleteTasks?{deletedTaskCount:2}:{})});return{job};
      }
      job.status =
        input.action === "stop"
          ? "cancelled"
          : input.action === "pause"
            ? "paused"
            : "running";
      job.version++;
      return { job };
    }
    case "pauseAll":
      snapshot.paused = true;
      return { ok: true };
    case "resumeAll":
      snapshot.paused = false;
      return { ok: true };
    case "profile.update":
      Object.assign(snapshot.profile, input.patch, {
        version: snapshot.profile.version + 1,
      });
      return { profile: snapshot.profile };
    case "memory.save": {
      const entry = snapshot.memory.find((entry) => entry.id === input.id);
      if (entry) Object.assign(entry, input, { version: entry.version + 1 });
      return { memory: entry };
    }
    case "trash.restore":
      document.body.dataset.lastRestore=input.id;
      if(new URLSearchParams(location.search).has("note-trash")&&++fixtureRestoreAttempts===1)throw new Error("Temporary exact restore failure");
      if(deletedFixtureNotes.has(input.id)){snapshot.notes.push(deletedFixtureNotes.get(input.id)!);deletedFixtureNotes.delete(input.id);}
      if(deletedFixtureJobs.has(input.id)){const job=deletedFixtureJobs.get(input.id)!;job.status="paused";job.awaitingOwnerRestart=true;job.pendingTaskDeletion=false;job.version++;snapshot.jobs.push(job);deletedFixtureJobs.delete(input.id);}
      snapshot.trash = snapshot.trash.filter((entry) => entry.id !== input.id);
      return { ok: true };
    default:
      return { ok: true };
  }
}
const fixtureAutomations:any[]=[];
export async function captureAssistantHostRead(expectedEnvironmentId?:string){
 if(expectedEnvironmentId&&expectedEnvironmentId!=="fixture-local-host")throw new Error("The approval's Host changed. Check again.");
 return {environmentId:"fixture-local-host",automations:async()=>fixtureAutomations,snapshot:async()=>structuredClone(snapshot),projects:async()=>(await hostToolRequest("","","",{op:"projects.list"})).projects,
  goals:async()=>hostToolRequest("","","goals.list",{}),session:async(sessionId:string)=>hostToolRequest("","","sessions.get",{sessionId,preview:true,summary:true})};
}
export function ModelPicker(props:{model:string;values:Record<string,string>;inheritChoice?:{label:string;selected:boolean;onSelect:()=>void};onChange:(harness:string,model:string)=>void;onSettingsChange:(value:Record<string,string>)=>void}) {
  // Synthetic picker port: these labels never contact a provider or choose a
  // production model. Production retains the existing ModelPicker adapter.
  return <div><Button onClick={()=>props.onChange("codex",props.inheritChoice?"fixture-role-model":"fixture-worker-model")}>{props.inheritChoice?.selected?props.inheritChoice.label:props.model||"Fixture model"}</Button>{props.inheritChoice&&!props.inheritChoice.selected&&<Button onClick={props.inheritChoice.onSelect}>{props.inheritChoice.label}</Button>}</div>;
}
/** Synthetic playback lifecycle only; no media device, OS speech or provider. */
export async function listenAssistantBriefing(_id:string,signal:AbortSignal,playback:(playing:boolean)=>void){
 playback(true);await new Promise<void>(resolve=>{const timer=setTimeout(resolve,6000);signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});});playback(false);
}
export function VoiceSetupSteps() {
  return (
    <p>
      Voice provider checks are outside this Room fixture. The microphone
      remains closed.
    </p>
  );
}

let fixtureDetached=false;
export async function prepareAssistantSessionDetach(input:any){if(!input.current())throw new Error("Fixture source changed");return {detached:fixtureDetached,detach:async()=>{(window as any).__fixtureDetachCalls=((window as any).__fixtureDetachCalls??0)+1;if(new URLSearchParams(location.search).get("session-controls")==="unknown"){fixtureDetached=true;throw new Error("Fixture: supervision receipt lost");}await new Promise<void>(resolve=>{(window as any).__finishFixtureDetach=()=>{fixtureDetached=true;resolve();};});}};}

export class AssistantSessionDetachError extends Error{constructor(message:string,readonly submitted:boolean){super(message);}}
