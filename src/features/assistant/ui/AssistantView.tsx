import { useEffect, useId, useRef, useState } from "react";
import { DesktopControlSettings } from "../../host-tools/DesktopControlSettings";
import type {
  AssistantActivity,
  AssistantJob,
  AssistantMemory,
  AssistantMessage,
  AssistantNote,
  AssistantProfilePatch,
  AssistantRequest,
  AssistantSnapshot,
  AssistantTrash,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Badge } from "../../../shared/ui/Badge";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/ui/InlineError";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Popover } from "../../../shared/ui/Popover";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import {
  MoreHorizontal,
  Settings,
  Square,
  Trash2,
  RefreshCw,
  X,
  Plus,
  ExternalLink,
  ChevronDown,
} from "../../../shared/ui/icons";
import {
  assistantIdentity,
  assistantRequest as ownerRequest,
  operationId,
  useAssistantSnapshot,
} from "../model/assistantClient";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { AssistantBriefingCard } from "./AssistantBriefingCard";
import type { AssistantGoalApprovalTarget } from "../model/assistantBriefing";
import { AssistantSessions } from "./AssistantSessions";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import { useManualSupervision, visibleAssistantProjects, type ManualSupervisionController } from "../model/assistantManual";
import { useVisibleProjects } from "../../group-lock/hooks/useGroupLock";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import { assistantPrivacyScope, canReadAssistantBriefing, projectAssistantSnapshot, visibleAssistantMessages, type AssistantPrivacyScope } from "../model/assistantPrivacy";
import { AssistantJobBatch, assistantJobDraftIdentity, assistantQuickDraftIdentity, assistantJobDraftVisible, assistantJobDraftReady, changeAssistantJobDraftKind, assistantJobProjectIds, assistantJobVisible, selectAssistantJobProjects, type AssistantJobDraft } from "../model/assistantJobs";
import { AssistantQuickNoteFields } from "./AssistantQuickNoteFields";
import { AssistantQuickAutomationFields } from "./AssistantQuickAutomationFields";
import { captureAssistantHostRead } from "../model/assistantHostRead";
import { AssistantNoteDraft } from "../model/assistantNoteDraft";
import {verifiedAssistantJobDeleteReview,type AssistantJobTasksTarget} from "../model/assistantJobDeletion";
import type {AssistantAutomationTarget} from "../model/assistantAutomationReveal";
import { AssistantSetup } from "./AssistantSetup";
import { AssistantProfileFields } from "./AssistantProfileFields";
import { AssistantOwnerQuestions } from "./AssistantOwnerQuestions";
import {hasAssistantSummaryRefresh,refreshAssistantSummary} from "../model/assistantSummaryRefresh";
import styles from "./AssistantView.module.css";

const tabs = [
  "Today",
  "Conversations",
  "Jobs",
  "Sessions",
  "Notes",
  "History",
  "Memory",
] as const;
type View = (typeof tabs)[number];
type OwnerRequest=typeof ownerRequest;
type Project = { id?: string; path: string; name: string };
export type AssistantViewProps = {
  initialTab?: Lowercase<View> | "settings";
  navigationToken?: number;
  projectPath?: string;
  sessionId?: string;
  projects?: readonly Project[];
  visibleProjectPaths?: readonly string[];
  /** Only pass an identity captured with the displayed Room source. */
  environmentId?: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onOpenGoal?: (target: AssistantGoalApprovalTarget) => void | Promise<void>;
  onOpenAutomation?: (target:AssistantAutomationTarget)=>void|Promise<void>;
  onReviewJobTasks?:(target:AssistantJobTasksTarget)=>void|Promise<void>;
  onOpenProject?: (path: string) => void | Promise<void>;
  onClose?: () => void;
};
const finished = (job: AssistantJob) =>
  ["done", "failed", "cancelled"].includes(job.status);
function statusLabel(status: AssistantJob["status"]) {
  return t(
    {
      queued: "Queued",
      planning: "Planning",
      running: "Running",
      stalled: "Stalled",
      waiting: "Waiting for you",
      done: "Done",
      failed: "Failed",
      paused: "Paused",
      cancelled: "Cancelled",
    }[status],
  );
}
function jobStatusLabel(job:AssistantJob){
  return job.kind==="quick"&&job.status==="done"?(job.quickAction.kind==="note"&&job.quickResult?.noteId?t("Note saved"):job.quickAction.kind==="automation"&&job.quickResult?.automationId?t("Automation created"):statusLabel(job.status)):statusLabel(job.status);
}
function activityKindLabel(kind: string) {
  const labels: Record<string, string> = {
    "budget.exhausted": "Budget exhausted",
    "chief.woke": "Status reviewed",
    "conversation.replied": "Conversation reply",
    "job.received": "Job received",
    "job.replanned": "Job replanned",
    "job.started": "Job started",
    "job.unknown": "Dispatch status unknown",
    "job.pause": "Job paused",
    "job.resume": "Job resumed",
    "job.stop": "Job stopped",
    "memory.saved": "Memory saved",
    "profile.updated": "Settings updated",
    "task.started": "Task started",
    "job.waiting": "Waiting for you",
  };
  return t(labels[kind] ?? "Activity");
}
const date = (at: number) => new Date(at).toLocaleString();
const day = (at: number) => new Date(at).toLocaleDateString();
const matches = (query: string, ...values: (string | undefined)[]) =>
  !query.trim() ||
  values.some((value) =>
    value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
type Pending = { key: string; label: string } | null;
type JobDraft = Omit<AssistantJobDraft,"idempotencyKey"|"projectIds"> & {projectIds:string[];key:string};

function draftText(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function AssistantView(props: AssistantViewProps) {
  const locale = useLocale();
  const {
    snapshot: canonicalSnapshot,
    environmentId: snapshotEnvironmentId,
    loading,
    error: readError,
    refresh,
  } = useAssistantSnapshot();
  const environmentId=snapshotEnvironmentId??undefined;
  const assistantRequest:OwnerRequest=(input,expectedEnvironmentId=environmentId)=>{
    if(!expectedEnvironmentId)return Promise.reject(new Error("The original Host could not be verified. Keep this draft and reconnect its original computer."));
    return ownerRequest(input,expectedEnvironmentId);
  };
  const [hostProjects, setHostProjects] = useState<readonly Project[] | null>(null);
  const projectBindingEnvironment = useRef<string | undefined>(undefined);
  const [projectReadError, setProjectReadError] = useState("");
  const projectReadEpoch = useRef(0);
  async function readProjects() {
    const epoch = ++projectReadEpoch.current; setProjectReadError("");
    try {
      const owner = await captureAssistantHostRead(props.environmentId??environmentId);
      const result = await owner.projects();
      if (epoch === projectReadEpoch.current) { projectBindingEnvironment.current = owner.environmentId; setHostProjects(result); }
    } catch (cause) { if (epoch === projectReadEpoch.current) setProjectReadError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void readProjects(); return () => { projectReadEpoch.current++; }; }, [props.environmentId,environmentId]);
  const boundProjects = environmentId && projectBindingEnvironment.current !== environmentId ? null : hostProjects;
  const unlockedProjects = useVisibleProjects(boundProjects ?? props.projects ?? [], project => project.path);
  const projects = visibleAssistantProjects(unlockedProjects, props.visibleProjectPaths ?? props.projects?.map(project => project.path) ?? (props.projectPath ? [props.projectPath] : []));
  const projectPrivacy = assistantPrivacyScope(boundProjects, projects, canonicalSnapshot);
  const privacy = { ...projectPrivacy, key: JSON.stringify([environmentId ?? null, props.environmentId ?? null, projectPrivacy.key]) };
  const snapshot = projectAssistantSnapshot(canonicalSnapshot, privacy);
  const visibility = useRef({ projects, privacy, canonicalSnapshot });
  visibility.current = { projects, privacy, canonicalSnapshot };
  function canSeeProject(id: string) { return visibility.current.projects.some(project => project.id === id && !isProjectLocked(project.path)); }
  function canReadBriefing(source?: AssistantSnapshot) {
    const current = visibility.current;
    const candidate = source ?? current.canonicalSnapshot;
    return !!candidate && canReadAssistantBriefing(candidate, current.privacy) && (candidate.briefing?.projectIds ?? []).every(canSeeProject);
  }
  const scopeEpoch = useRef({ key: privacy.key, value: 0 });
  if (scopeEpoch.current.key !== privacy.key) scopeEpoch.current = { key: privacy.key, value: scopeEpoch.current.value + 1 };
  const identity = assistantIdentity(snapshot?.profile, locale);
  const [view, setView] = useState<View>("Today");
  const [setup, setSetup] = useState<boolean|"voice">(false);
  const [returnMessage,setReturnMessage]=useState("");
  const [settings, setSettings] = useState(false);
  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [healthAnchor, setHealthAnchor] = useState<HTMLElement | null>(null);
  const [presenceAnchor, setPresenceAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [jobProjectFilter,setJobProjectFilter]=useState("");
  const [jobDateFilter,setJobDateFilter]=useState("all");
  const [jobEdit,setJobEdit]=useState<{job:AssistantJob;mode:"priority"|"replan";environmentId:string;scopeKey:string}|null>(null);
  const [dailySummary,setDailySummary]=useState<{snapshot:AssistantSnapshot;environmentId:string;scopeKey:string;day:string}|null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [errorState, setErrorState] = useState<{ key: string; text: string; scopeKey: string } | null>(
    null,
  );
  const error = errorState?.scopeKey === privacy.key ? { ...errorState, text: t(errorState.text) } : errorState?.key === "pauseAll" ? { ...errorState, text: t("The stop request could not be confirmed. Check the Room.") } : null;
  function setError(value: { key: string; text: string } | null) { setErrorState(value ? { ...value, scopeKey: privacy.key } : null); }
  const [confirm, setConfirmState] = useState<ConfirmRequest | null>(null);
  const confirmPrivacy = useRef(privacy.key);
  function setConfirm(request: ConfirmRequest | null) { confirmPrivacy.current = privacy.key; setConfirmState(request); }
  const [undo, setUndo] = useState<{ id: string; label: string; projectId?: string; projectIds?: string[]; environmentId?:string } | null>(null);
  const [deletedNoteWithoutReceipt,setDeletedNoteWithoutReceipt]=useState<string|null>(null);
  const [restoredUndoId,setRestoredUndoId]=useState<{id:string;environmentId?:string}|null>(null);
  useEffect(()=>{
    if(!restoredUndoId)return;
    if(!undo||undo.id!==restoredUndoId.id||undo.environmentId!==restoredUndoId.environmentId){setRestoredUndoId(null);return;}
    if(pending?.key==="undo")return;
    setUndo(null);setErrorState(current=>current?.key==="undo"?null:current);setRestoredUndoId(null);
  },[restoredUndoId,undo,pending?.key]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [jobText, setJobText] = useState(() =>
    draftText("bycoda.assistant.job-draft"),
  );
  const [jobReview, setJobReview] = useState<JobDraft[] | null>(null);
  const jobBatch = useRef<AssistantJobBatch | null>(null);
  const [jobReviewFrozen, setJobReviewFrozen] = useState(false);
  const jobReviewEnvironment=useRef<string|undefined>(undefined);
  useEffect(()=>{if(jobReview&&!jobReviewFrozen)try{localStorage.setItem("bycoda.assistant.job-review",JSON.stringify({source:jobText,rows:jobReview,frozen:false}));}catch{/* Save validates durable intent before dispatch. */}},[jobReview,jobText,jobReviewFrozen]);
  const jobIntents = useRef<Record<string, string>>(
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("bycoda.assistant.job-intents") ?? "{}",
        );
      } catch {
        return {};
      }
    })(),
  );
  function jobKey(title: string, projectId: string, projectIds: readonly string[] = [projectId]) {
    const source = assistantJobDraftIdentity(title, projectId, projectIds);
    const key = jobIntents.current[source] ?? operationId();
    jobIntents.current[source] = key;
    try {
      localStorage.setItem(
        "bycoda.assistant.job-intents",
        JSON.stringify(jobIntents.current),
      );
    } catch {
      /* Keep the current intent in memory. */
    }
    return key;
  }
  function reviewIntent(draft:JobDraft){return draft.kind==="quick"&&draft.quickAction?assistantQuickDraftIdentity(draft.request,draft.title,draft.quickAction):assistantJobDraftIdentity(draft.request,draft.projectId,draft.projectIds);}
  const reviewedDraft=(draft:JobDraft):AssistantJobDraft=>({...draft,idempotencyKey:draft.key});
  const visibleDraft=(draft:JobDraft)=>assistantJobDraftVisible(reviewedDraft(draft),canSeeProject);
  function updateJobDraft(id:string,patch:Partial<JobDraft>){
    if(jobReviewFrozen||pending)return;
    setJobReview(current=>current?.map(row=>{if(row.id!==id)return row;const next={...row,...patch};if(next.kind==="quick"&&next.quickAction?.kind==="automation"){next.projectId=next.quickAction.projectId;next.projectIds=next.projectId?[next.projectId]:[];}const source=reviewIntent(next);next.key=jobIntents.current[source]??operationId();jobIntents.current[source]=next.key;try{localStorage.setItem("bycoda.assistant.job-intents",JSON.stringify(jobIntents.current));}catch{/* Retain current identity. */}return next;})??null);
  }

  const [memoryResults, setMemoryResults] = useState<AssistantMemory[] | null>(
    null,
  );
  const [memorySearching, setMemorySearching] = useState(false);
  useEffect(() => {
    if (view !== "Memory" || !query.trim()) {
      setMemoryResults(null);
      setMemorySearching(false);
      return;
    }
    let cancelled = false;
    setMemorySearching(true);
    setMemoryResults([]);
    const timer = setTimeout(() => {
      void assistantRequest({ op: "memory.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled) setMemoryResults(result.entries ?? []);
        })
        .catch((cause) => {
          if (!cancelled)
            setError({
              key: "memory.search",
              text: cause instanceof Error ? cause.message : String(cause),
            });
        })
        .finally(() => {
          if (!cancelled) setMemorySearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, query, snapshot?.memory]);
  const memoryEntries = memoryResults ?? snapshot?.memory ?? [];
  const [memoryEdit, setMemoryEdit] = useState<AssistantMemory | "new" | null>(
    null,
  );
  const [noteEdit, setNoteEdit] = useState<AssistantNote | "new" | null>(null);
  const manual = useManualSupervision(snapshot, projects, snapshot?.profile.setupComplete === true && (view === "Sessions" || settings),environmentId);
  const currentProject = projects.find(
    (project) => project.path === props.projectPath,
  );
  const defaultProjectId = currentProject?.id ?? currentProject?.path ?? "";

  useEffect(() => {
    try {
      localStorage.setItem("bycoda.assistant.job-draft", jobText);
    } catch {
      /* The in-memory draft remains available. */
    }
  }, [jobText]);
  useEffect(() => {
    const target = props.initialTab;
    if (target === "settings") setSettings(true);
    else if (target) {
      const match = tabs.find((tab) => tab.toLowerCase() === target);
      if (match) setView(match);
    }
  }, [props.initialTab, props.navigationToken]);
  useEffect(() => {
    const listener = () => setSetup(true);
    window.addEventListener("bycoda:assistant-setup", listener);
    return () => window.removeEventListener("bycoda:assistant-setup", listener);
  }, []);

  async function run(
    key: string,
    label: string,
    action: () => Promise<unknown>,
  ) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending({ key, label });
    setError(null);
    const epoch = scopeEpoch.current.value;
    try {
      await action();
      return true;
    } catch (cause) {
      if (epoch === scopeEpoch.current.value) setError({
        key,
        text: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }
  const mutate = (key: string, label: string, request: AssistantRequest) =>
    run(key, label, () => assistantRequest(request));
  async function stopEverything() {
    if(stoppingRef.current)return;
    stoppingRef.current=true;
    setStopping(true);
    setError(null);
    try {await assistantRequest({op:"pauseAll"});}
    catch(cause) {setError({key:"pauseAll",text:cause instanceof Error?cause.message:String(cause)});}
    finally {stoppingRef.current=false;setStopping(false);}
  }
  const onOpenSession = props.onOpenSession
    ? (id: string, sourceEnvironmentId = props.environmentId??environmentId) => {
        void run(`navigation:${id}`, t("Opening session..."), async () => {
          if (sourceEnvironmentId) await props.onOpenSession!(id, sourceEnvironmentId);
          else await props.onOpenSession!(id);
        });
      }
    : undefined;

  function returnToAssistant(){
    void run("presence.return",t("Preparing briefing..."),async()=>{
      setReturnMessage("");
      await assistantRequest({op:"presence.set",state:"present"});
      const now=new Date();
      const day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      await assistantRequest({op:"briefing.daily",day});
      const current=(await assistantRequest({op:"snapshot",limit:100})).snapshot;
      if(current&&!current.briefing)setReturnMessage(t("Nothing new to report."));
    });
  }

  function control(
    job: AssistantJob,
    action: "pause" | "resume" | "stop" | "delete" | "keep",
  ) {
    if (!assistantJobVisible(job, canSeeProject)) return;
    if(action==="keep"){
      void run(job.id,t("Keeping job and tasks..."),async()=>{const result=await assistantRequest({op:"jobs.deleteAbort",id:job.id,expectedVersion:job.version});if(!result.job||result.job.id!==job.id||result.job.status!=="paused"||result.job.pendingTaskDeletion||result.job.awaitingOwnerRestart!==true||result.job.projectId!==job.projectId||JSON.stringify(assistantJobProjectIds(result.job))!==JSON.stringify(assistantJobProjectIds(job)))throw new Error("Job status is unknown. Check the Room before retrying.");});return;
    }
    if (action === "delete") {
      void run(`deleteReview:${job.id}`,t("Loading..."),async()=>{
       const sourcePrivacy=privacy.key;
       let review:ReturnType<typeof verifiedAssistantJobDeleteReview>,reviewError="";
       if(job.kind!=="quick"&&job.goalId){try{const response=await assistantRequest({op:"jobs.deleteReview",id:job.id,expectedVersion:job.version});review=verifiedAssistantJobDeleteReview(job,response.deleteReview,canSeeProject);if(!review)throw new Error("The task deletion scope could not be verified. You can still delete only the job.");}catch(cause){reviewError=cause instanceof Error?cause.message:String(cause);}}
       if(sourcePrivacy!==visibility.current.privacy.key||!assistantJobVisible(job,canSeeProject))return;
       let frozenInput:Extract<AssistantRequest,{op:"jobs.control"}>|undefined;
       setConfirm({
        title: t("Delete job?"),
        message: job.title,
        confirmLabel:state=>t(state.acknowledged?"Delete job and tasks":"Delete job only"),
        acknowledge:review?{label:t("Also delete the reviewed tasks"),defaultChecked:false,required:false}:undefined,
        body:review?<div className={styles.stack}><p>{t("{p0} tasks in the canonical deletion scope",{p0:review.tasks.length})}</p>{review.tasks.map(task=><p key={task.id}><strong>{task.title}</strong> · {projectName(task.projectId)}</p>)}</div>:reviewError?<p role="alert">{t(reviewError)}</p>:undefined,
        consequences:state=>[
          t(state.acknowledged?"The job and reviewed task metadata stop first and move to Recently deleted. Sessions, branches, worktrees and working files remain.":job.kind==="quick"?"Deleting this job keeps its saved note or automation.":"The job stops first. Tasks, sessions, worktrees and changes remain."),
          t("You can restore this job from Recently deleted for seven days."),
          ...(state.acknowledged?[t("Restoring keeps the goal and tasks stopped. Review them in the task board before restarting.")]:[]),
        ],
        onConfirm: async ({acknowledged}) => {
          if (!assistantJobVisible(job, canSeeProject)) throw new Error("The selected project is no longer visible.");
          if(acknowledged&&!verifiedAssistantJobDeleteReview(job,review,canSeeProject))throw new Error("The task deletion scope could not be verified. You can still delete only the job.");
          const input:Extract<AssistantRequest,{op:"jobs.control"}>={
            op: "jobs.control",
            id: job.id,
            expectedVersion: job.version,
            action,
            ...(acknowledged?{deleteTasks:true,taskDeleteToken:review!.sourceToken}:{}),
          };
          if(frozenInput&&JSON.stringify(input)!==JSON.stringify(frozenInput))throw new Error("The deletion is pending. Keep its original task selection while checking its status.");
          frozenInput??=input;
          try{const result=await assistantRequest(frozenInput);if(!result.job||result.job.id!==job.id||result.job.status!=="cancelled"||result.job.projectId!==job.projectId||JSON.stringify(assistantJobProjectIds(result.job))!==JSON.stringify(assistantJobProjectIds(job)))throw new Error("Job status is unknown. Check the Room before retrying.");}catch(cause){await refresh();throw cause;}
          setUndo({ id: `jobs:${job.id}`, label: job.title, projectId: job.projectId ?? undefined, projectIds: assistantJobProjectIds(job),environmentId });
        },
       });
      });
    } else
      void mutate(
        job.id,
        t(
          action === "stop"
            ? "Stopping..."
            : action === "pause"
              ? "Pausing..."
              : "Resuming...",
        ),
        {
          op: "jobs.control",
          id: job.id,
          expectedVersion: job.version,
          action,
        },
      );
  }
  function reviewJobTasks(job:AssistantJob){
    void run(`tasks:${job.id}`,t("Loading..."),async()=>{
      if(job.kind==="quick"||!job.goalId||!environmentId||!assistantJobVisible(job,canSeeProject)||!props.onReviewJobTasks)throw new Error("The selected project is no longer visible.");
      await props.onReviewJobTasks({jobId:job.id,goalId:job.goalId,projectId:job.projectId,projectIds:assistantJobProjectIds(job),environmentId});
    });
  }
  async function submitJobs() {
    if (!jobReview?.length) return;
    const sourceEnvironment=jobReviewFrozen?jobReviewEnvironment.current:environmentId;
    setJobReviewFrozen(true);
    jobReviewEnvironment.current=sourceEnvironment;
    if (!jobBatch.current) jobBatch.current = new AssistantJobBatch(async request => {
      if(request.op==="jobs.create"){
        if(request.kind!=="quick"&&!assistantJobVisible(request,canSeeProject))throw new Error("The selected project is no longer visible.");
        if(request.kind==="quick"&&(request.quickAction.kind==="note"?visibility.current.canonicalSnapshot?.capabilities.quickNotes!==true:visibility.current.canonicalSnapshot?.capabilities.quickAutomations!==true||!canSeeProject(request.quickAction.projectId)))throw new Error(request.quickAction.kind==="note"?"Quick note jobs are unavailable on this Host.":"Quick automation jobs are unavailable for this project.");
      }
      if(!sourceEnvironment)throw new Error("The original Host could not be verified. Keep this draft and reconnect its original computer.");
      return ownerRequest(request,sourceEnvironment);
    });
    const result = await run("jobs.create", t("Starting jobs..."), async () => {
      localStorage.setItem("bycoda.assistant.job-review",JSON.stringify({source:jobText,rows:jobReview,frozen:true,environmentId:sourceEnvironment}));
      if(!sourceEnvironment)throw new Error("The original Host could not be verified. Keep this draft and reconnect its original computer.");
      if (!jobReview.every(visibleDraft)) throw new Error("The selected project is no longer visible.");
      await jobBatch.current!.start(jobReview.map(reviewedDraft));
      await refresh();
    });
    if (result) {
      localStorage.removeItem("bycoda.assistant.job-review");
      for (const draft of jobReview) delete jobIntents.current[reviewIntent(draft)];
      try { localStorage.setItem("bycoda.assistant.job-intents", JSON.stringify(jobIntents.current)); } catch { /* Keep current accepted receipts. */ }
      jobBatch.current = null; jobReviewEnvironment.current=undefined; setJobReviewFrozen(false);
      setJobReview(null);
      setJobText("");
    }
  }
  function bulk(action: "stop" | "delete") {
    if (!snapshot) return;
    const jobs = snapshot.jobs.filter((job) => selected.has(job.id));
    const execute = async () => {
      for (const job of jobs)
        if (assistantJobVisible(job, canSeeProject))
        await assistantRequest({
          op: "jobs.control",
          id: job.id,
          expectedVersion: job.version,
          action,
        });
      setSelected(new Set());
    };
    if (action === "delete")
      setConfirm({
        title: t("Delete selected jobs?"),
        message: t(
          "The selected jobs stop first. Tasks, sessions and worktrees remain.",
        ),
        confirmLabel: t("Delete"),
        onConfirm: execute,
      });
    else void run("bulk", t("Stopping..."), execute);
  }
  const openJob = snapshot?.jobs.find((job) => job.id === detail);
  const visibleSelectedCount = snapshot?.jobs.filter(job => selected.has(job.id)).length ?? 0;
  const jobDraftVisible = !jobReview || jobReview.every(draft => draft.kind!=="quick"&&!draft.projectIds.length || visibleDraft(draft));
  const reviewHasAutomation = !!jobReview?.some(row => row.kind==="quick"&&row.quickAction?.kind==="automation");
  const active = snapshot?.jobs.filter((job) => !finished(job)) ?? [];
  const workingJobs=active.filter(job=>["planning","running","stalled"].includes(job.status));
  const allJobs = (view === "Today" ? active : (snapshot?.jobs ?? [])).filter(
    (job) =>
      matches(query, job.title, job.request, job.summary) &&
      (!filter || job.status === filter) && (view!=="Jobs"||(!jobProjectFilter||assistantJobProjectIds(job).includes(jobProjectFilter))&&(jobDateFilter==="all"||job.createdAt>= (jobDateFilter==="today"?new Date().setHours(0,0,0,0):Date.now()-7*86400000))),
  );
  const projectName = (id: string) =>
    projects.find((project) => (project.id ?? project.path) === id)?.name ?? t("Project unavailable");
  const errorFor = (key: string) =>
    error?.key === key ? (
      <p role="alert" className={styles.error}>
        {error.text}
      </p>
    ) : null;
  const empty = (text: string) => <p className={styles.empty}>{t(text)}</p>;
  function clearHistory(){setConfirm({title:t("Clear history?"),message:t("Your activity records move to Recently deleted. Running work is unaffected."),confirmLabel:t("Clear"),onConfirm:async()=>{await assistantRequest({op:"activity.clear"});}});}


  return (
    <main className={styles.room} aria-label={identity.room}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{identity.name || identity.title}</h1>
          {snapshot?.profile.setupComplete && <Button variant="ghost" label={t("Assistant status")} onClick={event=>setHealthAnchor(event.currentTarget)}>
            {snapshot.paused?t("Paused"):workingJobs.length?t("Working"):snapshot.usage.mode==="report"?t("Report only"):active.some(job=>job.status==="waiting")?t("Waiting for you"):t("Ready")}
            <ChevronDown size={12}/>
          </Button>}
        </div>
        <div className={styles.toolbar}>
          {snapshot?.profile.setupComplete&&<>
            <Button variant="ghost" label={t("Presence")} onClick={event=>setPresenceAnchor(event.currentTarget)}><AssistantPresenceStatus snapshot={snapshot} compact unconfirmed={Boolean(readError||pending?.key.startsWith("presence")||error?.key.startsWith("presence"))}/><ChevronDown size={12}/></Button>
            <Button iconOnly label={t(snapshot.paused?"Resume work":"Stop everything")} tooltip={t(snapshot.paused?"Resume work":"Stop everything")}
              tone={snapshot.paused?"neutral":"danger"} disabled={snapshot.paused&&Boolean(pending)} loading={stopping||pending?.key==="pauseAll"}
              onClick={()=>snapshot.paused?void mutate("pauseAll",t("Updating..."),{op:"resumeAll"}):void stopEverything()}><Square size={14}/></Button>
          </>}
          <Button
            iconOnly
            label={t("Settings")}
            onClick={() => setSettings(true)}
            disabled={!snapshot}
          >
            <Settings size={15} />
          </Button>
          <Button
            iconOnly
            label={t("More options")}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(event) => setMenu(event.currentTarget)}
          >
            <MoreHorizontal size={15} />
          </Button>
          {props.onClose && (
            <Button iconOnly label={t("Close")} onClick={props.onClose}>
              <X size={15} />
            </Button>
          )}
        </div>
      </header>
      {menu && (
        <DropdownMenu
          anchor={menu}
          label={t("Room options")}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "trash") setTrash(true);
            else if(id==="refresh")void refresh();
            else setSetup(true);
          }}
          items={[
            {kind:"item",id:"refresh",label:t("Refresh"),icon:<RefreshCw size={14}/>,disabled:loading},
            {
              kind: "item",
              id: "trash",
              label: t("Recently deleted"),
              icon: <Trash2 size={14} />,
            },
            { kind: "item", id: "setup", label: t("Run setup again") },
          ]}
        />
      )}
      {readError && (
        <div role="alert" className={styles.feedback}>
          <span>{readError}</span>
          <Button loading={loading} onClick={() => void refresh()}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {projectReadError && <div role="alert" className={styles.feedback}><span>{t(projectReadError)}</span><Button onClick={() => void readProjects()}>{t("Retry")}</Button></div>}
      {error?.key.startsWith("navigation:") && (
        <div role="alert" className={styles.feedback}>
          {error.text}
        </div>
      )}
      {!snapshot ? (
        <div className={styles.empty} role="status">
          {loading
            ? t("Loading...")
            : t("Connect to the local Host to open this room.")}
        </div>
      ) : !snapshot.profile.setupComplete ? (
        <section className={styles.setupPrompt}>
          <h2>{t("Set up your personal assistant")}</h2>
          <p>
            {t(
              "Choose a name, working permissions and a daily budget before starting.",
            )}
          </p>
          <Button variant="primary" onClick={() => setSetup(true)}>
            {t("Set up")}
          </Button>
        </section>
      ) : (
        <>
          {healthAnchor&&<Popover anchor={healthAnchor} onDismiss={()=>setHealthAnchor(null)} kind="dialog" aria-label={t("Assistant status")}>
            <div className={styles.healthDetails}>
              <AssistantPresenceStatus snapshot={snapshot} details/>
              <p>{snapshot.lastHeartbeatAt?t("Last checked: {p0}",{p0:date(snapshot.lastHeartbeatAt)}):t("Waiting for the first check")}</p>
              <AssistantKeepAwakeStatus state={snapshot.keepAwake}/>
              <Button variant="link" onClick={()=>{setHealthAnchor(null);setSettings(true);}}>{t(snapshot.usage.estimated?"About {p0} tokens today":"{p0} tokens today",{p0:snapshot.usage.total.toLocaleString()})}</Button>
              <p>{t("Work tracking continues while voice is off.")}</p>
            </div>
          </Popover>}
          {presenceAnchor&&<Popover anchor={presenceAnchor} onDismiss={()=>setPresenceAnchor(null)} kind="dialog" aria-label={t("Presence")}>
            <div className={styles.healthDetails}>
              <Select label={t("Presence")} value={snapshot.presence.state} options={[["present","I'm here"],["away","Away"],["dnd","Do not disturb"],["idle","Idle"]].map(([value,label])=>({value,label:t(label)}))} disabled={Boolean(pending)}
                onValueChange={state=>void mutate("presence",t("Updating..."),{op:"presence.set",state:state as "present"|"away"|"dnd"|"idle"})}/>
              <Button disabled={Boolean(pending)} loading={pending?.key==="presence.return"} onClick={returnToAssistant}>{t("I'm back")}</Button>
            </div>
          </Popover>}
          {errorFor("presence")}
          {errorFor("presence.return")}
          {returnMessage&&<p role="status" className={styles.muted}>{returnMessage}</p>}
          {errorFor("pauseAll")}
          {snapshot.chiefReview?.blocked && (
            <div className={styles.feedback}>
              <span role="status"><strong>{t("Supervisor review needs attention")}</strong> · {snapshot.chiefReview.message}</span>
              <Button disabled={Boolean(pending)} loading={pending?.key==="chief.retry"} onClick={()=>snapshot.profile.autonomy==="chief"?void mutate("chief.retry",t("Updating..."),{op:"chief.retry"}):setSettings(true)}>{t(snapshot.profile.autonomy==="chief"?"Retry review":"Settings")}</Button>
            </div>
          )}
          {errorFor("chief.retry")}
          <div className={styles.tabRow}>
            <TabStrip
              label={t("Room sections")}
              value={view}
              onValueChange={(value) => {
                setView(value);
                setQuery("");
                setFilter("");
              }}
              controls="assistant-content"
              items={tabs.map((value) => ({
                value,
                label: t(value),
                count: value === "Jobs" ? active.length || null : null,
              }))}
            />
          </div>
          <section
            id="assistant-content"
            className={styles.content}
            data-view={view}
            aria-label={t(view)}
          >
            {(view==="Today"||view==="Jobs")&&snapshot.workHoursActive===false&&<p role="status" className={styles.muted}>{t("Outside working hours. Accepted turns can finish; new work waits.")}</p>}
            {view !== "Today" && (
              <div className={styles.collectionTools}>
                <SearchInput
                  type="search"
                  value={query}
                  aria-label={t("Search this section")}
                  placeholder={t("Search")}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
                {view==="Notes"&&<>

                  <Button loading={pending?.key==="notes.summary"} disabled={Boolean(pending)||!environmentId} onClick={()=>{const sourceEnvironment=environmentId,scopeKey=privacy.key;const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;void run("notes.summary",t("Preparing briefing..."),async()=>{if(!sourceEnvironment)throw new Error("The original Host could not be verified. Keep this draft and reconnect its original computer.");const response=await assistantRequest({op:"briefing.daily",day},sourceEnvironment);if(scopeKey!==visibility.current.privacy.key)return;if(!response.snapshot)throw new Error("Daily summary was not confirmed. Retry on its original computer.");setDailySummary({snapshot:response.snapshot,environmentId:sourceEnvironment,scopeKey,day});});}}>{t("Summarize today")}</Button>
                  <Button
                    startIcon={<Plus size={14} />}
                    disabled={!snapshot.capabilities.notes}
                    onClick={() => setNoteEdit("new")}
                  >
                    {t("New note")}
                  </Button>
                </>}
                {view==="History"&&<Button disabled={!snapshot.activity.length} onClick={clearHistory}>{t("Clear history")}</Button>}
                {view==="Memory"&&<Button startIcon={<Plus size={14}/>} onClick={()=>setMemoryEdit("new")}>{t("Add memory")}</Button>}
                {["Jobs", "History", "Sessions"].includes(view) && (
                  <FilterTrigger
                    label={t("Filter")}
                    activeCount={(filter?1:0)+(view==="Jobs"?(jobProjectFilter?1:0)+(jobDateFilter!=="all"?1:0):0)}
                    onReset={() => {setFilter("");if(view==="Jobs"){setJobProjectFilter("");setJobDateFilter("all");}}}
                    onClick={(event) => setFilterAnchor(event.currentTarget)}
                  />
                )}
              </div>
            )}
            {filterAnchor && (
              <Popover
                anchor={filterAnchor}
                onDismiss={() => setFilterAnchor(null)}
                kind="dialog"
                aria-label={t("Filter")}
              >
                <div className={styles.filter}>
                  <Select
                    label={t("Status or type")}
                    value={filter}
                    options={[
                      { value: "", label: t("All") },
                      ...(view === "History"
                        ? [
                            ...new Set(
                              snapshot.activity.map((item) => item.kind),
                            ),
                          ].map((value) => ({ value, label: t(value) }))
                        : [
                            ...new Set(snapshot.jobs.map((job) => job.status)),
                          ].map((value) => ({
                            value,
                            label: statusLabel(value),
                          }))),
                    ]}
                    onValueChange={setFilter}
                  />
                  {view==="Jobs"&&<><SearchableSelect label={t("Project")} value={jobProjectFilter} options={[{value:"",label:t("All projects")},...projects.map(project=>({value:project.id??project.path,label:project.name}))]} onChange={setJobProjectFilter}/><Select label={t("Created")} value={jobDateFilter} options={[{value:"all",label:t("All dates")},{value:"today",label:t("Today")},{value:"week",label:t("Last 7 days")}]} onValueChange={setJobDateFilter}/></>}
                  <Button
                    onClick={() => {
                      setFilter("");
                      if(view==="Jobs"){setJobProjectFilter("");setJobDateFilter("all");}
                      setFilterAnchor(null);
                    }}
                  >
                    {t("Reset")}
                  </Button>
                </div>
              </Popover>
            )}
            {view === "Today" && environmentId && <>
              <AssistantOwnerQuestions questions={canonicalSnapshot?.ownerQuestions??[]} environmentId={environmentId} visibleProjectIds={[...privacy.projectIds]} request={assistantRequest} onChanged={()=>{void refresh();}}/>
            </>}
            {view === "Today" && snapshot.briefing && <AssistantBriefingCard snapshot={snapshot}
              environmentId={props.environmentId??environmentId}
              privacyKey={privacy.key} canSeeProject={canSeeProject} canReadBriefing={canReadBriefing}
              onDismiss={()=>assistantRequest({op:"briefing.dismiss",id:snapshot.briefing!.id}).then(()=>undefined)}
              onOpenNotes={()=>setView("Notes")} onOpenSession={props.onOpenSession} onOpenGoal={props.onOpenGoal}
              onSetupVoice={()=>setSetup("voice")} onChooseLanguage={()=>setSettings(true)}/>}
            {(view === "Today" || view === "Jobs") && (
              <section className={`${styles.section} ${styles.jobsSection}`}>
                <div className={styles.rowHeading}>
                  {allJobs.length>0&&view==="Today"&&<h2>{t("Active jobs")}</h2>}
                  {visibleSelectedCount > 0 && (
                    <div className={styles.toolbar}>
                      <span>{t("{p0} selected", { p0: visibleSelectedCount })}</span>
                      <Button
                        disabled={Boolean(pending)}
                        onClick={() => bulk("stop")}
                      >
                        {t("Stop")}
                      </Button>
                      <Button
                        disabled={Boolean(pending)}
                        tone="danger"
                        onClick={() => bulk("delete")}
                      >
                        {t("Delete")}
                      </Button>
                    </div>
                  )}
                </div>
                {allJobs.length
                  ? allJobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        projectName={assistantJobProjectIds(job).map(projectName).join(" · ")}
                        selected={selected.has(job.id)}
                        busy={pending?.key === job.id}
                        disabled={Boolean(pending)}
                        error={error?.key === job.id ? error.text : ""}
                        onEdit={job.kind!=="quick"&&!finished(job)&&environmentId?(mode)=>setJobEdit({job,mode,environmentId,scopeKey:privacy.key}):undefined}
                        onSelect={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(job.id);
                            else next.delete(job.id);
                            return next;
                          })
                        }
                        onDetails={() => setDetail(job.id)}
                        onControl={(action) => control(job, action)}
                        onReviewTasks={props.onReviewJobTasks?()=>reviewJobTasks(job):undefined}
                      />
                    ))
                  : view==="Today"?null:empty(query || filter || jobProjectFilter||jobDateFilter!=="all" ? "No matching jobs" : "No jobs yet")}
                {errorFor("bulk")}
                <div className={styles.jobInput}>
                  <TextareaField
                    label={t("Give {p0} a job", { p0: identity.name })}
                  value={jobDraftVisible ? jobText : ""}
                  disabled={!jobDraftVisible}
                    minRows={1}
                    maxRows={6}
                    maxLength={16000}
                    placeholder={t("One request per line")}
                    onChange={(event) => setJobText(event.currentTarget.value)}
                  />
                  <Button
                    variant="primary"
                    startIcon={<Plus size={14} />}
                    disabled={
                      !jobDraftVisible || !jobText.trim() ||
                      Boolean(pending) ||
                      (!snapshot.capabilities.jobs&&!snapshot.capabilities.quickNotes&&!snapshot.capabilities.quickAutomations)
                    }
                    onClick={() => {
                      try{const saved=JSON.parse(localStorage.getItem("bycoda.assistant.job-review")??"null");if(saved?.source===jobText&&Array.isArray(saved.rows)&&saved.rows.every((row:JobDraft)=>typeof row.id==="string"&&typeof row.key==="string"&&typeof row.request==="string"&&typeof row.title==="string"&&typeof row.projectId==="string"&&Array.isArray(row.projectIds))){jobBatch.current=null;jobReviewEnvironment.current=typeof saved.environmentId==="string"?saved.environmentId:undefined;setJobReviewFrozen(saved.frozen===true);setJobReview(saved.rows);return;}}catch{/* Review the retained source text. */}
                      jobBatch.current = null; jobReviewEnvironment.current=undefined; setJobReviewFrozen(false);
                      setJobReview(
                        jobText
                          .split(/\r?\n/)
                          .filter(request=>request.trim())
                          .map((request) => ({
                            id: operationId(),
                            title:request.trim().slice(0,300),request,
                            projectId: defaultProjectId,
                            projectIds: defaultProjectId ? [defaultProjectId] : [],
                            key: jobKey(request, defaultProjectId),
                          })),
                      );
                    }}
                  >
                    {t("Review jobs")}
                  </Button>
                </div>
                {!jobDraftVisible && <p role="status" className={styles.muted}>{t("The selected project is no longer visible.")}</p>}
                {!snapshot.capabilities.jobs && (
                  <p className={styles.muted}>
                    {t("Job execution is unavailable on this Host.")}
                  </p>
                )}
              </section>
            )}
            {view === "Conversations" && (
              <ConversationPanel
                key={privacy.key}
                request={assistantRequest}
                environmentId={environmentId}
                snapshot={snapshot}
                source={canonicalSnapshot!}
                privacy={privacy}
                canSeeProject={canSeeProject}
                projectId={defaultProjectId}
                projects={projects}
                sessionId={props.sessionId}
                query={query}
                onOpenSession={onOpenSession}
                onJob={setDetail}
              />
            )}
            {view === "Sessions" && (
              <><AssistantSessions
                jobs={snapshot.jobs}
                query={query}
                filter={filter}
                environmentId={props.environmentId??environmentId}
                contextSettings={snapshot.profile}
                projectName={projectName}
                onOpenSession={onOpenSession}
              /><ManualSessionSupervision key={environmentId??"unknown"} controller={manual} projects={projects} environmentId={environmentId} query={query} onSettings={() => setSettings(true)} onOpenSession={onOpenSession}/></>
            )}
            {view === "Notes" && (
              <section className={styles.section}>

                {errorFor("notes.summary")}
                {dailySummary&&dailySummary.environmentId===environmentId&&dailySummary.scopeKey===privacy.key&&<div role="status" className={styles.stack}>{dailySummary.snapshot.briefing&&canReadBriefing(dailySummary.snapshot)?<><h3>{t("Daily summary")}</h3><p className={styles.muted}>{t("Saved daily summary · {p0}",{p0:date(dailySummary.snapshot.briefing.createdAt)})}</p><p>{dailySummary.snapshot.briefing.text}</p><p className={styles.muted}>{t("Today's summary is reused after it is generated.")}</p></>:<p>{t("Nothing new to report.")}</p>}</div>}
                {!snapshot.capabilities.notes && (
                  <p role="status" className={styles.muted}>
                    {t("Global notes are unavailable on this Host.")}
                  </p>
                )}
                {snapshot.notes
                  .filter((note) => matches(query, note.title, note.body))
                  .map((note) => (
                    <div className={styles.row} key={note.id}>
                      <div className={styles.rowText}>
                        <Button
                          variant="link"
                          onClick={() => setNoteEdit(note)}
                        >
                          {note.title}
                        </Button>
                        <p>{date(note.updatedAt)}</p>
                        <p className={styles.excerpt}>{note.body}</p>
                      </div>
                      <Button
                        iconOnly
                        label={t("Delete note")}
                        onClick={() =>
                          setConfirm({
                            title: t("Delete note?"),
                            message: note.title,
                            confirmLabel: t("Delete"),
                            onConfirm: async () => {
                              const result=await assistantRequest({
                                op: "notes.delete",
                                id: note.id,
                                expectedUpdatedAt: note.updatedAt,
                              });
                              if(result.ok!==true)throw new Error(t("Note deletion is uncertain. Review the Room before retrying."));
                              if(result.trashId?.startsWith("notetrash:")){setDeletedNoteWithoutReceipt(null);setUndo({id:result.trashId,label:note.title,environmentId});}
                              else{setUndo(null);setDeletedNoteWithoutReceipt(note.title);}
                            },
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                {snapshot.capabilities.notes &&
                  !snapshot.notes.some(note=>matches(query,note.title,note.body)) &&
                  empty(query?"No results":"No notes yet")}
              </section>
            )}
            {view === "History" && (
              <HistoryPanel
                entries={snapshot.activity.filter(
                  (item) =>
                    matches(query, item.summary, item.kind) &&
                    (!filter || item.kind === filter),
                )}
                onOpenSession={onOpenSession}
                onJob={setDetail}
              />
            )}
            {view === "Memory" && (
              <section className={styles.section}>
                <div className={styles.rowHeading}>
                  <span className={styles.muted}>
                    {t("Rules {p0}/40", {
                      p0: snapshot.memory.filter(
                        (entry) => entry.kind === "rule",
                      ).length,
                    })}
                  </span>

                </div>
                {memorySearching && <p role="status">{t("Loading...")}</p>}
                {errorFor("memory.search")}
                {!memorySearching&&!memoryEntries.length&&empty("Nothing saved here yet")}
                {(
                  [
                    ["rule", "Rules"],
                    ["profile", "About me"],
                    ["fact", "Learned"],
                  ] as const
                ).filter(([kind])=>memoryEntries.some(entry=>entry.kind===kind)).map(([kind, label]) => (
                  <section className={styles.section} key={kind}>
                    <h3>{t(label)}</h3>
                    {memoryEntries
                      .filter(
                        (entry) =>
                          entry.kind === kind &&
                          matches(query, entry.text, entry.quote),
                      )
                      .map((entry) => (
                        <div className={styles.row} key={entry.id}>
                          <div className={styles.rowText}>
                            <p className={styles.prewrap}>{entry.text}</p>
                            <span className={styles.muted}>
                              {t(
                                entry.scope === "all"
                                  ? "Everywhere"
                                  : entry.scope === "voice"
                                    ? "Voice only"
                                    : "Coding sessions only",
                              )}{" "}
                              ·{" "}
                              {t(
                                entry.source === "typed"
                                  ? "You wrote"
                                  : entry.source === "spoken"
                                    ? "You said"
                                    : "Learned",
                              )}{" "}
                              · {date(entry.createdAt)}
                            </span>
                            {entry.quote && entry.quote !== entry.text && (
                              <p className={styles.excerpt}>{entry.quote}</p>
                            )}
                          </div>
                          <Switch
                            aria-label={t("Enable memory")}
                            checked={entry.active}
                            disabled={Boolean(pending)}
                            onCheckedChange={(active) =>
                              void mutate(entry.id, t("Saving..."), {
                                op: "memory.save",
                                id: entry.id,
                                kind: entry.kind,
                                text: entry.text,
                                scope: entry.scope,
                                source: entry.source,
                                quote: entry.quote,
                                forbiddenTerms: entry.forbiddenTerms,
                                expectedVersion: entry.version,
                                active,
                              })
                            }
                          />
                          <Button onClick={() => setMemoryEdit(entry)}>
                            {t("Edit")}
                          </Button>
                          <Button
                            iconOnly
                            label={t("Delete memory")}
                            onClick={() =>
                              setConfirm({
                                title: t("Delete memory?"),
                                message: entry.text,
                                confirmLabel: t("Delete"),
                                onConfirm: async () => {
                                  await assistantRequest({
                                    op: "memory.delete",
                                    id: entry.id,
                                    expectedVersion: entry.version,
                                  });
                                  setUndo({
                                    id: `memory:${entry.id}`,
                                    label: entry.text,
                                    environmentId,
                                  });
                                },
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                          {errorFor(entry.id)}
                        </div>
                      ))}
                    {!memorySearching &&
                      !memoryEntries.some((entry) => entry.kind === kind) &&
                      empty("Nothing saved here yet")}
                  </section>
                ))}
              </section>
            )}
          </section>
          {pending&&<footer className={styles.footer}><span role="status">{pending.label}</span></footer>}
        </>
      )}
      {undo && undo.environmentId===environmentId && (!undo.projectId || assistantJobVisible({ projectId: undo.projectId, projectIds: undo.projectIds }, canSeeProject)) && (
        <div role="status" className={styles.undo}>
          <span>
            {t("Deleted")}: {undo.label}
          </span>
          <Button
            disabled={Boolean(pending)}
            onClick={() =>
              void run("undo", t("Restoring..."), async () => {
                const result=await assistantRequest({ op: "trash.restore", id: undo.id },undo.environmentId);
                if(result.ok!==true)throw new Error(t("The restore could not be confirmed. Check Recently deleted before retrying."));
                setUndo(null);
              })
            }
          >
            {t("Undo")}
          </Button>
          <Button iconOnly label={t("Dismiss")} onClick={() => setUndo(null)}>
            <X size={14} />
          </Button>
          {errorFor("undo")}
        </div>
      )}
      {deletedNoteWithoutReceipt&&<div role="status" className={styles.undo}><span>{t("Deleted")}: {deletedNoteWithoutReceipt}</span><Button onClick={()=>{setDeletedNoteWithoutReceipt(null);setTrash(true);}}>{t("Recently deleted")}</Button><Button iconOnly label={t("Dismiss")} onClick={()=>setDeletedNoteWithoutReceipt(null)}><X size={14}/></Button></div>}
      {jobEdit&&jobEdit.environmentId===environmentId&&jobEdit.scopeKey===privacy.key&&assistantJobVisible(jobEdit.job,canSeeProject)&&<JobOwnerEditDialog key={`${jobEdit.environmentId}:${jobEdit.job.id}:${jobEdit.mode}`} job={jobEdit.job} mode={jobEdit.mode} environmentId={jobEdit.environmentId} request={ownerRequest} current={()=>visibility.current.privacy.key===jobEdit.scopeKey&&assistantJobVisible(jobEdit.job,canSeeProject)} onClose={()=>setJobEdit(null)} onSaved={()=>{void refresh();setJobEdit(null);}}/>}
      {setup && <AssistantSetup voice={setup==="voice"} onClose={() => setSetup(false)} />}
      {settings && snapshot && (
        <AssistantSettings
          request={assistantRequest}
          environmentId={environmentId}
          snapshot={snapshot}
          manual={manual}
          projects={projects}
          onClose={() => setSettings(false)}
          onSetup={() => {
            setSettings(false);
            setSetup(true);
          }}
        />
      )}
      {trash && snapshot && (
        <TrashPanel key={privacy.key} request={assistantRequest} entries={snapshot.trash} onRestored={id=>setRestoredUndoId({id,environmentId})} onClose={() => setTrash(false)} />
      )}
      {memoryEdit && (
        <MemoryEditor request={assistantRequest} entry={memoryEdit} onClose={() => setMemoryEdit(null)} />
      )}
      {noteEdit && (
        <NoteEditor request={ownerRequest} environmentId={environmentId} note={noteEdit} onSaved={refresh} onClose={() => setNoteEdit(null)} />
      )}
      {confirm && confirmPrivacy.current === privacy.key && (
        <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
      )}
      {openJob && (
        <Modal
          title={openJob.title}
          context={t("Job details")}
          onClose={() => setDetail(null)}
          placement="end"
          panelStyle={{ inlineSize: "min(560px, 100vw)" }}
          size="md"
          fitViewport
        >
          <div
            className={`${styles.stack} ${styles.modalBody} ${styles.detail}`}
          >
            <Badge>{jobStatusLabel(openJob)}</Badge>
            <p className={styles.prewrap}>{openJob.request}</p>
            <p>{openJob.summary}</p>
            {openJob.kind==="quick"&&openJob.quickAction.kind==="note"&&<><h3>{t("Note title")}</h3><p>{openJob.quickAction.title}</p><h3>{t("Note content")}</h3><p className={styles.prewrap}>{openJob.quickAction.body}</p>
              {openJob.quickResult?.noteId&&<Button loading={pending?.key===`note:${openJob.id}`} disabled={!!pending} onClick={()=>void run(`note:${openJob.id}`,t("Loading..."),async()=>{const id=openJob.quickResult?.noteId;if(!id)throw new Error(t("The saved note is no longer available."));const result=await assistantRequest({op:"notes.get",id});if(!result.note||result.note.id!==id)throw new Error(t("The saved note is no longer available."));setDetail(null);setNoteEdit(result.note);})}>{t("Open saved note")}</Button>}{errorFor(`note:${openJob.id}`)}</>}
            {openJob.kind!=="quick"&&<p>{t("Lead project")}: {projectName(openJob.projectId)}</p>}
            {openJob.kind==="quick"&&openJob.quickAction.kind==="automation"&&<>
              <AssistantQuickAutomationFields value={openJob.quickAction} projects={projects.map(project=>({...project,id:project.id??project.path}))} disabled onChange={()=>undefined}/>
              {!openJob.quickResult?.automationId&&openJob.quickIntent?.automationId&&<p className={styles.muted}>{t("Automation creation is unconfirmed. Inspect its original target before retrying.")} <code>{openJob.quickIntent.automationId}</code></p>}
              {(openJob.quickResult?.automationId||openJob.quickIntent?.automationId)&&props.onOpenAutomation&&<Button loading={pending?.key===`automation:${openJob.id}`} disabled={!!pending} onClick={()=>void run(`automation:${openJob.id}`,t("Loading..."),async()=>{
                const navigationEpoch=scopeEpoch.current.value,jobId=openJob.id;
                const id=openJob.quickResult?.automationId??openJob.quickIntent?.automationId;
                if(!id||!environmentId||openJob.quickAction.kind!=="automation")throw new Error("The linked automation is unavailable on its original computer.");
                const owner=await captureAssistantHostRead(environmentId);
                const rows=await owner.automations();
                const projectId=openJob.quickAction.projectId;
                const actual=rows.find(row=>row.id===id&&row.projectId===projectId);
                if(!actual||!assistantJobVisible(openJob,canSeeProject))throw new Error("The linked automation is unavailable on its original computer.");
                await props.onOpenAutomation!({id:actual.id,projectId:actual.projectId,environmentId:owner.environmentId});
                if(scopeEpoch.current.value===navigationEpoch)setDetail(current=>current===jobId?null:current);
              })}>{t("Open automation")}</Button>}
              {errorFor(`automation:${openJob.id}`)}
            </>}
            {assistantJobProjectIds(openJob).length > 1 && <div><h3>{t("Participating projects")}</h3><p>{assistantJobProjectIds(openJob).map(projectName).join(" · ")}</p></div>}
            <p>
              {t("{p0} tokens", {
                p0: openJob.tokens.toLocaleString(),
              })}
            </p>
            {openJob.kind!=="quick"&&!finished(openJob)&&<div className={styles.toolbar}><Button disabled={!!pending||!environmentId} onClick={()=>environmentId&&setJobEdit({job:openJob,mode:"priority",environmentId,scopeKey:privacy.key})}>{t("Priority")}: {t(({low:"Low",normal:"Normal",high:"High"} as const)[openJob.priority??"normal"])}</Button>{!finished(openJob)&&openJob.status!=="paused"&&openJob.goalId&&!openJob.pendingTaskDeletion&&!openJob.awaitingOwnerRestart&&<Button disabled={!!pending||!environmentId} onClick={()=>environmentId&&setJobEdit({job:openJob,mode:"replan",environmentId,scopeKey:privacy.key})}>{t("Replan")}</Button>}</div>}
            <details className={styles.relatedWork}><summary>{t("Related work")}</summary>
            {openJob.goalId && <p>{t("Goal")}: <Button variant="link" disabled={!props.onReviewJobTasks||!!pending} loading={pending?.key===`tasks:${openJob.id}`} onClick={()=>reviewJobTasks(openJob)}>{openJob.goalId}</Button></p>}
            {(openJob.kind!=="quick"||openJob.sessionIds.length>0)&&<h3>{t("Sessions")}</h3>}
            {openJob.sessionIds.map((id) => (
              <Button
                key={id}
                variant="link"
                disabled={!onOpenSession}
                onClick={() => onOpenSession?.(id)}
              >
                {id}
              </Button>
            ))}
            {error?.key.startsWith("navigation:") && (
              <p role="alert" className={styles.error}>
                {error.text}
              </p>
            )}
            {(openJob.kind!=="quick"||openJob.taskIds.length>0)&&<h3>{t("Tasks")}</h3>}
            {openJob.taskIds.map((id) => (
              <Button key={id} variant="link" disabled={!props.onReviewJobTasks||!!pending||openJob.kind==="quick"||!openJob.goalId} onClick={()=>reviewJobTasks(openJob)}>{id}</Button>
            ))}
            </details>
            {openJob.awaitingOwnerRestart&&<p role="status">{t("Restoring keeps the goal and tasks stopped. Review them in the task board before restarting.")}</p>}
            {openJob.awaitingOwnerRestart&&props.onReviewJobTasks&&<Button disabled={!!pending} loading={pending?.key===`tasks:${openJob.id}`} onClick={()=>reviewJobTasks(openJob)}>{t("Review tasks")}</Button>}
            {errorFor(`tasks:${openJob.id}`)}
            {openJob.pendingTaskDeletion&&<Button disabled={!!pending} loading={pending?.key===openJob.id} onClick={()=>control(openJob,"keep")}>{t("Keep job and tasks")}</Button>}
            <details className={styles.relatedWork}><summary>{t("History")}</summary>

            {snapshot?.activity
              .filter((item) => item.jobId === openJob.id)
              .map((item) => (
                <p key={item.id}>
                  {date(item.createdAt)} · {item.summary}
                </p>
              ))}
            </details>
          </div>
        </Modal>
      )}
      {jobReview && jobDraftVisible && (
        <Modal
          title={t("Review jobs")}
          onClose={() => {
            if (!pending) setJobReview(null);
          }}
          size="md"
          fitViewport
          footerStart={(error?.key==="jobs.create"||reviewHasAutomation)?<div className={styles.reviewFooterNote}>
            {error?.key==="jobs.create"&&<InlineError>{error.text}</InlineError>}
            {reviewHasAutomation&&<p className={styles.muted}>{t("This creates a scheduled automation. It does not run it now.")}</p>}
          </div>:undefined}
          footer={
            <ModalActions>
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={() => setJobReview(null)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                loading={pending?.key === "jobs.create"}
                disabled={
                  !jobReview.length ||
                  jobReview.some(
                    (item) => !assistantJobDraftReady(reviewedDraft(item)) || !visibleDraft(item) || item.kind==="quick"&&(item.quickAction?.kind==="automation"?snapshot?.capabilities.quickAutomations!==true:snapshot?.capabilities.quickNotes!==true),
                  )
                }
                onClick={() => void submitJobs()}
              >
                {t(jobReviewFrozen ? "Check and retry" : jobReview.every(row=>row.kind==="quick"&&row.quickAction?.kind==="note")?"Save notes":jobReview.every(row=>row.kind==="quick"&&row.quickAction?.kind==="automation")?"Create automations":"Start")}
              </Button>
            </ModalActions>
          }
        >
          <div className={`${styles.stack} ${styles.modalBody}`}>
            {jobReview.map((draft, index) => (
              <div className={styles.reviewJob} key={draft.id}>
                <div className={styles.reviewJobHead}>
                  <span className={styles.reviewJobTitle}>{t("Request {p0}", { p0: index + 1 })}</span>
                  <div className={styles.reviewJobTools}>
                    <Select label={t("Job type")} value={draft.kind==="quick"&&draft.quickAction?.kind==="automation"?"automation":draft.kind??"project"} disabled={jobReviewFrozen||!!pending}
                      options={[{value:"project",label:t("Project work"),disabled:!snapshot?.capabilities.jobs},{value:"quick",label:t("Save personal note"),disabled:snapshot?.capabilities.quickNotes!==true},{value:"automation",label:t("Create scheduled automation"),disabled:snapshot?.capabilities.quickAutomations!==true}]}
                      onValueChange={kind=>{const next=changeAssistantJobDraftKind(reviewedDraft(draft),kind as "project"|"quick"|"automation");updateJobDraft(draft.id,{...next,projectIds:[...(next.projectIds??[])]});}}/>
                    {jobReview.length > 1 && (
                      <Button
                        iconOnly
                        size="sm"
                        variant="ghost"
                        label={t("Remove request")}
                        tooltip={t("Remove request")}
                        disabled={jobReviewFrozen || Boolean(pending)}
                        onClick={() =>
                          setJobReview((current) =>
                            current!.filter((item) => item.id !== draft.id),
                          )
                        }
                      >
                        <X className="icon-sm" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
                <TextField
                  label={t("Request {p0}", { p0: index + 1 })}
                  hideLabel
                  value={draft.request}
                  disabled={jobReviewFrozen || !!pending}
                  maxLength={16000}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateJobDraft(draft.id,{request:value,title:value.trim().slice(0,300)});
                  }}
                />
                {draft.kind==="quick"&&draft.quickAction?.kind==="note"?<AssistantQuickNoteFields value={draft.quickAction} disabled={jobReviewFrozen||!!pending} onChange={quickAction=>updateJobDraft(draft.id,{quickAction})}/>:
                 draft.kind==="quick"&&draft.quickAction?.kind==="automation"?<AssistantQuickAutomationFields value={draft.quickAction} projects={projects.map(project=>({...project,id:project.id??project.path}))} disabled={jobReviewFrozen||!!pending} onChange={quickAction=>updateJobDraft(draft.id,{quickAction})}/>:<><SearchableSelect
                  label={t("Participating projects")}
                  visibleLabel
                  multiple
                  showSelectedValues
                  selectionLabels={{ done: t("Done") }}
                  value={draft.projectIds}
                  disabled={jobReviewFrozen || !!pending}
                  options={projects.map((project) => ({
                    value: project.id ?? project.path,
                    label: project.name,
                    description: project.path,
                    disabled: draft.projectIds.length >= 20 && !draft.projectIds.includes(project.id ?? project.path),
                  }))}
                  onChange={(projectIds) =>
                    updateJobDraft(draft.id,selectAssistantJobProjects(draft.projectId,projectIds))
                  }
                />
                <SearchableSelect visibleLabel label={t("Lead project")} value={draft.projectId} disabled={jobReviewFrozen || !!pending || !draft.projectIds.length}
                  options={projects.filter(project => draft.projectIds.includes(project.id ?? project.path)).map(project => ({ value: project.id ?? project.path, label: project.name, description: project.path }))}
                  onChange={projectId => updateJobDraft(draft.id,selectAssistantJobProjects(projectId,draft.projectIds))}/></>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </main>
  );
}

type JobOwnerEditInput=Extract<AssistantRequest,{op:"jobs.replan"|"jobs.priority"}>;
function JobOwnerEditDialog({job,mode,environmentId,request,current,onClose,onSaved}:{job:AssistantJob;mode:"priority"|"replan";environmentId:string;request:OwnerRequest;current:()=>boolean;onClose:()=>void;onSaved:()=>void}){
 const formId=useId(),key=`bycoda.assistant.job-edit:${environmentId}:${job.id}:${mode}`;
 const [draft,setDraft]=useState<{feedback:string;priority:"low"|"normal"|"high";intent?:JobOwnerEditInput}>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)??"null");if(saved&&typeof saved.feedback==="string"&&["low","normal","high"].includes(saved.priority)&&(!saved.intent||saved.intent.id===job.id&&saved.intent.op===`jobs.${mode}`))return saved;}catch{/* An invalid retained draft grants no action. */}return{feedback:"",priority:job.kind!=="quick"?job.priority??"normal":"normal"};});
 const [pending,setPending]=useState(false),busy=useRef(false),[error,setError]=useState("");
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const live=useRef(current);live.current=current;
 function retain(next:typeof draft){localStorage.setItem(key,JSON.stringify(next));setDraft(next);}
 function verify(next:AssistantJob|undefined){if(!alive.current||!live.current()||!next||next.id!==job.id||next.kind==="quick"||next.projectId!==job.projectId||JSON.stringify(assistantJobProjectIds(next))!==JSON.stringify(assistantJobProjectIds(job)))throw new Error("The job changed or is outside visible project scope.");return next;}
 async function submit(){if(busy.current)return;busy.current=true;setPending(true);setError("");try{
  if(!live.current())throw new Error("The selected project is no longer visible.");
  if(draft.intent){const next=verify((await request({op:"jobs.get",id:job.id},environmentId)).job);if(draft.intent.op==="jobs.priority"&&next.version>draft.intent.expectedVersion&&(next.priority??"normal")===draft.intent.priority){localStorage.removeItem(key);onSaved();return;}setError(t(mode==="replan"?"Replan was not confirmed. Review the goal before starting another replan.":"Priority change was not confirmed. Review the job before changing it again."));return;}
  const input:JobOwnerEditInput=mode==="replan"?{op:"jobs.replan",id:job.id,expectedVersion:job.version,feedback:draft.feedback.trim()}:{op:"jobs.priority",id:job.id,expectedVersion:job.version,priority:draft.priority};
  if(input.op==="jobs.replan"&&!input.feedback)throw new Error("Describe the change before replanning.");
  retain({...draft,intent:input});
  const next=verify((await request(input,environmentId)).job);
  if(next.version<=job.version||input.op==="jobs.priority"&&(next.priority??"normal")!==input.priority||input.op==="jobs.replan"&&next.status!=="planning")throw new Error("Job status is unknown. Check the Room before retrying.");
  localStorage.removeItem(key);onSaved();
 }catch(cause){if(alive.current&&live.current())setError(cause instanceof Error?t(cause.message):String(cause));}finally{busy.current=false;setPending(false);}}
 return <Modal title={t(mode==="replan"?"Replan job":"Job priority")} onClose={onClose} size="md" footer={<ModalActions><Button disabled={pending} onClick={onClose}>{t("Close")}</Button><Button form={formId} type="submit" variant="primary" loading={pending} disabled={!draft.intent&&mode==="replan"&&!draft.feedback.trim()}>{t(draft.intent?"Check status":mode==="replan"?"Replan":"Save")}</Button></ModalActions>}>
 <form id={formId} className={`${styles.stack} ${styles.modalBody}`} onSubmit={event=>{event.preventDefault();void submit();}}><p>{job.title}</p>{mode==="replan"?<TextareaField label={t("Replan feedback")} value={draft.feedback} maxLength={3000} minRows={5} disabled={pending||!!draft.intent} onChange={event=>retain({...draft,feedback:event.currentTarget.value})}/>:<Select label={t("Priority")} value={draft.priority} disabled={pending||!!draft.intent} options={[{value:"low",label:t("Low")},{value:"normal",label:t("Normal")},{value:"high",label:t("High")}]} onValueChange={priority=>retain({...draft,priority:priority as typeof draft.priority})}/>}{draft.intent&&<p role="status" className={styles.muted}>{t("This request is retained on its original computer. Check its status before taking another action.")}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}</form></Modal>;
}

function JobRow({
  onReviewTasks,
  onEdit,
  job,
  projectName,
  selected,
  busy,
  disabled,
  error,
  onSelect,
  onDetails,
  onControl,
}: {
  onReviewTasks?:()=>void;
  onEdit?:(mode:"priority"|"replan")=>void;
  job: AssistantJob;
  projectName: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  error: string;
  onSelect: (selected: boolean) => void;
  onDetails: () => void;
  onControl: (action: "pause" | "resume" | "stop" | "delete" | "keep") => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <div className={styles.row} data-selected={selected || undefined}>
      <Checkbox
        aria-label={t("Select {p0}", { p0: job.title })}
        checked={selected}
        onChange={(event) => onSelect(event.currentTarget.checked)}
      />
      <div className={styles.rowText}>
        <Button variant="link" onClick={onDetails}>
          {job.title}
        </Button>
        <p>
          {projectName}
          {job.progress.total > 0
            ? ` · ${job.progress.done}/${job.progress.total}`
            : ""}
        </p>
        {job.summary && <p>{job.summary}</p>}
        {job.dispatchState === "unknown" && (
          <p className={styles.error}>
            {t(
              "Dispatch status unknown. Check the linked goal before retrying.",
            )}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <Badge
        tone={
          job.status === "failed"
            ? "danger"
            : job.status === "waiting" || job.status === "stalled"
              ? "warning"
              : "neutral"
        }
      >
        {jobStatusLabel(job)}
      </Badge>
      {job.awaitingOwnerRestart&&onReviewTasks&&<Button disabled={disabled} onClick={onReviewTasks}>{t("Review tasks")}</Button>}
      {job.pendingTaskDeletion&&<Button disabled={disabled} loading={busy} onClick={()=>onControl("keep")}>{t("Keep job and tasks")}</Button>}
      {!finished(job) && !job.pendingTaskDeletion && (
        <Button
          iconOnly
          label={t("Stop job")}
          loading={busy}
          disabled={disabled}
          onClick={() => onControl("stop")}
        >
          <Square size={13} />
        </Button>
      )}
      <Button
        iconOnly
        label={t("Job actions")}
        disabled={disabled}
        onClick={(event) => setMenu(event.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </Button>
      {menu && (
        <DropdownMenu
          label={t("Job actions")}
          anchor={menu}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "details") onDetails();
            else if(id==="priority"||id==="replan")onEdit?.(id);
            else onControl(id as "pause" | "resume" | "delete");
          }}
          items={[
            { kind: "item", id: "details", label: t("Details") },
            ...(onEdit?[{kind:"item" as const,id:"priority",label:t("Priority")},...(!finished(job)&&job.status!=="paused"&&job.goalId&&!job.pendingTaskDeletion&&!job.awaitingOwnerRestart?[{kind:"item" as const,id:"replan",label:t("Replan")}]:[])]:[]),
            ...(!finished(job)&&!job.pendingTaskDeletion&&!job.awaitingOwnerRestart
              ? [
                  {
                    kind: "item" as const,
                    id: job.status === "paused" ? "resume" : "pause",
                    label: t(job.status === "paused" ? "Resume" : "Pause"),
                  },
                ]
              : []),
            { kind: "sep" },
            { kind: "item", id: "delete", label: t("Delete..."), danger: true },
          ]}
        />
      )}
    </div>
  );
}

function HistoryPanel({
  entries,
  onOpenSession,
  onJob,
}: {
  entries: AssistantActivity[];
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJob: (id: string) => void;
}) {
  const days = [...new Set(entries.map((item) => day(item.createdAt)))];
  return (
    <section className={styles.section}>

      {days.map((label) => (
        <section className={styles.section} key={label}>
          <h3>{label}</h3>
          {entries
            .filter((item) => day(item.createdAt) === label)
            .map((item) => (
              <div className={styles.row} key={item.id}>
                <div className={styles.rowText}>
                  <p>{item.summary}</p>
                  <span className={styles.muted}>
                    {new Date(item.createdAt).toLocaleTimeString()} ·{" "}
                    {activityKindLabel(item.kind)}
                  </span>
                </div>
                {item.jobId && (
                  <Button variant="link" onClick={() => onJob(item.jobId!)}>
                    {t("Job")}
                  </Button>
                )}
                {item.sessionId && onOpenSession && (
                  <Button
                    iconOnly
                    label={t("Open session")}
                    onClick={() => onOpenSession(item.sessionId!)}
                  >
                    <ExternalLink size={14} />
                  </Button>
                )}
              </div>
            ))}
        </section>
      ))}
      {!entries.length && (
        <p className={styles.empty}>{t("No activity yet")}</p>
      )}
    </section>
  );
}

function ConversationPanel({
  request,
  environmentId,
  snapshot,
  source,
  privacy,
  canSeeProject,
  projectId,
  projects,
  sessionId,
  query,
  onOpenSession,
  onJob,
}: {
  request:OwnerRequest;
  environmentId?:string;
  snapshot: AssistantSnapshot;
  source: AssistantSnapshot;
  privacy: AssistantPrivacyScope;
  canSeeProject: (id: string) => boolean;
  projectId: string;
  projects: readonly Project[];
  sessionId?: string;
  query: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJob: (id:string)=>void;
}) {
  const [assistantRequest]=useState(()=>request);
  const [retainedThreadId, setThreadId] = useState(
    snapshot.threads.find((thread) => thread.projectId === projectId)?.id ??
      snapshot.threads[0]?.id ??
      "",
  );
  const threadId = snapshot.threads.some(thread => thread.id === retainedThreadId) ? retainedThreadId : "";
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const currentScope = useRef({ snapshot, source, privacy, canSeeProject, environmentId });
  currentScope.current = { snapshot, source, privacy, canSeeProject, environmentId };
  function threadVisible(id: string) {
    const thread = currentScope.current.snapshot.threads.find(thread => thread.id === id);
    return !!thread && (!thread.projectId || currentScope.current.canSeeProject(thread.projectId));
  }
  function messageVisible(message: AssistantMessage) { const current = currentScope.current; return threadVisible(message.threadId) && visibleAssistantMessages([message], current.source, current.privacy).length === 1; }
  const [threadUpdates,setThreadUpdates]=useState<Record<string,AssistantThread>>({});
  const threadUpdatesRef=useRef(threadUpdates);threadUpdatesRef.current=threadUpdates;
  function newerThread(left:AssistantThread|undefined,right:AssistantThread|undefined){
    if(!left)return right;if(!right)return left;
    return right.version>left.version||right.version===left.version&&(right.summaryState?.updatedAt??0)>(left.summaryState?.updatedAt??0)?right:left;
  }
  function currentThreadFor(id:string){return newerThread(currentScope.current.snapshot.threads.find(thread=>thread.id===id),threadUpdatesRef.current[id]);}
  function summaryScopeVisible(id:string){const thread=currentThreadFor(id);return threadVisible(id)&&!!thread&&(!thread.summaryProof||thread.summaryProof.projectIds.every(currentScope.current.canSeeProject));}
  function mergeThread(thread:AssistantThread,expectedId:string,expectedEnvironment:string|undefined){
    if(!alive.current||thread.id!==expectedId||currentScope.current.environmentId!==expectedEnvironment||!threadVisible(expectedId))return;
    setThreadUpdates(current=>({...current,[expectedId]:newerThread(current[expectedId],thread)!}));
  }
  const initialProject=projects.some(item=>(item.id??item.path)===projectId)?projectId:(projects[0]?.id??projects[0]?.path??"");
  const [scope, setScope] = useState(initialProject?"project":"global");
  const [project, setProject] = useState(initialProject);
  const [messages, setMessages] = useState<Record<string, AssistantMessage[]>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("bycoda.assistant.thread-drafts") ?? "{}",
      );
    } catch {
      return {};
    }
  });
  const [pending, setPending] = useState(false);
  const [clearing,setClearing]=useState(false);
  const [threadMenu,setThreadMenu]=useState<HTMLElement|null>(null);
  const [summaryRefreshing,setSummaryRefreshing]=useState(false);
  const summaryPending=useRef(false);
  const [summaryError,setSummaryError]=useState<{threadId:string;text:string}|null>(null);
  const clearingRef=useRef(false);
  const searchEpoch=useRef(0);
  const [errorState, setErrorState] = useState({ key: privacy.key, text: "" });
  const error = errorState.key === privacy.key ? errorState.text : "";
  function setError(text: string) { setErrorState({ key: privacy.key, text }); }
  const [confirm, setConfirmState] = useState<ConfirmRequest | null>(null);
  const confirmScope = useRef(privacy.key);
  function setConfirm(request: ConfirmRequest | null) { confirmScope.current = privacy.key; setConfirmState(request); }
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const selected = useRef(threadId);
  selected.current = threadId;
  const requestKey = useRef<Record<string, { text: string; key: string;environmentId?:string;sessionId?:string }>>(
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("bycoda.assistant.send-intents") ?? "{}",
        );
      } catch {
        return {};
      }
    })(),
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        "bycoda.assistant.thread-drafts",
        JSON.stringify(drafts),
      );
    } catch {
      /* Keep editable memory. */
    }
  }, [drafts]);
  async function load(id: string, cursor?: Pick<AssistantMessage,"id"|"createdAt">) {
    if (!id || !threadVisible(id)) return;
    setPending(true);
    setError("");
    try {
      const capturedEnvironment=environmentId;
      const result = await assistantRequest({
        op: "threads.messages",
        threadId: id,
        limit: 100,
        ...(cursor ? { before:cursor.createdAt,beforeId:cursor.id } : {}),
      },capturedEnvironment);
      if(!alive.current||currentScope.current.environmentId!==capturedEnvironment||!threadVisible(id))return;
      if(result.thread)mergeThread(result.thread,id,environmentId);
      const list = result.messages ?? [];
      setMessages((current) => ({
        ...current,
        [id]: cursor ? [...list, ...(current[id] ?? [])] : list,
      }));
      setHasMore((current) => ({ ...current, [id]: list.length === 100 }));
    } catch (cause) {
      if (selected.current === id && threadVisible(id))
        setError(cause instanceof Error ? t(cause.message) : String(cause));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    void load(threadId);
  }, [threadId]);
  async function refreshSummary(){
    const target={threadId,environmentId,privacyKey:privacy.key};
    if(!target.threadId||!target.environmentId||summaryPending.current||clearingRef.current||!summaryScopeVisible(target.threadId))return;
    const current=()=>alive.current&&selected.current===target.threadId&&currentScope.current.environmentId===target.environmentId&&currentScope.current.privacy.key===target.privacyKey&&summaryScopeVisible(target.threadId);
    summaryPending.current=true;setSummaryRefreshing(true);setSummaryError(null);
    try{
      const thread=await refreshAssistantSummary(localStorage,target.environmentId,target.threadId,assistantRequest,current);
      if(current())mergeThread(thread,target.threadId,target.environmentId);
    }catch{
      if(current())setSummaryError({threadId:target.threadId,text:t("Summary refresh was not confirmed.")});
    }finally{
      summaryPending.current=false;if(alive.current)setSummaryRefreshing(false);
    }
  }
  async function open() {
    if (pending||clearingRef.current) return;
    if (scope !== "global" && !canSeeProject(project)) return;
    setPending(true);
    setError("");
    try {
      const result = await assistantRequest({
        op: "threads.open",
        ...(scope !== "global" && project ? { projectId: project } : {}),
      });
      if (result.thread) setThreadId(result.thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  async function send() {
    const text = (drafts[threadId] ?? "").trim();
    if (!text || pending||clearingRef.current || !threadVisible(threadId)) return;
    const previous = requestKey.current[threadId];
    if(previous&&previous.text!==text){setError(t("The reply has not been confirmed. Check the conversation before retrying."));return;}
    const sourceEnvironment=previous?previous.environmentId:environmentId;
    if(!sourceEnvironment){setError(t("The original Host could not be verified. Keep this draft and reconnect its original computer."));return;}
    setPending(true);
    setError("");
    const key = previous?.text === text ? previous.key : operationId();
    const sourceSession=previous?previous.sessionId:scope==="session"?sessionId:undefined;
    requestKey.current[threadId] = { text, key,environmentId:sourceEnvironment,...(sourceSession?{sessionId:sourceSession}:{}) };
    try {
      localStorage.setItem(
        "bycoda.assistant.send-intents",
        JSON.stringify(requestKey.current),
      );
    } catch {
      setError(
        t(
          "The send identity could not be saved. Keep this window open until the result is known.",
        ),
      );
      setPending(false);return;
    }
    try {
      const result = await assistantRequest({
        op: "threads.send",
        threadId,
        text,
        via: "text",
        idempotencyKey: key,
        ...(sourceSession ? { sessionId:sourceSession } : {}),
      },sourceEnvironment);
      if (!result.messages?.some((message) => message.role === "assistant"))
        throw new Error(
          t(
            "The reply has not been confirmed. Check the conversation before retrying.",
          ),
        );
      setMessages((current) => {
        const existing = current[threadId] ?? [];
        return {
          ...current,
          [threadId]: [
            ...existing,
            ...result.messages!.filter(
              (message) => !existing.some((item) => item.id === message.id),
            ),
          ],
        };
      });
      setDrafts((current) => ({
        ...current,
        [threadId]:
          (current[threadId] ?? "").trim() === text ? "" : current[threadId],
      }));
      delete requestKey.current[threadId];
      try {
        localStorage.setItem(
          "bycoda.assistant.send-intents",
          JSON.stringify(requestKey.current),
        );
      } catch {
        /* A retained receipt remains safe to retry. */
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  const [searchResults, setSearchResults] = useState<AssistantMessage[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  function clearConversation(){
    const thread=currentThreadFor(threadId);
    if(!thread||pending||clearingRef.current||summaryPending.current)return;
    const target={id:thread.id,version:thread.version};
    setConfirm({title:t("Clear this conversation?"),message:t("Move all messages in this conversation to Recently deleted for seven days. The saved summary and your unsent draft stay available."),confirmLabel:t("Clear all messages"),pendingLabel:t("Clearing..."),onConfirm:async()=>{
      if (!threadVisible(target.id)) return;
      if(clearingRef.current)return;
      clearingRef.current=true;setClearing(true);setError("");searchEpoch.current++;
      try{
        const result=await assistantRequest({op:"threads.clear",threadId:target.id,expectedVersion:target.version});
        if(result.thread?.id!==target.id)throw new Error(t("The conversation clear was not confirmed. Check before retrying."));
        mergeThread(result.thread,target.id,environmentId);
        setMessages(current=>({...current,[target.id]:[]}));setHasMore(current=>({...current,[target.id]:false}));
        setSearchResults(current=>current?current.filter(message=>message.threadId!==target.id):current);
      }finally{clearingRef.current=false;setClearing(false);}
    }});
  }
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const epoch=searchEpoch.current;
    setSearching(true);
    setSearchResults([]);
    const timer = setTimeout(() => {
      void assistantRequest({ op: "conversations.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled&&epoch===searchEpoch.current) setSearchResults(result.messages ?? []);
        })
        .catch((cause) => {
          if (!cancelled&&epoch===searchEpoch.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const visible = visibleAssistantMessages(searchResults ?? messages[threadId] ?? [], source, privacy);
  const supported = snapshot.capabilities.conversations;
  const currentThread=newerThread(snapshot.threads.find(thread=>thread.id===threadId),threadUpdates[threadId]);
  const summaryState=currentThread?.summaryState;
  const readySummaryVisible=summaryState?.status==="ready"&&!!currentThread?.summaryProof&&currentThread.summaryProof.projectIds.every(canSeeProject);
  const summaryLabel=summaryState?.status==="pending"||summaryState?.status==="working"?t("Updating conversation summary"):summaryState?.status==="blocked"?t("Conversation summary is waiting. Check its settings or refresh it."):readySummaryVisible?t("A verified conversation summary is available."):"";
  return (
    <div className={styles.conversations}>
      <aside className={styles.threadList} aria-label={t("Conversations")}>
        <div className={styles.stack}>
          <Select
            label={t("Scope")}
            value={scope}
            disabled={clearing}
            options={[
              ["global", "Global"],
              ["project", "Project"],
              ["session", "Session focus"],
            ].map(([value, label]) => ({ value, label: t(label) }))}
            onValueChange={setScope}
          />
          {scope !== "global" && (
            <SearchableSelect
              label={t("Project")}
              value={projects.some(item => (item.id ?? item.path) === project) ? project : ""}
              disabled={clearing||summaryRefreshing}
              options={projects.map((item) => ({
                value: item.id ?? item.path,
                label: item.name,
                description: item.path,
              }))}
              onChange={setProject}
            />
          )}
          <Button
            disabled={
              pending || clearing || summaryRefreshing ||
              (scope !== "global" && !project) ||
              (scope === "session" && !sessionId)
            }
            onClick={() => void open()}
          >
            {t("Open conversation")}
          </Button>
        </div>
        {[...snapshot.threads]
          .sort(
            (a, b) =>
              Number(Boolean(a.projectId)) - Number(Boolean(b.projectId)) ||
              b.updatedAt - a.updatedAt,
          )
          .map((thread) => (
            <Button
              key={thread.id}
              variant="item"
              selected={threadId === thread.id}
              disabled={clearing||summaryRefreshing}
              onClick={() => setThreadId(thread.id)}
            >
              <span className={styles.rowText}>
                {thread.projectId
                  ? (projects.find(
                      (project) =>
                        (project.id ?? project.path) === thread.projectId,
                    )?.name ?? thread.projectId)
                  : t("Global")}
                <span className={styles.muted}>{date(thread.updatedAt)}</span>
              </span>
            </Button>
          ))}
      </aside>
      <div className={styles.transcript}>
        <div className={styles.messageHistory}>
        {threadId&&<div className={styles.conversationActions}><Button iconOnly label={t("Conversation actions")} disabled={pending||clearing||summaryRefreshing} loading={clearing||summaryRefreshing} onClick={event=>setThreadMenu(event.currentTarget)}><MoreHorizontal size={15}/></Button></div>}
        {threadMenu&&<DropdownMenu anchor={threadMenu} label={t("Conversation actions")} onClose={()=>setThreadMenu(null)}
          onPick={id=>{setThreadMenu(null);if(id==="summary")void refreshSummary();else if(id==="clear")clearConversation();}} items={[{kind:"item",id:"summary",label:t(hasAssistantSummaryRefresh(localStorage,environmentId,threadId)?"Retry summary refresh":"Refresh conversation summary"),disabled:pending||clearing||summaryRefreshing||!environmentId||!summaryScopeVisible(threadId)},{kind:"item",id:"clear",label:t("Clear conversation..."),danger:true,disabled:pending||clearing||summaryRefreshing}]}/>}
        {(summaryRefreshing||summaryLabel)&&<p role="status" className={styles.muted}>{summaryRefreshing?t("Updating conversation summary"):summaryLabel}</p>}
        {summaryError?.threadId===threadId&&<p role="alert" className={styles.error}>{summaryError.text}</p>}
        {hasMore[threadId] && (
          <Button
            disabled={pending||clearing}
            onClick={() =>
              void load(threadId, messages[threadId]?.[0])
            }
          >
            {t("Load earlier messages")}
          </Button>
        )}
        {searching && <p role="status">{t("Loading...")}</p>}
        {!searching && !visible.length && (
          <p className={styles.empty}>
            {t(threadId ? "No messages to display" : "Open a conversation to begin")}
          </p>
        )}
        {visible.map((message) => (
          <article
            className={styles.message}
            key={message.id}
            data-author={message.role}
          >
            <div className={styles.rowHeading}>
              <span className={styles.muted}>
                {message.role === "user" ? t("You") : snapshot.profile.name} ·{" "}
                {t(message.via === "voice" ? "Voice" : "Text")} ·{" "}
                {date(message.createdAt)}
              </span>
              <Button
                iconOnly
                label={t("Delete message")}
                disabled={clearing}
                onClick={() =>
                  setConfirm({
                    title: t("Delete message?"),
                    message: message.text,
                    confirmLabel: t("Delete"),
                    onConfirm: async () => {
                      if (!messageVisible(message)) return;
                      await assistantRequest({
                        op: "messages.delete",
                        id: message.id,
                        expectedVersion: message.version,
                      });
                      setMessages((current) => ({
                        ...current,
                        [message.threadId]: (
                          current[message.threadId] ?? []
                        ).filter((item) => item.id !== message.id),
                      }));
                      setSearchResults(
                        (current) =>
                          current?.filter((item) => item.id !== message.id) ??
                          null,
                      );
                    },
                  })
                }
              >
                <Trash2 size={12} />
              </Button>
            </div>
            {message.ownerQuestionId&&<p className={styles.muted}>{t(message.ownerQuestionAction==="snooze"?"Question postponed":"Answer recorded")}</p>}
            <p className={styles.prewrap}>{message.text}</p>
            {!!message.toolActions?.length&&<details className={styles.muted}>
              <summary>{t("Recorded actions")} ({message.toolActions.length})</summary>
              <ul>{message.toolActions.map(action=><li key={action.id}>{action.family} · {action.action} — {t(action.status==="completed"?"Completed":"Outcome unknown")}</li>)}</ul>
            </details>}
            {message.sessionId && onOpenSession && (
              <Button
                variant="link"
                onClick={() => onOpenSession(message.sessionId!)}
              >
                {t("Open session")}
              </Button>
            )}
            {!!message.jobIds.length&&<details className={styles.relatedWork}><summary>{t("Jobs")} ({message.jobIds.length})</summary><div className={styles.stack}>{message.jobIds.map(id=>{
              const job=snapshot.jobs.find(job=>job.id===id);
              return job?<Button key={id} variant="link" onClick={()=>onJob(id)}>{job.title}</Button>:<span key={id} className={styles.muted}>{id}</span>;
            })}</div></details>}
          </article>
        ))}
        {error && (
          <div className={styles.feedback} role="alert">
            <span>{error}</span>
            <Button disabled={pending||clearing} onClick={() => void load(threadId)}>
              {t("Check conversation")}
            </Button>
          </div>
        )}
        </div>
        <div className={styles.composer}>
          <TextareaField
            label={t("Message {p0}", { p0: snapshot.profile.name })}
            value={threadId ? drafts[threadId] ?? "" : ""}
            disabled={!threadId}
            minRows={2}
            maxRows={8}
            maxLength={16000}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDrafts((current) => ({ ...current, [threadId]: value }));
            }}
          />
          <Button
            variant="primary"
            loading={pending}
            disabled={clearing||!threadId || !drafts[threadId]?.trim() || !supported}
            onClick={() => void send()}
          >
            {t("Send")}
          </Button>
        </div>
        {!supported && (
          <p className={styles.muted}>
            {t(
              "Conversation replies are unavailable. Configure a model on this Host.",
            )}
          </p>
        )}
        {confirm && confirmScope.current === privacy.key && (
          <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
        )}
      </div>
    </div>
  );
}

function AssistantSettings({
  request,
  environmentId,
  snapshot,
  manual,
  projects,
  onClose,
  onSetup,
}: {
  request:OwnerRequest;
  environmentId?:string;
  snapshot: AssistantSnapshot;
  manual: ManualSupervisionController;
  projects: readonly Project[];
  onClose: () => void;
  onSetup: () => void;
}) {
  const [assistantRequest]=useState(()=>request);
  const [draft, setDraft] = useState<AssistantProfilePatch>(() => ({
    ...snapshot.profile,
  }));
  const version = useRef(snapshot.profile.version);
  const [retention,setRetention]=useState(snapshot.conversationRetentionDays??0);
  const savedRetention=useRef(snapshot.conversationRetentionDays??0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    const {
      execution,
      chiefExecution,
      replyExecution,
      planningExecution,
      allowRoutineQuestions,
      name,
      showTitle,
      avatar,
      addressAs,
      language,
      autonomy,
      planApproval,
      dailyTokenBudget,
      perWakeTokenCap,
      proactiveSpeech,
      keepAwakeWhileWorking,
      quietStart,
      quietEnd,
      chiefSoftContext,
      chiefHardContext,
      workerSoftContext,
      workerHardContext,
      workerCompactPercent,
      workerHandoffPercent,
      stallMinutes,
    } = draft;
    try {
      const saved=await assistantRequest({
        op: "profile.update",
        expectedVersion: version.current,
        patch: {
          execution,
          chiefExecution,
          replyExecution,
          planningExecution,
          allowRoutineQuestions,
          name,
          showTitle,
          avatar,
          addressAs,
          language,
          autonomy,
          planApproval,
          dailyTokenBudget,
          perWakeTokenCap,
          proactiveSpeech,
          keepAwakeWhileWorking,
          quietStart,
          quietEnd,
          chiefSoftContext,
          chiefHardContext,
          workerSoftContext,
          workerHardContext,
          workerCompactPercent,
          workerHandoffPercent,
          stallMinutes,
        },
      });
      if(!saved.profile)throw new Error(t("The settings save was not confirmed. Check before retrying."));
      version.current=saved.profile.version;
      if(retention!==savedRetention.current){
        const result=await assistantRequest({op:"conversations.retention",days:retention as 0|30|90|365});
        if(result.ok!==true)throw new Error(t("The retention change was not confirmed. Check before retrying."));
        savedRetention.current=retention;
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={
        snapshot.profile.name
          ? t("Settings · {p0}", { p0: snapshot.profile.name })
          : t("Set up")
      }
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      fitViewport
      footerStart={
        <>
          <Button variant="ghost" disabled={pending} onClick={onSetup}>
            {t("Run setup again")}
          </Button>
          {error && <InlineError>{error}</InlineError>}
        </>
      }
      footer={
        <ModalActions>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!draft.name?.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={`${styles.stack} ${styles.modalBody}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {(
          [
            ["identity", "Identity"],
            ["language", "Language"],
            ["behavior", "Conversation behavior"],
            ["autonomy", "Autonomy"],
            ["presence", "Presence and hours"],
            ["cost", "Cost and context"],
          ] as const
        ).map(([section, label]) => (
          <details className={styles.settingsGroup} key={section} open={section==="identity"}>
            <summary>{t(label)}</summary>
            <div className={styles.stack}><AssistantProfileFields
              section={section}
              value={draft}
              onChange={(patch) =>
                setDraft((current) => ({ ...current, ...patch }))
              }
            />
            {section === "presence" && (
              <><AssistantPresenceStatus snapshot={snapshot} details/><AssistantKeepAwakeStatus state={snapshot.keepAwake} /></>
            )}</div>
          </details>
        ))}
        <details className={styles.settingsGroup}><summary>{t("Manual session supervision")}</summary><div className={styles.stack}>
          <ManualSessionSupervision key={environmentId??"unknown"} controller={manual} projects={projects} environmentId={environmentId} settings/>
        </div></details>
        <details className={styles.settingsGroup}><summary>{t("Computer use")}</summary><div className={styles.stack}><DesktopControlSettings /></div></details>
        <details className={styles.settingsGroup}><summary>{t("Conversation retention")}</summary><div className={styles.stack}>
          <Select label={t("Keep conversation messages")} value={String(retention)} disabled={pending}
            options={[[0,t("Forever")],[30,t("30 days")],[90,t("90 days")],[365,t("365 days")]].map(([value,label])=>({value:String(value),label:String(label)}))}
            onValueChange={value=>setRetention(Number(value))}/>
          <p className={styles.muted}>{t("Older messages move to Recently deleted for seven days. Summaries and unsent drafts are kept. Choosing Forever does not restore deleted messages.")}</p>
        </div></details>
        <details className={styles.settingsGroup}><summary>{t("Today's usage")}</summary><div className={styles.stack}>
          <p>
            {t("Chief tokens")}: {snapshot.usage.chiefTokens.toLocaleString()}
          </p>
          <p>
            {t("Worker tokens")}: {snapshot.usage.workerTokens.toLocaleString()}
          </p>
          {snapshot.usage.workerUsageIncomplete && (
            <p role="status" className={styles.muted}>
              {t("Usage unavailable. No zero usage is assumed.")}
            </p>
          )}
          <div role="group" aria-label={t("Worker cache usage")}><h3>{t("Worker cache usage")}</h3>
          {snapshot.usage.cacheUsage?<div className={styles.stack}><p>{t("{p0} of {p1} worker turns measured",{p0:snapshot.usage.cacheUsage.measuredTurns,p1:snapshot.usage.cacheUsage.totalTurns})}</p><p className={styles.muted}>{t(snapshot.usage.cacheUsage.complete?"All observed worker turns have cache measurements.":"Partial measurements. Missing cache usage is unavailable, not zero.")}</p><p>{t("Cache read tokens")}: {snapshot.usage.cacheUsage.cacheReadTokens===undefined?t("Unavailable"):snapshot.usage.cacheUsage.cacheReadTokens.toLocaleString()}</p><p>{t("Cache write tokens")}: {snapshot.usage.cacheUsage.cacheWriteTokens===undefined?t("Unavailable"):snapshot.usage.cacheUsage.cacheWriteTokens.toLocaleString()}</p><p>{t("Mean reported cache hit")}: {snapshot.usage.cacheUsage.cacheHitPercent===undefined?t("Unavailable"):`${snapshot.usage.cacheUsage.cacheHitPercent.toLocaleString(undefined,{maximumFractionDigits:1})}%`}</p>{snapshot.usage.cacheUsage.cacheHitPercent!==undefined&&<p className={styles.muted}>{t("Average of {p0} provider-reported worker percentages. This is not a billing discount.",{p0:snapshot.usage.cacheUsage.percentageTurns})}</p>}</div>:<p className={styles.muted}>{t("Cache usage unavailable")}</p>}</div>
        </div></details>
      </form>
    </Modal>
  );
}

function MemoryEditor({
  request,
  entry,
  onClose,
}: {
  request:OwnerRequest;
  entry: AssistantMemory | "new";
  onClose: () => void;
}) {
  const [assistantRequest]=useState(()=>request);
  const original = entry === "new" ? null : entry;
  const [text, setText] = useState(original?.text ?? "");
  const [kind, setKind] = useState<AssistantMemory["kind"]>(
    original?.kind ?? "rule",
  );
  const [scope, setScope] = useState<AssistantMemory["scope"]>(
    original?.scope ?? "all",
  );
  const [terms, setTerms] = useState(original?.forbiddenTerms.join(", ") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await assistantRequest({
        op: "memory.save",
        ...(original
          ? { id: original.id, expectedVersion: original.version }
          : {}),
        kind,
        text,
        scope,
        source: "typed",
        quote: text,
        active: original?.active ?? true,
        forbiddenTerms: terms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(original ? "Edit memory" : "Add memory")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      fitViewport
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!text.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={`${styles.stack} ${styles.modalBody}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Select
          visibleLabel
          label={t("Kind")}
          value={kind}
          options={[
            ["rule", "Rules"],
            ["profile", "About me"],
            ["fact", "Learned"],
          ].map(([value, label]) => ({ value, label: t(label) }))}
          onValueChange={(value) => setKind(value as typeof kind)}
        />
        <TextareaField
          label={t("Memory")}
          value={text}
          required
          maxLength={4000}
          minRows={4}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <Select
          visibleLabel
          label={t("Scope")}
          value={scope}
          options={[
            ["all", "Everywhere"],
            ["voice", "Voice only"],
            ["sessions", "Coding sessions only"],
          ].map(([value, label]) => ({ value, label: t(label) }))}
          onValueChange={(value) => setScope(value as typeof scope)}
        />
        <TextField
          label={t("Forbidden words")}
          description={t(
            "Optional, separated by commas. Text outputs are checked before delivery.",
          )}
          value={terms}
          onChange={(event) => setTerms(event.currentTarget.value)}
        />
      </form>
    </Modal>
  );
}

function NoteEditor({
  request,
  environmentId,
  note,
  onSaved,
  onClose,
}: {
  request:OwnerRequest;
  environmentId?:string;
  note: AssistantNote | "new";
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const original = note === "new" ? null : note;
  const [controller] = useState(() => new AssistantNoteDraft(original, localStorage, operationId,environmentId));
  const [draft, setDraft] = useState(() => controller.value);
  const { title, body } = draft;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const save = controller.save(request);
      setDraft(controller.value);
      await save;
      controller.clear();
      await onSaved();
      onClose();
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(original ? "Edit note" : "New note")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="lg"
      fitViewport
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!title.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={`${styles.stack} ${styles.modalBody}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label={t("Title")}
          value={title}
          required
          maxLength={300}
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => { controller.update({ title: event.currentTarget.value }); setDraft(controller.value); }}
        />
        <TextareaField
          label={t("Note")}
          value={body}
          minRows={12}
          maxRows={25}
          maxLength={100000}
          monospace
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => { controller.update({ body: event.currentTarget.value }); setDraft(controller.value); }}
        />
        {draft.intent && !pending && <p role="status" className={styles.muted}>{t("Note save is pending. Retry to verify the original note.")}</p>}
      </form>
    </Modal>
  );
}

function TrashPanel({
  request,
  entries,
  onRestored,
  onClose,
}: {
  request:OwnerRequest;
  entries: AssistantTrash[];
  onRestored: (id:string)=>void;
  onClose: () => void;
}) {
  const [assistantRequest]=useState(()=>request);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  async function restore(id: string) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      const result=await assistantRequest({ op: "trash.restore", id });
      if(result.ok!==true)throw new Error(t("The restore could not be confirmed. Check Recently deleted before retrying."));
      onRestored(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }
  return (
    <Modal
      title={t("Recently deleted")}
      onClose={onClose}
      size="md"
      fitViewport
    >
      <div className={`${styles.stack} ${styles.modalBody}`}>
        <p className={styles.muted}>
          {t(
            "Deleted records are kept for seven days. Restoring a job does not restart it.",
          )}
        </p>
        {!entries.length && (
          <p className={styles.empty}>{t("Nothing deleted recently")}</p>
        )}
        {entries.map((entry) => (
          <div className={styles.row} key={entry.id}>
            <div className={styles.rowText}>
              <strong>{entry.title}</strong>
              <p>
                {t(
                  entry.kind === "jobs"
                    ? "Jobs"
                    : entry.kind === "memory"
                      ? "Memory"
                      : entry.kind === "activity"
                        ? "History"
                        : entry.kind === "messages"
                          ? "Messages"
                          : "Notes",
                )}{" "}
                · {date(entry.deletedAt)}
              </p>
              <p>{t("Kept until {p0}", { p0: date(entry.expiresAt) })}</p>
              {entry.kind==="jobs"&&entry.deletedTaskCount!==undefined&&<p>{t("Includes {p0} deleted tasks. Restoring keeps them stopped.",{p0:entry.deletedTaskCount})}</p>}
            </div>
            <Button
              loading={pending === entry.id}
              disabled={Boolean(pending)}
              onClick={() => void restore(entry.id)}
            >
              {t("Restore")}
            </Button>
            <Button
              iconOnly
              label={t("Delete permanently")}
              disabled={Boolean(pending)}
              onClick={() =>
                setConfirm({
                  title: t("Delete permanently?"),
                  message: entry.title,
                  confirmLabel: t("Delete permanently"),
                  consequences: [t("This record cannot be restored.")],
                  onConfirm: async () => {
                    await assistantRequest({ op: "trash.purge", id: entry.id });
                  },
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {confirm && (
          <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
        )}
      </div>
    </Modal>
  );
}
