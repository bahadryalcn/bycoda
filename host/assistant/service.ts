import type { AssistantObservation } from "./observations/assistant-observation-journal";
import { createHash, randomUUID } from "node:crypto";
import {
  AssistantNarrationReceipts,
  type NarrationEvent,
  type NarrationReceipt,
  type NarrationIdentity,
} from "./voice/assistant-narration";
import {
  mergeNativeLibraryProofs,
  type NativeLibraryProof,
} from "./native/assistant-native-library-proof";
import { AssistantTextPreflightError } from "./core/assistant-text-budget";
import { ASSISTANT_QUEUE_FREE_READS, AssistantRequestQueue } from "./core/assistant-queue";
import {
  assistantPresenceState,
  readAssistantPresence,
  type AssistantPresenceObservation,
} from "./core/assistant-presence";
import { assistantAddressesOwner, assistantOwnerInstructions } from "./core/assistant-style";
import {
  DesktopOperationAuditSchema,
  desktopOperationAuditId,
  type DesktopOperationAudit,
} from "../desktop/desktop-control-audit";
import type { HostStore } from "../store";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantProfile,
  type AssistantJob,
  type AssistantJobStatus,
  type AssistantMemory,
  type AssistantThread,
  type AssistantMessage,
  type AssistantActivity,
  type AssistantNote,
  type AssistantSnapshot,
  type AssistantPresence,
  type AssistantUsage,
  type AssistantKeepAwakeStatus,
  type AssistantAutomaticPresence,
  type AssistantEffectivePresence,
  type AssistantNotification,
  type AssistantProjectJob,
  type AssistantQuickNoteJob,
  type AssistantQuickAutomationJob,
  type AssistantQuickJob,
} from "../../src/shared/model/host-contracts/assistant";
import { AssistantRepository, type AssistantTable, type RecordValue } from "./repository";
import { tokenBudgetMode } from "./cost";
import {
  assistantCacheMeasurement,
  assistantCacheUsage,
  type AssistantCacheMeasurement,
} from "./work/assistant-cache-usage";
import { compareAssistantJobPriority } from "../../src/shared/model/assistantJobPriority";
import { assistantRoleExecution } from "../../src/shared/model/assistantRoles";
import { assistantDetailedBriefingText, assistantUpdateFallback } from "./briefing";
import { readBriefingApprovals, recentBriefingNotes, briefingNoteLines } from "./briefing-sources";
import type { HostAssistantManualSessions } from "./sessions/assistant-manual-sessions";
import type {
  ManualSupervisionGrant,
  ManualSupervisionPolicy,
} from "../../src/shared/model/assistantManual";
import { workerContextAction } from "./cost";
import { assistantJobProjectIds } from "../../src/shared/model/assistantProjects";
import { normalizeAssistantQuickNoteAction } from "../../src/shared/model/assistantQuick";
import type {
  AssistantRecoveryRecord,
  AssistantRecoveryResult,
} from "./work/assistant-worker-recovery";
import { HostAssistantQuickJobs, assistantQuickFingerprint } from "./work/assistant-quick-jobs";
import {
  HostAssistantQuickAutomations,
  assistantQuickAutomationId,
  type AssistantQuickAutomationService,
} from "./work/assistant-quick-automations";
import { normalizeAssistantQuickAutomationAction } from "../../src/shared/model/assistantQuickAutomation";
import { validWorkerContextSettings } from "../../src/shared/model/assistantContext";
import {
  assistantPolicy,
  assistantActiveHours,
  validAssistantPolicy,
} from "../../src/shared/model/assistantPolicy";
import { assistantProfileDefaults } from "./profile-defaults";
import type { HostAssistantJobDeletion } from "./work/assistant-job-deletion";
import type { AsyncHostNotes } from "../host-notes-async";
import {
  assistantQuestionToken,
  type AssistantQuestionAnswer,
  type AssistantQuestionStatus,
} from "./core/assistant-questions";
import { parseChiefReadRequests, type ChiefReadRequest } from "./chief/assistant-chief-reads";
import { assertAssistantGoalProjects } from "./work/assistant-job-scope";
import { appendAssistantDailyNote } from "./work/assistant-daily-note";
import * as jobLog from "./work/assistant-job-activity";
import { GOAL_RESENT, hasErrorCode, resubmitGoal } from "./work/assistant-goal-recovery";
import type { HostGoal } from "../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import {
  HostAssistantVoiceContexts,
  type AssistantVoiceToolSource,
} from "./voice/assistant-voice-context";
import { legacyMessageProofs } from "./voice/assistant-voice-project-proofs";
import { HostAssistantThreadSummaries } from "./summary/assistant-thread-summary";
import {
  HostAssistantOwnerQuestions,
  type AssistantOwnerProposalSource,
  type AssistantOwnerProposalBinding,
} from "./core/assistant-owner-questions";
import type { AssistantOwnerQuestion } from "../../src/shared/model/assistantOwnerQuestions";
import { replaceControlCharacters } from "../../src/shared/lib/controlCharacters";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { utcDay } from "../../src/shared/lib/time/timestamps";
import {
  runRoomManagementTurn,
  type RoomManagementCall,
  type RoomManagementAdmission,
  type RoomManagementResult,
  type RoomManagementTurnResult,
  type RoomManagementTurnState,
} from "./management/assistant-management-turn";
import { newRequestId } from "../../src/shared/lib/id/requestId";

export type AssistantPrincipal = "owner" | "assistant" | "chief";
export type AssistantUsageTurn = {
  key: string;
  tokens: number;
  at?: number;
  operationId?: string;
  settled: boolean;
  cacheMetrics?: AssistantCacheMeasurement;
};
export type AssistantGoalStatus = {
  status: AssistantJobStatus;
  taskIds: string[];
  sessionIds: string[];
  progress: { done: number; total: number };
  summary?: string;
  tokens?: number;
  tokensComplete?: boolean;
  usageTurns?: AssistantUsageTurn[];
  usageIncomplete?: boolean;
  lastActivityAt?: number;
  runningChildren?: boolean;
  sessionQuestions?: AssistantQuestionStatus[];
};
export interface AssistantPorts {
  withNativeVoiceRuntimeRegistration?<T>(
    input: {
      threadId: string;
      generationKey: string;
      nativeProofs: NativeLibraryProof[];
      projectProofs: { projectId: string; cwd: string }[];
      accountProofs: { accountId: string; version: string }[];
    },
    admission: RoomManagementAdmission,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
  roomNativeProofsValid?(
    proofs: NativeLibraryProof[],
    admission?: RoomManagementAdmission,
  ): Promise<boolean>;
  withNativeVoiceSourcesRetired?<T>(effect: (valid: () => boolean) => Promise<T>): Promise<T>;
  withVoiceNarrationAuthorization?<T>(
    input: {
      threadId: string;
      generation: string;
      eventId: string;
      projectIds: string[];
      accountProofs?: { accountId: string; version: string }[];
    },
    admission: RoomManagementAdmission,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
  roomManagement?(
    call: RoomManagementCall,
    admission: RoomManagementAdmission,
  ): Promise<RoomManagementResult>;
  roomAccountProofsValid?(
    threadId: string,
    proofs: { accountId: string; version: string }[],
  ): Promise<boolean>;
  roomProjectProofsValid?(proofs: { projectId: string; cwd: string }[]): Promise<boolean>;
  withSummarySourceDisclosure?<T>(
    targetThreadId: string,
    projectProofs: { projectId: string; cwd: string }[],
    accountProofs: { accountId: string; version: string }[],
    effect: (valid: () => boolean) => Promise<T>,
    expectedNative?: {
      installationId: string;
      revision: string;
      issuer: string;
      deviceHash: string;
    },
    nativeProofs?: NativeLibraryProof[],
  ): Promise<T>;
  withRoomProjectDisclosure?<T>(
    threadId: string,
    projectIds: string[],
    admission: RoomManagementAdmission,
    effect: (valid: () => boolean) => Promise<T>,
    projectProofs?: { projectId: string; cwd: string }[],
  ): Promise<T>;
  withRoomAccountDisclosure?<T>(
    threadId: string,
    proofs: { accountId: string; version: string }[],
    admission: RoomManagementAdmission,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
  withRoomResponseDisclosure?<T>(
    scopes: {
      threadId: string;
      projects: string[];
      accounts: { accountId: string; version: string }[];
      projectProofs?: { projectId: string; cwd: string }[];
      nativeProofs?: NativeLibraryProof[];
    }[],
    admission: RoomManagementAdmission,
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
  roomObservationDelivered?(
    threadId: string,
    observations: unknown[],
    accounts: { accountId: string; version: string }[],
    valid: () => boolean,
    projectProofs?: { projectId: string; cwd: string }[],
    nativeProofs?: NativeLibraryProof[],
  ): Promise<void>;
  roomManagementVisible?(
    threadId: string,
    projectIds: string[],
    admission: RoomManagementAdmission,
  ): Promise<boolean>;
  observationTasksReady?(): boolean;
  observedTaskDeliveryConfigured?(): boolean;
  pollObservedTasks?(
    projectIds: string[],
    accept: (
      event: AssistantObservation & { id: string; sequence: number },
      guard: () => boolean,
    ) => Promise<boolean>,
    active: () => boolean,
  ): Promise<void>;
  /** Transport supplies a live source permit and holds it through actual disclosure. */
  taskNotificationAllowed?(notification: AssistantNotification): Promise<boolean>;
  listProjects?(): Promise<{ id: string; path: string; name: string }[]>;
  createGoal?(input: { job: AssistantJob; profile: AssistantProfile }): Promise<{ goalId: string }>;
  findGoal?(jobId: string, job?: AssistantJob): Promise<{ goalId: string } | undefined>;
  goalStatus?(
    goalId: string,
    profile?: AssistantProfile,
    knownSessionIds?: string[],
    job?: AssistantJob,
  ): Promise<AssistantGoalStatus>;
  setGoalBudgetHeld?(goalId: string, held: boolean): Promise<void>;
  setGoalHoursHeld?(goalId: string, held: boolean): Promise<void>;
  hasRunningChildren?(goalIds: string[]): Promise<boolean>;
  readPresence?(): Promise<{ supported: boolean; locked: boolean; idleMs?: number }>;
  controlGoal?(
    goalId: string,
    action: "pause" | "resume" | "stop",
    job?: AssistantJob,
  ): Promise<void>;
  replanGoal?(goalId: string, feedback: string, job?: AssistantJob): Promise<void>;
  manageSession?(input: {
    jobId: string;
    sessionId: string;
    requestId: string;
    text: string;
    reason: "nudge" | "answer" | "steer";
  }): Promise<void | AssistantRecoveryResult>;
  answerSession?(
    input: AssistantQuestionAnswer & { jobId: string; sessionId: string; requestId: string },
  ): Promise<void>;
  detachSession?(input: {
    jobId: string;
    sessionId: string;
    expectedVersion: number;
  }): Promise<{ detached: true }>;
  manual?: HostAssistantManualSessions;
  manualProjectVisible?(projectId: string): Promise<boolean>;
  manualUsage?(
    grant: ManualSupervisionGrant,
  ): Promise<{ turns: AssistantUsageTurn[]; incomplete: boolean }>;
  manageManualSession?(input: {
    supervisionId: string;
    sessionId: string;
    requestId: string;
    text: string;
    reason: "nudge" | "answer" | "steer";
  }): Promise<void>;
  onPause?(): void;
  onResume?(): void;
  onJobPause?(id: string): void;
  onJobResume?(id: string): void;
  keepAwake?(enabled: boolean): Promise<AssistantKeepAwakeStatus>;
  markManagedSessions?(job: AssistantJob): Promise<void>;
  chiefReadSnapshot?(
    profile: AssistantProfile,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  chiefRead?(
    input: { operationId: string; requests: ChiefReadRequest[] },
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  chiefWake?(input: {
    profile: AssistantProfile;
    stateCard: string;
    events: AssistantActivity[];
    tokenCap: number;
    operationId: string;
    signal: AbortSignal;
    contextPolicy: { soft: number; hard: number };
  }): Promise<{ tokens?: number; actions?: AssistantRequest[]; reads?: ChiefReadRequest[] }>;
  reply?(input: {
    profile: AssistantProfile;
    thread: AssistantThread;
    messages: AssistantMessage[];
    instructions: string;
    tokenCap: number;
    operationId: string;
    signal: AbortSignal;
    managementPrompt?: string;
  }): Promise<{ text: string; tokens?: number }>;
  summarize?(input: {
    profile: AssistantProfile;
    thread: AssistantThread;
    messages: AssistantMessage[];
    instructions: string;
    tokenCap: number;
    operationId: string;
    signal: AbortSignal;
  }): Promise<{ text: string; tokens?: number }>;
  listNotes?(): Promise<AssistantNote[]>;
  getNote?(id: string): Promise<AssistantNote | null>;
  quickNotes?(): Pick<AsyncHostNotes, "get" | "save">;
  quickAutomations?(): AssistantQuickAutomationService;
  jobDeletion?: HostAssistantJobDeletion;
  saveNote?(
    input: {
      id?: string;
      title: string;
      body: string;
      expectedUpdatedAt?: number;
    },
    authorized?: () => Promise<boolean>,
  ): Promise<AssistantNote>;
  deleteNote?(
    id: string,
    expectedUpdatedAt: number,
    authorized?: () => Promise<boolean>,
  ): Promise<void>;
  now?(): number;
  onChange?(): void;
  onError?(error: unknown): void;
}
type Runtime = RecordValue & { value: unknown };
type WorkerReservation = {
  tokens: number;
  remaining: number;
  day: string;
  operationId: string;
  jobId?: string;
  supervisionId?: string;
  phase?: "compact" | "handoff" | "send" | "answer";
  answerSource?: { sessionId: string; runId: string; questionToken: string; turnBlockId: string };
  answeredBlockId?: string;
};
type PendingNotification = Omit<AssistantNotification, "eligible" | "deferredReason"> & {
  acknowledgedAt?: number;
  supersededBy?: string;
};
type ObservedNotificationIntent = {
  threadId: string;
  notificationId: string;
  projectId: string;
  taskId: string;
  taskCreatedAt: number;
  taskRevision: number;
  deviceHash: string;
  kind: "task.done" | "task.needsInput";
  operationHash: string;
  state: "prepared" | "pending" | "accepted" | "suppressed" | "unknown";
};
type ChiefWakeInput = Omit<Parameters<NonNullable<AssistantPorts["chiefWake"]>>[0], "signal">;
type ChiefIntent = {
  operationId: string;
  day: string;
  tokenCap: number;
  eventIds: string[];
  status: "running" | "response" | "unknown" | "capacity";
  capacityKey?: string;
  input?: ChiefWakeInput;
  actions?: AssistantRequest[];
  reads?: ChiefReadRequest[];
  tokens?: number;
  estimated?: boolean;
};
const DAY = 86400000;
const terminal = new Set<AssistantJobStatus>(["done", "failed", "cancelled"]);

/** One Host-owned supervisor. All requests and ticks share admission. SQLite
 * transactions contain only local durable work; external effects use durable
 * dispatch intent and a stable goal id. Ambiguous effects are read, never replayed. */
export class HostAssistant {
  private readonly nativeSendInstance = randomUUID();
  private readonly pendingJobStops = new Set<string>();
  readonly ready: Promise<void>;
  private readonly repository: AssistantRepository;
  private readonly queue = new AssistantRequestQueue();
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private emergencyStop = false;
  private chiefTurn = false;
  private disposal?: Promise<void>;
  private keepAwakeStatus?: AssistantKeepAwakeStatus;
  private readonly quickJobs?: HostAssistantQuickJobs;
  private readonly quickAutomations?: HostAssistantQuickAutomations;
  private readonly ownerQuestions: HostAssistantOwnerQuestions;
  private readonly voiceContexts: HostAssistantVoiceContexts;
  private readonly threadSummaries: HostAssistantThreadSummaries;
  private quickPolicyEpoch = 0;
  private readonly quickJobEpochs = new Map<string, number>();
  constructor(
    private readonly store: HostStore,
    private readonly ports: AssistantPorts = {},
  ) {
    this.repository = new AssistantRepository(store);
    const repositoryReady = this.repository.initialize();
    this.ownerQuestions = new HostAssistantOwnerQuestions(
      store,
      () => this.now(),
      (input) => this.ownerProposalSource(input),
    );
    this.voiceContexts = new HostAssistantVoiceContexts(store, {
      now: () => this.now(),
      thread: async (id) => (await this.repository.get<AssistantThread>("threads", id)) ?? null,
      message: async (id) => {
        const message = await this.repository.get<AssistantMessage>("messages", id);
        return message ? this.messageProjectScope(message) : null;
      },
      messageProjectProofs: (message) => this.messageProjectProofs(message),
      messageNativeProofs: (message) => this.messageNativeProofs(message),
      summary: async (threadId, id) => this.threadSummaries.proof(threadId, "", id),
      summarySources: async (threadId, id) => this.threadSummaries.sourceProofs(threadId, id),
      summarySourcesValid: async (threadId, sources) =>
        (!sources.projectProofs.length ||
          (!!this.ports.roomProjectProofsValid &&
            (await this.ports.roomProjectProofsValid(sources.projectProofs)))) &&
        (!sources.accountProofs.length ||
          (!!this.ports.roomAccountProofsValid &&
            (await this.ports.roomAccountProofsValid(threadId, sources.accountProofs)))),
    });
    this.threadSummaries = new HostAssistantThreadSummaries(store, {
      ready: repositoryReady,
      now: () => this.now(),
      profile: () => this.profile(),
      message: async (id) => {
        const message = await this.repository.get<AssistantMessage>("messages", id);
        return message ? this.messageProjectScope(message) : null;
      },
      visible: async (id) => (await this.ports.manualProjectVisible?.(id)) === true,
      sourceProofs: async (messages, projectIds, previous) => {
        const projects = new Map<string, string>(),
          accounts = new Map<string, string>();
        let nativeProofs = mergeNativeLibraryProofs(previous?.nativeProofs ?? []);
        const add = (map: Map<string, string>, key: string, value: string) => {
          if (!key || !value || (map.has(key) && map.get(key) !== value))
            throw new Error("Summary source identity changed.");
          map.set(key, value);
        };
        for (const proof of previous?.projectProofs ?? [])
          add(projects, proof.projectId, proof.cwd);
        for (const proof of previous?.accountProofs ?? [])
          add(accounts, proof.accountId, proof.version);
        for (const message of messages) {
          const projectProofs = await this.messageProjectProofs(message),
            accountProofs = await this.messageAccountProofs(message);
          const messageNative = await this.messageNativeProofs(message);
          if (!messageNative) throw new Error("Summary Native source provenance is unavailable.");
          nativeProofs = mergeNativeLibraryProofs(nativeProofs, messageNative);
          if (
            !projectProofs ||
            !accountProofs ||
            (message.role === "assistant" &&
              (message.projectIds ?? []).some(
                (id) => !projectProofs.some((proof) => proof.projectId === id),
              ))
          )
            throw new Error("Summary source provenance is unavailable.");
          for (const proof of projectProofs) add(projects, proof.projectId, proof.cwd);
          for (const proof of accountProofs) add(accounts, proof.accountId, proof.version);
        }
        for (const projectId of projectIds)
          if (!projects.has(projectId))
            add(projects, projectId, (await this.store.project(projectId)).cwd);
        if (projects.size > 1000 || accounts.size > 100)
          throw new Error("Summary source scope is too large.");
        return {
          projectProofs: [...projects].map(([projectId, cwd]) => ({ projectId, cwd })),
          accountProofs: [...accounts].map(([accountId, version]) => ({ accountId, version })),
          nativeProofs,
        };
      },
      validateSourceProofs: async (threadId, proofs) =>
        (!proofs.projectProofs.length ||
          (!!this.ports.roomProjectProofsValid &&
            (await this.ports.roomProjectProofsValid(proofs.projectProofs)))) &&
        (!proofs.accountProofs.length ||
          (!!this.ports.roomAccountProofsValid &&
            (await this.ports.roomAccountProofsValid(threadId, proofs.accountProofs)))) &&
        (!proofs.nativeProofs?.length ||
          (!!this.ports.roomNativeProofsValid &&
            (await this.ports.roomNativeProofsValid(proofs.nativeProofs)))),
      withDisclosure: async (threadId, proofs, effect) => {
        if (proofs.nativeProofs?.length) {
          if (!this.ports.withSummarySourceDisclosure)
            throw new Error("Summary Native source admission is unavailable.");
          return this.ports.withSummarySourceDisclosure(
            threadId,
            proofs.projectProofs,
            proofs.accountProofs,
            effect,
            undefined,
            proofs.nativeProofs,
          );
        }
        if (!proofs.projectProofs.length && !proofs.accountProofs.length) return effect(() => true);
        if (!this.ports.withSummarySourceDisclosure)
          throw new Error("Summary source admission is unavailable.");
        return this.ports.withSummarySourceDisclosure(
          threadId,
          proofs.projectProofs,
          proofs.accountProofs,
          effect,
        );
      },
      admission: () => this.summaryAdmission(),
      reserve: (id, admission) => this.reserveSummary(id, admission),
      settle: (id, day, reserved, tokens, estimated) =>
        this.settleSummary(id, day, reserved, tokens, estimated),
      generate: async (input) => {
        const profile = await this.profile();
        if (
          !this.ports.summarize ||
          this.closing ||
          this.emergencyStop ||
          !profile.enabled ||
          !profile.setupComplete ||
          (await this.runtime("paused", false)) ||
          !assistantActiveHours(profile, this.now()) ||
          JSON.stringify(assistantRoleExecution(profile, "reply")) !==
            JSON.stringify(assistantRoleExecution(input.profile, "reply"))
        )
          throw new AssistantTextPreflightError();
        input.signal.throwIfAborted();
        return this.ports.summarize(input);
      },
      instructions: async () => (await this.instructions("voice")).slice(0, 12000),
      safeOutput: (text) => this.safeOutput(text),
      event: async (kind, tokens) => {
        await this.activity(
          kind,
          kind === "conversation.summaryUpdated"
            ? "A verified rolling conversation summary was updated."
            : kind === "conversation.summaryDeferred"
              ? "A summary is waiting for capacity or source settings."
              : "A summary attempt needs owner review before another attempt.",
          tokens === undefined ? {} : { tokens },
        );
      },
    });
    this.quickJobs = ports.quickNotes
      ? new HostAssistantQuickJobs(store, {
          notes: ports.quickNotes,
          authorized: (job) => this.quickJobAuthorized(job),
          now: () => this.now(),
        })
      : undefined;
    this.quickAutomations = ports.quickAutomations
      ? new HostAssistantQuickAutomations(store, {
          automations: ports.quickAutomations,
          authorized: (job) => this.quickJobAuthorized(job),
          now: () => this.now(),
        })
      : undefined;
    this.ready = Promise.all([
      repositoryReady,
      this.ownerQuestions.ready,
      this.voiceContexts.ready,
      this.threadSummaries.ready,
      this.quickJobs?.ready,
      this.quickAutomations?.ready,
      ports.jobDeletion?.ready,
    ]).then(async () => {
      const profile = await this.profile();
      if (profile.enabled && profile.setupComplete)
        await this.store.transaction(() => this.ensureGlobalRoom(), "critical");
    });
  }
  private async ensureGlobalRoom(): Promise<AssistantThread> {
    return (
      (await this.repository.byKey<AssistantThread>("threads", "global")) ??
      (await this.repository.put("threads", { ...this.stamp(), summary: "" }, 0, "global"))
    );
  }
  async globalRoomBinding(): Promise<{ id: string } | null> {
    await this.ready;
    const profile = await this.profile();
    if (
      !profile.enabled ||
      !profile.setupComplete ||
      this.closing ||
      this.emergencyStop ||
      (await this.runtime("paused", false))
    )
      return null;
    return this.canonicalGlobalRoomBinding();
  }
  async canonicalGlobalRoomBinding(): Promise<{ id: string } | null> {
    await this.ready;
    const room = await this.repository.byKey<AssistantThread>("threads", "global");
    return room && !room.projectId ? { id: room.id } : null;
  }
  /** Read-only native handoff check; unknown or changed canonical state denies delivery. */
  async authorizeObservedNotification(
    input: { threadId: string; notificationId: string; operationHash: string },
    deviceHash: string,
    allowPrepared = false,
  ): Promise<boolean> {
    if ((await this.globalRoomBinding())?.id !== input.threadId) return false;
    const intent = await this.runtime<ObservedNotificationIntent | null>(
      `observed-notification-intent:${input.notificationId}`,
      null,
    );
    if (
      !intent ||
      intent.state === "unknown" ||
      intent.state === "suppressed" ||
      (!allowPrepared && intent.state === "prepared") ||
      intent.deviceHash !== deviceHash ||
      intent.threadId !== input.threadId ||
      intent.notificationId !== input.notificationId ||
      intent.operationHash !== input.operationHash ||
      !(await this.manualProjectAllowed(intent.projectId))
    )
      return false;
    return this.store.db.scope(async () => {
      const current = await this.runtime<ObservedNotificationIntent | null>(
        `observed-notification-intent:${input.notificationId}`,
        null,
      );
      const notification = await this.runtime<PendingNotification | null>(
        `notification:${input.notificationId}`,
        null,
      );
      const profile = await this.profile(),
        policy = assistantPolicy(profile),
        manual = await this.manualPolicy();
      const presence = await this.effectivePresence(),
        hour = new Date(this.now()).getHours();
      const quiet =
        profile.quietStart !== profile.quietEnd &&
        (profile.quietStart < profile.quietEnd
          ? hour >= profile.quietStart && hour < profile.quietEnd
          : hour >= profile.quietStart || hour < profile.quietEnd);
      const choice = presence === "present" ? policy.notificationPresent : policy.notificationAway;
      const urgent = intent.kind === "task.needsInput";
      if (
        !current ||
        JSON.stringify(current) !== JSON.stringify(intent) ||
        !notification ||
        notification.acknowledgedAt ||
        notification.supersededBy ||
        notification.kind !== intent.kind ||
        notification.projectId !== intent.projectId ||
        notification.taskId !== intent.taskId ||
        notification.taskCreatedAt !== intent.taskCreatedAt ||
        this.closing ||
        this.emergencyStop ||
        (await this.runtime("paused", false)) ||
        !profile.enabled ||
        !profile.setupComplete ||
        !manual.enabled ||
        !manual.projectIds.includes(intent.projectId) ||
        (intent.kind === "task.done"
          ? !policy.observationTaskDone
          : !policy.observationTaskNeedsInput) ||
        presence === "unknown" ||
        presence === "dnd" ||
        quiet ||
        !(choice === "all" || (choice === "urgent" && urgent))
      )
        return false;
      const revision = await this.store.db
        .prepare(
          "SELECT version FROM assistant_observation_source_revisions WHERE source='task' AND source_id=?",
        )
        .get(intent.taskId);
      const row = await this.store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(intent.taskId);
      const task = row
        ? (JSON.parse(String(row.value)) as {
            id?: string;
            projectId?: string;
            createdAt?: number;
            status?: string;
            needsInput?: boolean;
          })
        : undefined;
      return (
        Number(revision?.version) === intent.taskRevision &&
        !!task &&
        task.id === intent.taskId &&
        task.projectId === intent.projectId &&
        task.createdAt === intent.taskCreatedAt &&
        (intent.kind === "task.done"
          ? task.status === "done"
          : task.needsInput === true && task.status !== "done")
      );
    });
  }
  async observedNotificationTargets(): Promise<{ id: string; projectId: string }[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare(
        "SELECT n.value FROM assistant_runtime n WHERE n.id LIKE 'notification:%' AND n.deleted_at IS NULL AND json_extract(n.value,'$.value.acknowledgedAt') IS NULL AND json_extract(n.value,'$.value.supersededBy') IS NULL AND json_extract(n.value,'$.value.kind') IN ('task.done','task.needsInput') AND NOT EXISTS (SELECT 1 FROM assistant_runtime i WHERE i.id='observed-notification-intent:' || json_extract(n.value,'$.value.id') AND json_extract(i.value,'$.value.state') IN ('accepted','suppressed')) ORDER BY n.updated_at,n.id LIMIT 20",
      )
      .all();
    return rows
      .map((row) => (JSON.parse(String(row.value)) as Runtime).value as PendingNotification)
      .filter((item): item is PendingNotification & { projectId: string } => !!item.projectId)
      .map((item) => ({ id: item.id, projectId: item.projectId }));
  }
  async observedNotificationIntent(
    notificationId: string,
  ): Promise<ObservedNotificationIntent | null> {
    return this.runtime<ObservedNotificationIntent | null>(
      `observed-notification-intent:${notificationId}`,
      null,
    );
  }
  async observedNotificationRecovery(
    projectId: string,
  ): Promise<{ notificationId: string; projectId: string; state: "pending" | "unknown" }[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'observed-notification-intent:%' AND deleted_at IS NULL AND json_extract(value,'$.value.projectId')=? AND json_extract(value,'$.value.state') IN ('pending','unknown') ORDER BY updated_at,id LIMIT 100",
      )
      .all(projectId);
    return rows
      .map((row) => (JSON.parse(String(row.value)) as Runtime).value as ObservedNotificationIntent)
      .map((intent) => ({
        notificationId: intent.notificationId,
        projectId: intent.projectId,
        state: intent.state as "pending" | "unknown",
      }));
  }
  async prepareObservedNotification(
    threadId: string,
    notificationId: string,
    projectId: string,
    deviceHash: string,
    valid: () => boolean,
  ): Promise<ObservedNotificationIntent | null> {
    if (
      !valid() ||
      (await this.globalRoomBinding())?.id !== threadId ||
      !(await this.manualProjectAllowed(projectId))
    )
      return null;
    const intent = await this.store.transaction(async () => {
      if (!valid()) throw new Error("Task notification source changed.");
      const existing = await this.runtime<ObservedNotificationIntent | null>(
        `observed-notification-intent:${notificationId}`,
        null,
      );
      if (existing && existing.state !== "prepared") return null;
      const item = await this.runtime<PendingNotification | null>(
        `notification:${notificationId}`,
        null,
      );
      if (
        !item ||
        item.acknowledgedAt ||
        item.supersededBy ||
        item.projectId !== projectId ||
        !item.taskId ||
        item.taskCreatedAt === undefined ||
        (item.kind !== "task.done" && item.kind !== "task.needsInput")
      )
        return null;
      const revision = await this.store.db
        .prepare(
          "SELECT version FROM assistant_observation_source_revisions WHERE source='task' AND source_id=?",
        )
        .get(item.taskId);
      const taskRevision = Number(revision?.version);
      if (!Number.isSafeInteger(taskRevision) || taskRevision < 1) return null;
      const identity = {
        threadId,
        notificationId,
        projectId,
        taskId: item.taskId,
        taskCreatedAt: item.taskCreatedAt,
        taskRevision,
        deviceHash,
        kind: item.kind,
      };
      const operationHash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
      const next: ObservedNotificationIntent = { ...identity, operationHash, state: "prepared" };
      await this.setRuntime(`observed-notification-intent:${notificationId}`, next);
      if (!valid()) throw new Error("Task notification source changed.");
      return next;
    }, "critical");
    if (
      !intent ||
      !valid() ||
      !(await this.authorizeObservedNotification(intent, deviceHash, true))
    )
      return null;
    return intent;
  }
  async armObservedNotification(
    intent: ObservedNotificationIntent,
    valid: () => boolean,
  ): Promise<boolean> {
    return this.store.transaction(async () => {
      const current = await this.runtime<ObservedNotificationIntent | null>(
        `observed-notification-intent:${intent.notificationId}`,
        null,
      );
      if (
        !valid() ||
        !current ||
        current.state !== "prepared" ||
        current.operationHash !== intent.operationHash
      )
        return false;
      await this.setRuntime(`observed-notification-intent:${intent.notificationId}`, {
        ...current,
        state: "pending",
      });
      if (!valid()) throw new Error("Task notification source changed.");
      return true;
    }, "critical");
  }
  async settleObservedNotification(
    intent: ObservedNotificationIntent,
    state: "accepted" | "suppressed" | "unknown",
  ): Promise<void> {
    await this.store.transaction(async () => {
      const current = await this.runtime<ObservedNotificationIntent | null>(
        `observed-notification-intent:${intent.notificationId}`,
        null,
      );
      if (
        (current?.state === "pending" || current?.state === "unknown") &&
        current.operationHash === intent.operationHash
      )
        await this.setRuntime(`observed-notification-intent:${intent.notificationId}`, {
          ...current,
          state,
        });
    }, "critical");
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private jobOutput(job: AssistantJob): AssistantJob {
    return job.kind === "quick" && job.projectId !== null
      ? {
          ...job,
          projectIds: assistantJobProjectIds(job),
          quickIntent: { automationId: assistantQuickAutomationId(job.id) },
        }
      : { ...job, projectIds: assistantJobProjectIds(job) };
  }
  private async quickJobAuthorized(job: AssistantQuickJob): Promise<boolean> {
    await this.ready;
    await this.store.db.checkAuthorization();
    if (
      this.closing ||
      this.emergencyStop ||
      this.pendingJobStops.has(job.id) ||
      this.quickJobEpochs.get(job.id) !== this.quickPolicyEpoch ||
      (await this.runtime("paused", false))
    )
      return false;
    const profile = await this.profile(),
      current = await this.repository.get<AssistantJob>("jobs", job.id);
    if (
      !profile.enabled ||
      !profile.setupComplete ||
      !current ||
      current.kind !== "quick" ||
      !["running", "waiting"].includes(current.status) ||
      current.version !== job.version ||
      assistantQuickFingerprint(current) !== assistantQuickFingerprint(job)
    )
      return false;
    if (job.quickAction.kind === "automation") {
      const projectId = job.quickAction.projectId;
      if (
        current.projectId !== projectId ||
        JSON.stringify(current.projectIds) !== JSON.stringify([projectId]) ||
        !((await this.ports.listProjects?.()) ?? []).some((project) => project.id === projectId)
      )
        return false;
    }
    return (
      !this.closing &&
      !this.emergencyStop &&
      !this.pendingJobStops.has(job.id) &&
      this.quickJobEpochs.get(job.id) === this.quickPolicyEpoch
    );
  }
  private async runQuickJob(original: AssistantQuickJob): Promise<void> {
    if (
      (original.projectId === null ? !this.quickJobs : !this.quickAutomations) ||
      this.closing ||
      this.emergencyStop ||
      this.pendingJobStops.has(original.id) ||
      (await this.runtime("paused", false)) ||
      ["paused", "done", "cancelled", "failed"].includes(original.status)
    )
      return;
    let job = original;
    if (job.status === "queued")
      job = await this.store.transaction(
        () =>
          this.repository.put<AssistantQuickJob>(
            "jobs",
            { ...job, status: "running", dispatchState: "unknown", updatedAt: this.now() },
            job.version,
          ),
        "critical",
      );
    this.quickJobEpochs.set(job.id, this.quickPolicyEpoch);
    const result = await (
      job.projectId === null ? this.quickJobs!.run(job) : this.quickAutomations!.run(job)
    ).finally(() => this.quickJobEpochs.delete(job.id));
    if (
      this.closing ||
      this.emergencyStop ||
      this.pendingJobStops.has(job.id) ||
      (await this.runtime("paused", false))
    )
      return;
    await this.store.transaction(async () => {
      const current = await this.repository.get<AssistantJob>("jobs", job.id);
      if (
        !current ||
        current.kind !== "quick" ||
        current.version !== job.version ||
        ["paused", "cancelled", "done", "failed"].includes(current.status) ||
        assistantQuickFingerprint(current) !== assistantQuickFingerprint(job)
      )
        return;
      const status = result.state === "completed" ? "done" : "waiting";
      const quickResult =
        current.projectId === null && "noteId" in result && result.noteId
          ? { noteId: result.noteId }
          : current.projectId !== null && "automationId" in result && result.automationId
            ? { automationId: result.automationId }
            : undefined;
      if (
        current.status === status &&
        current.summary === result.message &&
        JSON.stringify(current.quickResult) === JSON.stringify(quickResult)
      )
        return;
      const updates = {
        status: status as AssistantJobStatus,
        summary: result.message,
        dispatchState: result.state === "completed" ? ("submitted" as const) : ("unknown" as const),
        progress: { done: result.state === "completed" ? 1 : 0, total: 1 },
        tokens: 0,
        tokensComplete: true,
        updatedAt: this.now(),
      };
      const noteId = "noteId" in result ? result.noteId : undefined,
        automationId = "automationId" in result ? result.automationId : undefined;
      const value: AssistantQuickJob =
        current.projectId === null
          ? { ...current, ...updates, quickResult: noteId ? { noteId } : current.quickResult }
          : {
              ...current,
              ...updates,
              quickResult: automationId ? { automationId } : current.quickResult,
            };
      const next = await this.repository.put<AssistantQuickJob>("jobs", value, current.version);
      const event = await this.activity(`job.${status}`, result.message, { jobId: job.id });
      await this.queueNotification({
        id: event.id,
        kind: status === "done" ? "job.done" : "job.waiting",
        title: next.title,
        body: result.message,
        createdAt: this.now(),
        jobId: job.id,
        ...(job.projectId ? { projectId: job.projectId } : {}),
        projectIds: assistantJobProjectIds(job),
      });
    }, "critical");
  }
  async ownerPresence(): Promise<AssistantPresence> {
    await this.ready;
    return this.runtime("presence", { state: "present", since: this.now(), updatedAt: this.now() });
  }
  private async effectivePresence(): Promise<AssistantEffectivePresence> {
    const manual = await this.ownerPresence();
    if (manual.state !== "present") return manual.state;
    const automatic = await this.runtime<AssistantAutomaticPresence | null>(
      "automaticPresence",
      null,
    );
    if (!automatic || this.now() - automatic.updatedAt > 90000 || automatic.state === "unknown")
      return "unknown";
    return automatic.state === "locked" ? "away" : automatic.state;
  }
  private async syncPresence(observed?: AssistantPresenceObservation) {
    const old = await this.runtime<AssistantAutomaticPresence | null>("automaticPresence", null);
    if (old && this.now() - old.updatedAt < 15000 && this.now() >= old.updatedAt) return;
    const observation = observed ?? (await readAssistantPresence(this.ports.readPresence));
    const read = assistantPresenceState(observation, assistantPolicy(await this.profile()));
    const automatic: AssistantAutomaticPresence = {
      ...read,
      since: old?.state === read.state ? old.since : this.now(),
      updatedAt: this.now(),
      supported: observation.supported,
    };
    const returnedSince = await this.store.transaction(async () => {
      await this.setRuntime("automaticPresence", automatic);
      const effective = await this.effectivePresence(),
        absence = await this.runtime<number | null>("presenceAbsenceSince", null);
      if (effective === "unknown") {
        if (absence !== null) await this.setRuntime("presenceAbsenceSince", null);
      } else if (effective !== "present") {
        if (absence === null) await this.setRuntime("presenceAbsenceSince", this.now());
      } else if (absence !== null) {
        await this.setRuntime("presenceAbsenceSince", null);
        if (this.now() - absence >= 1800000) return absence;
      }
    });
    if (returnedSince !== undefined)
      await this.prepareBriefing(returnedSince, undefined, this.now());
  }
  private async queueNotification(value: Omit<PendingNotification, "acknowledgedAt">) {
    if (await this.runtime<PendingNotification | null>(`notification:${value.id}`, null)) return;
    await this.setRuntime(`notification:${value.id}`, {
      ...value,
      title: (await this.safeOutput(value.title)).slice(0, 200),
      body: (await this.safeOutput(value.body)).slice(0, 2000),
    });
  }
  private async notifications(profile: AssistantProfile): Promise<AssistantNotification[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'notification:%' AND deleted_at IS NULL AND json_extract(value,'$.value.acknowledgedAt') IS NULL AND json_extract(value,'$.value.supersededBy') IS NULL AND (?=1 OR json_extract(value,'$.value.kind') NOT IN ('task.done','task.needsInput')) ORDER BY updated_at,id LIMIT 100",
      )
      .all(this.ports.taskNotificationAllowed ? 1 : 0);
    const presence = await this.effectivePresence(),
      hour = new Date(this.now()).getHours();
    const quiet =
      profile.quietStart !== profile.quietEnd &&
      (profile.quietStart < profile.quietEnd
        ? hour >= profile.quietStart && hour < profile.quietEnd
        : hour >= profile.quietStart || hour < profile.quietEnd);
    const approvals = new Map<string, Promise<boolean>>();
    const disclosed = await Promise.all(
      rows.map(async (row) => {
        const {
          acknowledgedAt: _,
          supersededBy: __,
          ...value
        } = (JSON.parse(row.value) as Runtime).value as PendingNotification;
        if (value.kind === "task.done" || value.kind === "task.needsInput") {
          if (
            !value.projectId ||
            !value.taskId ||
            value.taskCreatedAt === undefined ||
            !this.ports.taskNotificationAllowed ||
            !(await this.ports.taskNotificationAllowed({
              ...value,
              eligible: false,
              deferredReason: "unknown",
            }))
          )
            return null;
          const currentManual = await this.manualPolicy();
          const currentProfile = await this.profile();
          const currentPolicy = assistantPolicy(currentProfile);
          if (
            !currentManual.enabled ||
            !currentManual.projectIds.includes(value.projectId) ||
            !currentProfile.enabled ||
            !currentProfile.setupComplete ||
            (value.kind === "task.done"
              ? !currentPolicy.observationTaskDone
              : !currentPolicy.observationTaskNeedsInput)
          )
            return null;
          const row = await this.store.db
            .prepare("SELECT value FROM tasks WHERE id=?")
            .get(value.taskId);
          const task = row
            ? (JSON.parse(String(row.value)) as {
                id?: string;
                projectId?: string;
                status?: string;
                needsInput?: boolean;
                createdAt?: number;
              })
            : undefined;
          if (
            !task ||
            task.id !== value.taskId ||
            task.projectId !== value.projectId ||
            task.createdAt !== value.taskCreatedAt ||
            (value.kind === "task.done"
              ? task.status !== "done"
              : task.needsInput !== true || task.status === "done")
          )
            return null;
          if (
            !(await this.ports.taskNotificationAllowed({
              ...value,
              eligible: false,
              deferredReason: "unknown",
            }))
          )
            return null;
        }
        let urgent =
          value.kind === "budget.exhausted" ||
          value.kind === "job.failed" ||
          value.kind === "task.needsInput";
        if (value.kind === "job.waiting" && value.jobId) {
          let pending = approvals.get(value.jobId);
          if (!pending) {
            pending = (async () => {
              const job = await this.repository.get<AssistantJob>("jobs", value.jobId!);
              return !!job && (await readBriefingApprovals(this.store, [job], 1)).items.length > 0;
            })();
            approvals.set(value.jobId, pending);
          }
          urgent = await pending;
        }
        const policy = assistantPolicy(profile),
          choice = presence === "present" ? policy.notificationPresent : policy.notificationAway;
        const reason: AssistantNotification["deferredReason"] =
          !profile.enabled || !profile.setupComplete || presence === "unknown"
            ? "unknown"
            : presence === "dnd"
              ? "dnd"
              : quiet
                ? "quiet"
                : choice === "all" || (choice === "urgent" && urgent)
                  ? null
                  : presence === "present"
                    ? "settings"
                    : presence;
        return {
          ...value,
          title: (await this.safeOutput(value.title)).slice(0, 200),
          body: (await this.safeOutput(value.body)).slice(0, 2000),
          eligible: reason === null,
          deferredReason: reason,
        };
      }),
    );
    return disclosed.filter((item): item is AssistantNotification => item !== null).slice(0, 100);
  }
  /** Notes are a separate worker/database: never await its admission while holding Host SQL. */
  private async prepareBriefing(since: number, key?: string, returnAt?: number) {
    if (key && (await this.runtime(`dailyBriefing:${key}`, false))) return;
    if (!key && (await this.runtime<number>("lastReturnBriefingAt", -1)) >= since) return;
    let notes: AssistantNote[] = [],
      notesAvailable = !!this.ports.listNotes;
    try {
      if (this.ports.listNotes)
        notes = recentBriefingNotes(await this.ports.listNotes(), this.now());
    } catch (error) {
      notesAvailable = false;
      this.ports.onError?.(error);
    }
    await this.store.transaction(
      () => this.createBriefing(since, key, notes, notesAvailable, returnAt),
      "critical",
    );
  }
  private async createBriefing(
    since: number,
    key: string | undefined,
    notes: AssistantNote[],
    notesAvailable: boolean,
    returnAt?: number,
  ) {
    if (key && (await this.runtime(`dailyBriefing:${key}`, false))) return;
    if (!key && (await this.runtime<number>("lastReturnBriefingAt", -1)) >= since) return;
    const events = (await this.repository.list<AssistantActivity>("activity", 100)).filter(
      (event) => event.createdAt >= since,
    );
    const jobs = await this.repository.list<AssistantJob>("jobs", 10000);
    const completionRows = await this.store.db
      .prepare(
        "SELECT DISTINCT json_extract(value,'$.jobId') AS job_id FROM assistant_activity WHERE deleted_at IS NULL AND json_extract(value,'$.kind')='job.done' AND json_extract(value,'$.createdAt')>=? AND json_extract(value,'$.createdAt')<=? LIMIT 10000",
      )
      .all(since, this.now());
    const waitingJobs = jobs.filter((job) => job.status === "waiting" || job.status === "failed"),
      finishedIds = new Set(completionRows.map((row) => row.job_id)),
      doneJobs = jobs.filter((job) => job.status === "done" && finishedIds.has(job.id)),
      runningJobs = jobs.filter((job) => ["planning", "running", "stalled"].includes(job.status));
    const decisions = (await this.ownerQuestions.list()).filter(
        (question) =>
          question.status === "open" ||
          (question.status === "snoozed" && (question.snoozedUntil ?? 0) <= this.now()),
      ),
      approvals = await readBriefingApprovals(this.store, jobs);
    const waiting = waitingJobs.length,
      done = doneJobs.length;
    if (!key && !events.length && !waiting && !done && !decisions.length && !approvals.items.length)
      return;
    const projectIds = new Set(
      [...waitingJobs, ...doneJobs, ...runningJobs.slice(0, 4)].flatMap(assistantJobProjectIds),
    );
    let completeScope = true;
    const manualGrants =
      events.some((event) => event.supervisionId) || notes.length
        ? ((await this.ports.manual?.listAllForUsage()) ?? [])
        : [];
    const eventProjects = async (event: AssistantActivity): Promise<string[] | undefined> => {
      if (event.jobId) {
        const job = await this.repository.get<AssistantJob>("jobs", event.jobId, true);
        return job ? assistantJobProjectIds(job) : undefined;
      }
      if (event.ownerQuestionId)
        return (await this.ownerQuestions.get(event.ownerQuestionId)).ownerQuestion?.projectIds;
      if (event.supervisionId) {
        const projectId = manualGrants.find((grant) => grant.id === event.supervisionId)?.source
          .projectId;
        return projectId ? [projectId] : undefined;
      }
      if (event.sessionId) {
        try {
          return [(await this.store.session(event.sessionId)).projectId];
        } catch {
          return;
        }
      }
      if (
        /^(profile|memory|conversation|chief|budget|presence|voice|desktop)\./.test(event.kind) ||
        event.kind === "manual.policy"
      )
        return [];
      return undefined;
    };
    for (const event of events) {
      const scope = await eventProjects(event);
      if (scope) for (const id of scope) projectIds.add(id);
      else completeScope = false;
    }
    for (const decision of decisions) for (const id of decision.projectIds) projectIds.add(id);
    for (const approval of approvals.items)
      for (const id of approval.projectIds) projectIds.add(id);
    let notesIncomplete = !notesAvailable;
    const noteDetails: string[] = [];
    for (const note of notes)
      for (const line of briefingNoteLines(note)) {
        if (noteDetails.length >= 4) break;
        let known = true;
        const scopes: string[] = [];
        for (const id of line.eventIds) {
          const event = await this.repository.get<AssistantActivity>("activity", id, true),
            scope = event ? await eventProjects(event) : undefined;
          if (scope) scopes.push(...scope);
          else known = false;
        }
        if (!known) {
          notesIncomplete = true;
          continue;
        }
        for (const id of scopes) projectIds.add(id);
        if (line.text) noteDetails.push(`${note.title}: ${line.text}`);
      }
    const profile = await this.profile();
    const language =
      profile.language === "auto"
        ? (await this.runtime<{ language: string } | null>("lastSpokenLanguage", null))?.language
        : profile.language;
    const describe = (job: AssistantJob) => `${job.title}${job.summary ? `: ${job.summary}` : ""}`;
    const safeDetails = (values: string[]) =>
      Promise.all(
        values
          .slice(0, 4)
          .map((value) => this.safeOutput(value.replace(/\s+/g, " ").slice(0, 280))),
      );
    const briefing = {
      id: randomUUID(),
      text: await this.safeOutput(
        assistantDetailedBriefingText(
          language,
          {
            waiting,
            done,
            updates: events.length,
            hour: new Date(this.now()).getHours(),
            addressAs: assistantAddressesOwner(profile) ? profile.addressAs : undefined,
          },
          {
            decisions: await safeDetails(
              decisions.map(
                (question) =>
                  question.prompt.title ?? question.prompt.questions[0]?.prompt ?? question.id,
              ),
            ),
            approvals: await safeDetails(
              approvals.items.map((approval) => `${approval.title} (${approval.count})`),
            ),
            waiting: await safeDetails(waitingJobs.map(describe)),
            done: await safeDetails(doneJobs.map(describe)),
            running: await safeDetails(runningJobs.map(describe)),
            notes: await safeDetails(noteDetails),
            notesUnavailable: notesIncomplete,
            approvalsIncomplete: !approvals.complete,
          },
        ),
      ),
      createdAt: this.now(),
      ...(!key && returnAt !== undefined
        ? {
            voiceReceipt: {
              reason: "return" as const,
              returnAt,
              meaningful: !!(waiting || done || decisions.length || approvals.items.length),
              important: !!(waiting || decisions.length || approvals.items.length),
            },
          }
        : {}),
      ...(completeScope && projectIds.size <= 1000 ? { projectIds: [...projectIds].sort() } : {}),
    };
    briefing.text = briefing.text.slice(0, 6000);
    await this.setRuntime("briefing", briefing);
    const previous = await this.store.db
      .prepare(
        "SELECT id,value FROM assistant_runtime WHERE id LIKE 'notification:%' AND json_extract(value,'$.value.kind')='briefing' AND json_extract(value,'$.value.acknowledgedAt') IS NULL AND json_extract(value,'$.value.supersededBy') IS NULL",
      )
      .all();
    for (const row of previous)
      await this.setRuntime(String(row.id), {
        ...((JSON.parse(row.value) as Runtime).value as PendingNotification),
        supersededBy: briefing.id,
      });
    await this.queueNotification({
      id: briefing.id,
      kind: "briefing",
      title: "Your assistant update",
      body: briefing.text,
      createdAt: briefing.createdAt,
    });
    if (key) {
      await this.setRuntime(`dailyBriefingArtifact:${key}`, briefing);
      await this.setRuntime(`dailyBriefing:${key}`, briefing.id);
    } else await this.setRuntime("lastReturnBriefingAt", this.now());
  }
  async supervisionAllowed(): Promise<boolean> {
    await this.ready;
    const profile = await this.profile();
    return (
      !this.closing &&
      !this.emergencyStop &&
      profile.enabled &&
      profile.setupComplete &&
      profile.autonomy === "chief" &&
      assistantActiveHours(profile, this.now()) &&
      !(await this.runtime("paused", false)) &&
      (await this.usage(profile)).mode === "run"
    );
  }
  async routineQuestionsAllowed(): Promise<boolean> {
    return (
      (await this.profile()).allowRoutineQuestions === true && (await this.supervisionAllowed())
    );
  }
  async nudgeLimit(): Promise<number> {
    await this.ready;
    return assistantPolicy(await this.profile()).nudgeLimit;
  }
  async beginVoiceToolDisclosure(input: { contextId: string; requestId: string }) {
    await this.ready;
    return this.voiceContexts.begin(input);
  }
  async pendingVoiceGeneration(contextId: string, requestId: string, threadId: string) {
    return this.voiceContexts.pendingGeneration(contextId, requestId, threadId);
  }
  async finishVoiceToolDisclosure(id: string, source: AssistantVoiceToolSource) {
    await this.ready;
    return this.voiceContexts.finish(id, source);
  }
  async failVoiceToolDisclosure(id: string): Promise<void> {
    await this.ready;
    await this.voiceContexts.fail(id);
  }
  async voiceActionsForMessage(id: string) {
    await this.ready;
    return this.voiceContexts.actionsForMessage(id);
  }
  /** Read-only final admission; this restricts canonical assistant work and grants nothing. */
  async autonomousJobAllowed(goalId: string): Promise<boolean> {
    await this.ready;
    return this.store.db.scope(async () => {
      if (!goalId.startsWith("assistant-"))
        return !(await this.store.db
          .prepare(
            "SELECT 1 FROM assistant_jobs WHERE deleted_at IS NULL AND json_extract(value,'$.goalId')=? LIMIT 1",
          )
          .get(goalId));
      const id = goalId.slice("assistant-".length),
        job = await this.repository.get<AssistantJob>("jobs", id);
      if (
        !job ||
        job.kind === "quick" ||
        (job.goalId !== undefined && job.goalId !== goalId) ||
        (job.goalId === undefined &&
          (job.status !== "planning" || job.dispatchState !== "unknown")) ||
        ["queued", "done", "failed", "paused", "cancelled"].includes(job.status) ||
        job.pendingTaskDeletion ||
        job.awaitingOwnerRestart
      )
        return false;
      try {
        const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(goalId);
        if (!row) return false;
        const goal = JSON.parse(row.value) as HostGoal;
        assertAssistantGoalProjects(job, goal);
        if (goal.status === "cancelled" || goal.awaitingOwnerRestart) return false;
        const rows = await this.store.db
            .prepare("SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=?")
            .all(goalId),
          tasks = rows.map((row) => JSON.parse(row.value) as HostTask);
        if (
          tasks.length !== goal.taskIds.length ||
          new Set(goal.taskIds).size !== goal.taskIds.length ||
          tasks.some(
            (task) =>
              !goal.taskIds.includes(task.id) ||
              !assistantJobProjectIds(job).includes(task.projectId),
          )
        )
          return false;
        if (
          await this.store.db
            .prepare(
              "SELECT goal_id FROM task_goal_holds WHERE goal_id=? UNION SELECT goal_id FROM task_goal_reason_holds WHERE goal_id=? AND reason='assistant-budget' UNION SELECT goal_id FROM task_goal_deletion_holds WHERE goal_id=? LIMIT 1",
            )
            .get(goalId, goalId, goalId)
        )
          return false;
      } catch {
        return false;
      }
      const profile = await this.profile();
      if (
        !profile.enabled ||
        !profile.setupComplete ||
        profile.autonomy === "report" ||
        !assistantActiveHours(profile, this.now()) ||
        (await this.usage(profile)).mode !== "run" ||
        (await this.runtime("paused", false))
      )
        return false;
      return !this.closing && !this.emergencyStop && !this.pendingJobStops.has(job.id);
    });
  }
  async manualPolicy(): Promise<ManualSupervisionPolicy> {
    await this.ready;
    return this.runtime("manualPolicy", { enabled: false, version: 0, projectIds: [] });
  }
  async identityName(): Promise<string> {
    await this.ready;
    return (await this.profile()).name;
  }
  async nativePresenceStatus() {
    await this.ready;
    const profile = await this.profile();
    return {
      state: await this.effectivePresence(),
      setupComplete: profile.setupComplete,
      assistantName: profile.name.slice(0, 80),
    };
  }
  async manualSupervisionAllowed(): Promise<boolean> {
    return (await this.manualPolicy()).enabled && (await this.supervisionAllowed());
  }
  async workerRecoveryAllowed(jobId?: string): Promise<boolean> {
    return (!jobId || !this.pendingJobStops.has(jobId)) && (await this.supervisionAllowed());
  }
  async recordWorkerRecovery(record: AssistantRecoveryRecord): Promise<void> {
    await this.ready;
    if (!["queued", "unknown", "escalated"].includes(record.state)) return;
    const key = `workerRecoveryEvent:${record.operationId}:${record.state}`;
    let event: AssistantActivity | undefined;
    await this.store.transaction(async () => {
      if (await this.runtime(key, false)) return;
      const job = await this.repository.get<AssistantJob>("jobs", record.source.jobId);
      if (
        job &&
        job.status !== "paused" &&
        !terminal.has(job.status) &&
        ["unknown", "escalated"].includes(record.state)
      )
        await this.repository.put(
          "jobs",
          {
            ...job,
            status: "waiting",
            summary: record.message.slice(0, 4000),
            updatedAt: this.now(),
          },
          job.version,
        );
      event = await this.activity(
        `job.recovery${record.state[0].toUpperCase()}${record.state.slice(1)}`,
        record.message,
        {
          jobId: record.source.jobId,
          sessionId: record.launchedSessionId ?? record.source.sessionId,
        },
      );
      await this.setRuntime(key, event.id);
    }, "critical");
    if (event) await this.appendDailyNote(await this.profile(), [event]);
    this.ports.onChange?.();
  }
  async recordManualLimit(supervisionId: string, sessionId: string): Promise<void> {
    await this.ready;
    let event: AssistantActivity | undefined;
    const key = `manualLimit:${supervisionId}:${sessionId}`;
    await this.store.transaction(async () => {
      if (await this.runtime(key, false)) return;
      event = await this.activity(
        "manual.escalated",
        "An enrolled conversation reached its two-nudge limit. Owner review is required; its work was not cancelled or retried.",
        { supervisionId, sessionId },
      );
      await this.setRuntime(key, event.id);
    }, "critical");
    if (event) await this.appendDailyNote(await this.profile(), [event]);
    this.ports.onChange?.();
  }
  async manualProjectAllowed(projectId: string): Promise<boolean> {
    const policy = await this.manualPolicy();
    return (
      policy.projectIds.includes(projectId) &&
      ((await this.ports.listProjects?.()) ?? []).some((project) => project.id === projectId) &&
      (await this.ports.manualProjectVisible?.(projectId)) === true
    );
  }
  private async manualResult(): Promise<AssistantResponse> {
    if (!this.ports.manual) throw new Error("Manual supervision is unavailable on this Host.");
    return {
      manual: {
        policy: await this.manualPolicy(),
        grants: await this.ports.manual.list(),
        candidates: await this.ports.manual.listCandidates("owner"),
      },
    };
  }
  private async messageProjectScope(
    message: AssistantMessage,
    ancestors = new Set<string>(),
    context: { cache: Map<string, Promise<AssistantMessage>>; visited: number } = {
      cache: new Map(),
      visited: 0,
    },
  ): Promise<AssistantMessage> {
    // Never trust a persisted/client-derived convenience stamp. Rebuild every
    // acknowledgement, page and search result from canonical linked records.
    const {
      projectIds: _,
      toolActions: _actions,
      visibilityProjectIds: _visibility,
      unverifiedToolContext: _unverified,
      ...canonicalValue
    } = message;
    let value: AssistantMessage = canonicalValue;
    {
      const source = await this.runtime<{ managementTurnId?: string } | null>(
        message.role === "assistant"
          ? `messageScopeSources:${message.id}`
          : `messageRoomTurn:${message.id}`,
        null,
      );
      if (source?.managementTurnId) {
        const turn = await this.runtime<RoomManagementTurnState | null>(
          source.managementTurnId,
          null,
        );
        const restrictions = new Set<string>();
        if (turn?.threadId === message.threadId) {
          for (const record of turn.calls)
            if (record.call.projectId) restrictions.add(record.call.projectId);
          for (const id of turn.result?.contributorProjectIds ?? []) restrictions.add(id);
          try {
            const context = JSON.parse(turn.context) as { messages?: AssistantMessage[] };
            for (const entry of context.messages ?? [])
              for (const id of entry.projectIds ?? []) restrictions.add(id);
          } catch {
            /* Missing context cannot prove global provenance. */
          }
        }
        value = {
          ...value,
          visibilityProjectIds: [...restrictions].sort(),
          ...(message.role === "assistant" && !turn?.result?.contributorProjectIds
            ? { unverifiedToolContext: true as const }
            : {}),
        };
      }
    }
    if (ancestors.has(message.id) || ancestors.size >= 64) return value;
    const cached = context.cache.get(message.id);
    if (cached) return cached;
    if (++context.visited > 1000) return value;
    const work = (async () => {
      const projects = new Set<string>(),
        thread = await this.repository.get<AssistantThread>("threads", message.threadId, true);
      if (!thread) return value;
      if (thread.projectId) projects.add(thread.projectId);
      if (message.sessionId) {
        try {
          projects.add((await this.store.session(message.sessionId)).projectId);
        } catch {
          return value;
        }
      }
      for (const id of message.jobIds ?? []) {
        const job = await this.repository.get<AssistantJob>("jobs", id, true);
        if (!job) return value;
        for (const projectId of assistantJobProjectIds(job)) projects.add(projectId);
      }
      if (message.ownerQuestionId || message.ownerQuestionRequestId) {
        const proof = await this.runtime<{
          questionId: string;
          requestId: string;
          version: number;
        } | null>(`messageScopeQuestion:${message.id}`, null);
        if (
          !proof ||
          proof.questionId !== message.ownerQuestionId ||
          proof.requestId !== message.ownerQuestionRequestId
        )
          return value;
        const source = await this.ownerQuestions.get(proof.questionId, proof.requestId),
          question = source.ownerQuestion,
          receipt = source.ownerQuestionReceipt;
        if (
          !question ||
          question.threadId !== message.threadId ||
          !receipt ||
          receipt.requestId !== proof.requestId ||
          receipt.version !== proof.version ||
          receipt.input.id !== question.id ||
          receipt.kind !== message.ownerQuestionAction
        )
          return value;
        const scope = await this.ownerQuestions.retainedScope(proof.questionId, proof.requestId);
        if (!scope) return value;
        for (const projectId of scope) projects.add(projectId);
        return { ...value, projectIds: [...projects].sort() };
      }
      if (message.role === "assistant") {
        const voice =
          message.via === "voice"
            ? await this.runtime<{ contextId: string; version: number; threadId: string } | null>(
                `messageScopeVoice:${message.id}`,
                null,
              )
            : null;
        if (voice) {
          if (voice.threadId !== message.threadId) return value;
          const scope = await this.voiceContexts.historicalScope(
            voice.contextId,
            voice.version,
            message.threadId,
          );
          return scope
            ? { ...value, projectIds: [...new Set([...projects, ...scope])].sort() }
            : value;
        }
        const sources = await this.runtime<{
          threadId: string;
          messageIds: string[];
          summaryUsed: boolean;
          summaryProofId?: string;
          managementTurnId?: string;
        } | null>(`messageScopeSources:${message.id}`, null);
        // Direct voice/assistant appends have broader uncaptured context. An
        // empty refs array cannot certify their text as global or project-only.
        if (
          !sources ||
          sources.threadId !== message.threadId ||
          !Array.isArray(sources.messageIds) ||
          !sources.messageIds.length ||
          sources.messageIds.length > 6
        )
          return value;
        if (sources.summaryUsed) {
          const proof = sources.summaryProofId
            ? await this.threadSummaries.proof(message.threadId, "", sources.summaryProofId)
            : undefined;
          if (!proof) return value;
          for (const id of proof.projectIds) projects.add(id);
        }
        if (sources.managementTurnId) {
          const turn = await this.runtime<RoomManagementTurnState | null>(
            sources.managementTurnId,
            null,
          );
          if (
            !turn ||
            turn.phase !== "settled" ||
            turn.threadId !== message.threadId ||
            !turn.result?.contributorProjectIds
          )
            return value;
          for (const id of turn.result.contributorProjectIds) projects.add(id);
        }
        const path = new Set(ancestors);
        path.add(message.id);
        for (const id of sources.messageIds) {
          const source = await this.repository.get<AssistantMessage>("messages", id);
          if (!source || source.threadId !== sources.threadId) return value;
          const scoped = await this.messageProjectScope(source, path, context);
          if (!scoped.projectIds) return value;
          for (const projectId of scoped.projectIds) projects.add(projectId);
        }
      }
      return projects.size > 1000 ? value : { ...value, projectIds: [...projects].sort() };
    })();
    context.cache.set(message.id, work);
    return work;
  }
  /** Rebuild account restrictions from trusted Room receipts and their source messages. */
  private async messageNativeProofs(
    message: AssistantMessage,
    ancestors = new Set<string>(),
  ): Promise<NativeLibraryProof[] | undefined> {
    if (message.role !== "assistant") return [];
    if (message.via === "voice") {
      const voice = await this.runtime<{
        contextId: string;
        version: number;
        threadId: string;
      } | null>(`messageScopeVoice:${message.id}`, null);
      if (voice)
        return voice.threadId === message.threadId
          ? this.voiceContexts.historicalNativeProofs(
              voice.contextId,
              voice.version,
              message.threadId,
            )
          : undefined;
    }
    if (ancestors.has(message.id) || ancestors.size >= 64) return undefined;
    const path = new Set(ancestors);
    path.add(message.id);
    const sources = await this.runtime<{
      threadId?: string;
      messageIds?: string[];
      managementTurnId?: string;
      summaryProofId?: string;
    } | null>(`messageScopeSources:${message.id}`, null);
    if (!sources) return [];
    if (
      sources.threadId !== message.threadId ||
      !Array.isArray(sources.messageIds) ||
      sources.messageIds.length > 6
    )
      return undefined;
    let proofs: NativeLibraryProof[] = [];
    try {
      if (sources.summaryProofId) {
        const summary = await this.threadSummaries.sourceProofs(
          message.threadId,
          sources.summaryProofId,
        );
        if (!summary) return undefined;
        proofs = mergeNativeLibraryProofs(proofs, summary.nativeProofs ?? []);
      }
      if (sources.managementTurnId) {
        const turn = await this.runtime<RoomManagementTurnState | null>(
          sources.managementTurnId,
          null,
        );
        if (!turn || turn.threadId !== message.threadId || turn.phase !== "settled" || !turn.result)
          return undefined;
        for (const record of turn.calls) {
          if (
            record.call.input.nativeLibrary === true &&
            record.status === "completed" &&
            !record.contributorNativeProofs?.length
          )
            return undefined;
          proofs = mergeNativeLibraryProofs(proofs, record.contributorNativeProofs ?? []);
        }
        proofs = mergeNativeLibraryProofs(proofs, turn.result.contributorNativeProofs ?? []);
      }
      for (const id of sources.messageIds) {
        const source = await this.repository.get<AssistantMessage>("messages", id);
        if (!source || source.threadId !== message.threadId) return undefined;
        const inherited = await this.messageNativeProofs(source, path);
        if (!inherited) return undefined;
        proofs = mergeNativeLibraryProofs(proofs, inherited);
      }
      return proofs;
    } catch {
      return undefined;
    }
  }
  private async messageAccountProofs(
    message: AssistantMessage,
    ancestors = new Set<string>(),
  ): Promise<{ accountId: string; version: string }[] | undefined> {
    if (message.role !== "assistant") return [];
    if (ancestors.has(message.id) || ancestors.size >= 64) return undefined;
    const path = new Set(ancestors);
    path.add(message.id);
    const sources = await this.runtime<{
      threadId?: string;
      messageIds?: string[];
      managementTurnId?: string;
      summaryProofId?: string;
    } | null>(`messageScopeSources:${message.id}`, null);
    if (!sources) return [];
    if (
      sources.threadId !== message.threadId ||
      !Array.isArray(sources.messageIds) ||
      sources.messageIds.length > 6
    )
      return undefined;
    const result = new Map<string, string>();
    const add = (proofs: { accountId: string; version: string }[]) => {
      for (const proof of proofs) {
        if (
          !proof?.accountId ||
          !proof.version ||
          (result.has(proof.accountId) && result.get(proof.accountId) !== proof.version)
        )
          return false;
        result.set(proof.accountId, proof.version);
      }
      return result.size <= 100;
    };
    if (sources.summaryProofId) {
      const summary = await this.threadSummaries.sourceProofs(
        message.threadId,
        sources.summaryProofId,
      );
      if (!summary || !add(summary.accountProofs)) return undefined;
    }
    if (sources.managementTurnId) {
      const turn = await this.runtime<RoomManagementTurnState | null>(
        sources.managementTurnId,
        null,
      );
      if (!turn || turn.threadId !== message.threadId || turn.phase !== "settled" || !turn.result)
        return undefined;
      for (const record of turn.calls) {
        if (
          ((record.call.family === "social" && !record.call.projectId) ||
            (record.call.family === "conversation" &&
              record.call.action.startsWith("observations.") &&
              !!record.call.accountId)) &&
          record.status === "completed" &&
          !record.contributorAccounts
        )
          return undefined;
        if (record.contributorAccounts && !add(record.contributorAccounts)) return undefined;
      }
      if (turn.result.contributorAccounts && !add(turn.result.contributorAccounts))
        return undefined;
    }
    for (const id of sources.messageIds) {
      const source = await this.repository.get<AssistantMessage>("messages", id);
      if (!source || source.threadId !== message.threadId) return undefined;
      const inherited = await this.messageAccountProofs(source, path);
      if (!inherited || !add(inherited)) return undefined;
    }
    return [...result].map(([accountId, version]) => ({ accountId, version }));
  }
  private async messageProjectProofs(
    message: AssistantMessage,
    ancestors = new Set<string>(),
  ): Promise<{ projectId: string; cwd: string }[] | undefined> {
    if (message.role !== "assistant") {
      const captured = await this.runtime<{
        threadId: string;
        proofs: { projectId: string; cwd: string }[];
      } | null>(`messageProjectOrigins:${message.id}`, null);
      if (captured)
        return captured.threadId === message.threadId && Array.isArray(captured.proofs)
          ? captured.proofs
          : undefined;
      return legacyMessageProofs(this.store, (await this.messageProjectScope(message)).projectIds);
    }
    if (message.via === "voice") {
      const voice = await this.runtime<{
        contextId: string;
        version: number;
        threadId: string;
      } | null>(`messageScopeVoice:${message.id}`, null);
      if (voice)
        return voice.threadId === message.threadId
          ? this.voiceContexts.historicalProjectProofs(
              voice.contextId,
              voice.version,
              message.threadId,
            )
          : undefined;
    }
    if (ancestors.has(message.id) || ancestors.size >= 64) return undefined;
    const path = new Set(ancestors);
    path.add(message.id);
    const sources = await this.runtime<{
      threadId?: string;
      messageIds?: string[];
      managementTurnId?: string;
      summaryProofId?: string;
    } | null>(`messageScopeSources:${message.id}`, null);
    if (!sources) return [];
    if (
      sources.threadId !== message.threadId ||
      !Array.isArray(sources.messageIds) ||
      sources.messageIds.length > 6
    )
      return undefined;
    const result = new Map<string, string>();
    const add = (proofs: { projectId: string; cwd: string }[]) => {
      for (const proof of proofs) {
        if (
          !proof?.projectId ||
          !proof.cwd ||
          (result.has(proof.projectId) && result.get(proof.projectId) !== proof.cwd)
        )
          return false;
        result.set(proof.projectId, proof.cwd);
      }
      return result.size <= 1000;
    };
    if (sources.summaryProofId) {
      const summary = await this.threadSummaries.sourceProofs(
        message.threadId,
        sources.summaryProofId,
      );
      if (!summary || !add(summary.projectProofs)) return undefined;
    }
    if (sources.managementTurnId) {
      const turn = await this.runtime<RoomManagementTurnState | null>(
        sources.managementTurnId,
        null,
      );
      if (!turn || turn.threadId !== message.threadId || turn.phase !== "settled" || !turn.result)
        return undefined;
      for (const record of turn.calls) {
        if (
          record.call.projectId &&
          record.status === "completed" &&
          !record.contributorProjects?.some((proof) => proof.projectId === record.call.projectId)
        )
          return undefined;
        if (record.contributorProjects && !add(record.contributorProjects)) return undefined;
      }
      if (turn.result.contributorProjects && !add(turn.result.contributorProjects))
        return undefined;
    }
    for (const id of sources.messageIds) {
      const source = await this.repository.get<AssistantMessage>("messages", id);
      if (!source || source.threadId !== message.threadId) return undefined;
      const inherited = await this.messageProjectProofs(source, path);
      if (!inherited || !add(inherited)) return undefined;
    }
    return [...result].map(([projectId, cwd]) => ({ projectId, cwd }));
  }
  private async withRoomDisclosure<T>(
    threadId: string,
    projects: string[],
    accounts: { accountId: string; version: string }[],
    admission: RoomManagementAdmission | undefined,
    effect: (valid: () => boolean) => Promise<T>,
    projectProofs: { projectId: string; cwd: string }[] = [],
    nativeProofs: NativeLibraryProof[] = [],
  ): Promise<T> {
    if (nativeProofs.length) {
      if (!admission || !this.ports.withRoomResponseDisclosure)
        throw new Error("Native library source authority is unavailable.");
      return this.ports.withRoomResponseDisclosure(
        [{ threadId, projects, accounts, projectProofs, nativeProofs }],
        admission,
        effect,
      );
    }
    if (!projects.length && !accounts.length) return effect(() => true);
    if (!admission) throw new Error("Room disclosure authority is unavailable.");
    const withAccounts = async (projectValid: () => boolean) => {
      if (!projectValid()) throw new Error("Room project visibility changed.");
      if (
        projectProofs.length &&
        (!this.ports.roomProjectProofsValid ||
          !(await this.ports.roomProjectProofsValid(projectProofs)) ||
          !projectValid())
      )
        throw new Error("Room project source changed.");
      if (!accounts.length) return effect(projectValid);
      if (!this.ports.withRoomAccountDisclosure)
        throw new Error("Room account disclosure authority is unavailable.");
      return this.ports.withRoomAccountDisclosure(threadId, accounts, admission, (accountValid) =>
        effect(() => projectValid() && accountValid()),
      );
    };
    if (!projects.length) return withAccounts(() => true);
    if (!this.ports.withRoomProjectDisclosure)
      throw new Error("Room project disclosure authority is unavailable.");
    return this.ports.withRoomProjectDisclosure(
      threadId,
      projects,
      admission,
      withAccounts,
      projectProofs,
    );
  }
  /** Hold source permits until the transport has completed its write callback. */
  async withResponseDisclosure<T>(
    response: AssistantResponse,
    admission: RoomManagementAdmission,
    effect: () => Promise<T>,
  ): Promise<T> {
    const groups = new Map<
      string,
      {
        projects: Set<string>;
        accounts: Map<string, string>;
        projectProofs: Map<string, string>;
        nativeProofs?: NativeLibraryProof[];
      }
    >();
    for (const thread of [response.thread, ...(response.snapshot?.threads ?? [])]) {
      if (!thread?.summary) continue;
      const sources = thread.summaryProof
        ? await this.threadSummaries.sourceProofs(thread.id, thread.summaryProof.id)
        : undefined;
      if (!sources) throw new Error("Room summary source proof is unavailable.");
      const group = groups.get(thread.id) ?? {
        projects: new Set<string>(),
        accounts: new Map<string, string>(),
        projectProofs: new Map<string, string>(),
        nativeProofs: [] as NativeLibraryProof[],
      };
      group.nativeProofs = mergeNativeLibraryProofs(
        group.nativeProofs ?? [],
        sources.nativeProofs ?? [],
      );
      for (const proof of sources.projectProofs) {
        if (
          group.projectProofs.has(proof.projectId) &&
          group.projectProofs.get(proof.projectId) !== proof.cwd
        )
          throw new Error("Room response contains incompatible project sources.");
        group.projects.add(proof.projectId);
        group.projectProofs.set(proof.projectId, proof.cwd);
      }
      for (const proof of sources.accountProofs) {
        if (
          group.accounts.has(proof.accountId) &&
          group.accounts.get(proof.accountId) !== proof.version
        )
          throw new Error("Room response contains incompatible account grants.");
        group.accounts.set(proof.accountId, proof.version);
      }
      groups.set(thread.id, group);
    }
    for (const message of [response.message, ...(response.messages ?? [])]) {
      if (!message) continue;
      const scoped = await this.messageProjectScope(message);
      const projects = new Set([
        ...(scoped.projectIds ?? []),
        ...(scoped.visibilityProjectIds ?? []),
      ]);
      const accounts =
        message.text === "This message is unavailable because its source access changed."
          ? []
          : await this.messageAccountProofs(message);
      if (!accounts) throw new Error("Room response source proof is unavailable.");
      const projectProofs =
        message.text === "This message is unavailable because its source access changed."
          ? []
          : await this.messageProjectProofs(message);
      if (!projectProofs) throw new Error("Room response project source proof is unavailable.");
      const nativeProofs =
        message.text === "This message is unavailable because its source access changed."
          ? []
          : await this.messageNativeProofs(message);
      if (!nativeProofs)
        throw new Error("Room response Native library source proof is unavailable.");
      if (!projects.size && !accounts.length && !nativeProofs.length) continue;
      const group = groups.get(message.threadId) ?? {
        projects: new Set<string>(),
        accounts: new Map<string, string>(),
        projectProofs: new Map<string, string>(),
        nativeProofs: [] as NativeLibraryProof[],
      };
      group.nativeProofs = mergeNativeLibraryProofs(group.nativeProofs ?? [], nativeProofs);
      for (const id of projects) group.projects.add(id);
      for (const proof of projectProofs) {
        if (
          group.projectProofs.has(proof.projectId) &&
          group.projectProofs.get(proof.projectId) !== proof.cwd
        )
          throw new Error("Room response contains incompatible project sources.");
        group.projectProofs.set(proof.projectId, proof.cwd);
      }
      for (const account of accounts) {
        if (
          group.accounts.has(account.accountId) &&
          group.accounts.get(account.accountId) !== account.version
        )
          throw new Error("Room response contains incompatible account grants.");
        group.accounts.set(account.accountId, account.version);
      }
      groups.set(message.threadId, group);
    }
    if (groups.size > 1 || [...groups.values()].some((group) => group.nativeProofs?.length)) {
      if (!this.ports.withRoomResponseDisclosure)
        throw new Error("Room response source authority is unavailable.");
      const scopes = [...groups].map(([threadId, scope]) => ({
        threadId,
        projects: [...scope.projects],
        accounts: [...scope.accounts].map(([accountId, version]) => ({ accountId, version })),
        projectProofs: [...scope.projectProofs].map(([projectId, cwd]) => ({ projectId, cwd })),
        nativeProofs: scope.nativeProofs ?? [],
      }));
      return this.ports.withRoomResponseDisclosure(scopes, admission, async (valid) => {
        if (!valid()) throw new Error("Room response source access changed.");
        const proofs = [...groups.values()].flatMap((group) =>
          [...group.projectProofs].map(([projectId, cwd]) => ({ projectId, cwd })),
        );
        if (
          proofs.length &&
          (!this.ports.roomProjectProofsValid ||
            !(await this.ports.roomProjectProofsValid(proofs)) ||
            !valid())
        )
          throw new Error("Room response project source changed.");
        return effect();
      });
    }
    const group = groups.entries().next().value;
    if (!group) return effect();
    const [threadId, scope] = group;
    return this.withRoomDisclosure(
      threadId,
      [...scope.projects],
      [...scope.accounts].map(([accountId, version]) => ({ accountId, version })),
      admission,
      async (valid) => {
        if (!valid()) throw new Error("Room response source access changed.");
        return effect();
      },
      [...scope.projectProofs].map(([projectId, cwd]) => ({ projectId, cwd })),
    );
  }
  private async accountSafeMessage(message: AssistantMessage): Promise<AssistantMessage> {
    const redact = (): AssistantMessage => {
      const { projectIds: _projectIds, visibilityProjectIds: _visibility, ...rest } = message;
      return {
        ...rest,
        text: "This message is unavailable because its source access changed.",
        unverifiedToolContext: true,
      };
    };
    const nativeProofs = await this.messageNativeProofs(message);
    if (
      !nativeProofs ||
      (nativeProofs.length &&
        (!this.ports.roomNativeProofsValid ||
          !(await this.ports.roomNativeProofsValid(nativeProofs))))
    )
      return redact();
    const proofs = await this.messageAccountProofs(message);
    const projectProofs = await this.messageProjectProofs(message);
    const scoped = message.role === "assistant" ? await this.messageProjectScope(message) : message;
    const projectIds = new Set([
      ...(scoped.projectIds ?? []),
      ...(scoped.visibilityProjectIds ?? []),
    ]);
    if (
      message.role === "assistant" &&
      projectIds.size &&
      (!projectProofs ||
        [...projectIds].some((id) => !projectProofs.some((proof) => proof.projectId === id)))
    )
      return redact();
    if (
      message.role === "assistant" &&
      (!projectProofs ||
        (projectProofs.length &&
          (!this.ports.roomProjectProofsValid ||
            !(await this.ports.roomProjectProofsValid(projectProofs)))))
    )
      return redact();
    if (
      !proofs ||
      (proofs.length &&
        (!this.ports.roomAccountProofsValid ||
          !(await this.ports.roomAccountProofsValid(message.threadId, proofs))))
    )
      return redact();
    return message;
  }
  private async messageProjectScopes(messages: AssistantMessage[]): Promise<AssistantMessage[]> {
    const context = { cache: new Map<string, Promise<AssistantMessage>>(), visited: 0 },
      result: AssistantMessage[] = [];
    // Sequential roots avoid sharing unresolved promises across cyclic roots.
    for (const message of messages)
      result.push(await this.messageProjectScope(message, new Set(), context));
    return result;
  }
  private async messageAnnotations(message: AssistantMessage): Promise<AssistantMessage> {
    const { toolActions: _actions, ...value } = message;
    const management = await this.runtime<{ managementTurnId?: string } | null>(
      message.role === "assistant"
        ? `messageScopeSources:${message.id}`
        : `messageRoomTurn:${message.id}`,
      null,
    );
    if (management?.managementTurnId) {
      const turn = await this.runtime<RoomManagementTurnState | null>(
        management.managementTurnId,
        null,
      );
      if (
        turn?.threadId === message.threadId &&
        (message.role === "assistant" || turn.ownerMessageId === message.id)
      )
        return {
          ...value,
          toolActions: turn.calls.slice(0, 20).map(({ call, status, createdAt }) => ({
            id: call.requestId,
            family: call.family,
            action: call.action,
            status: status === "completed" ? ("completed" as const) : ("unknown" as const),
            createdAt,
          })),
        };
    }
    if (!Array.isArray(value.projectIds)) return value;
    const proof = await this.voiceActionsForMessage(message.id);
    if (!proof?.actions.length) return value;
    const projectIds = [...new Set([...value.projectIds, ...proof.projectIds])].sort();
    if (projectIds.length > 1000) return value;
    return {
      ...value,
      projectIds,
      toolActions: proof.actions.map(({ id, family, action, status, createdAt }) => ({
        id,
        family,
        action,
        status,
        createdAt,
      })),
    };
  }
  private async ownerProposalSource(
    input: AssistantOwnerProposalBinding,
  ): Promise<AssistantOwnerProposalSource> {
    const thread = await this.repository.get<AssistantThread>("threads", input.threadId),
      ownerMessage = await this.repository.get<AssistantMessage>("messages", input.ownerMessageId);
    if (
      !thread ||
      !ownerMessage ||
      ownerMessage.threadId !== thread.id ||
      ownerMessage.role !== "user" ||
      ownerMessage.ownerQuestionId
    )
      throw new Error(
        "Persist the exact accepted owner turn in its canonical thread before presenting a decision.",
      );
    if (input.causalContextId) {
      const proof =
        input.causalContextVersion === undefined
          ? await this.voiceContexts.capture(input.causalContextId, thread.id, ownerMessage.id)
          : null;
      const scope =
        input.causalContextVersion === undefined
          ? proof?.projectIds
          : await this.voiceContexts.historicalScope(
              input.causalContextId,
              input.causalContextVersion,
              thread.id,
              ownerMessage.id,
            );
      if (!scope)
        throw new Error(
          "This voice generation has no verified current source for a persistent question.",
        );
      const contextId = proof?.contextId ?? input.causalContextId,
        version = proof?.version ?? input.causalContextVersion!,
        projectIds = [...new Set([...scope, ...input.contextProjectIds])].sort();
      for (const id of projectIds) await this.store.project(id);
      return {
        sourceToken: createHash("sha256")
          .update(
            JSON.stringify({
              threadId: thread.id,
              ownerMessageId: ownerMessage.id,
              contextId,
              version,
              projectIds,
            }),
          )
          .digest("hex"),
        projectIds,
        origin: ownerMessage.via === "voice" ? "voice-proposal" : "thread-proposal",
        messageIds: [],
        causalContextId: contextId,
        causalContextVersion: version,
      };
    }
    if (thread.summary && !input.messageIds)
      throw new Error(
        "This conversation summary has no verified source scope; keep this question in voice until its context can be verified.",
      );
    const rows = input.messageIds
      ? await this.store.db
          .prepare(
            "SELECT value FROM assistant_messages WHERE deleted_at IS NULL AND json_extract(value,'$.threadId')=? AND id IN(SELECT value FROM json_each(?)) ORDER BY rowid LIMIT 1001",
          )
          .all(thread.id, JSON.stringify(input.messageIds))
      : await this.store.db
          .prepare(
            "SELECT value FROM assistant_messages WHERE deleted_at IS NULL AND json_extract(value,'$.threadId')=? ORDER BY rowid LIMIT 1001",
          )
          .all(thread.id);
    if (rows.length > 1000)
      throw new Error(
        "This conversation has too much unresolved context to persist a scoped question.",
      );
    const messages = rows.map((row) => JSON.parse(row.value) as AssistantMessage);
    if (input.messageIds) {
      if (
        messages.length !== input.messageIds.length ||
        !input.messageIds.includes(ownerMessage.id)
      )
        throw new Error("The original question context was cleared or removed.");
    } else if (
      messages.filter((message) => message.role === "user" && !message.ownerQuestionId).at(-1)
        ?.id !== ownerMessage.id
    )
      throw new Error("A newer owner turn replaced the captured question source.");
    const scoped = await this.messageProjectScopes(messages);
    if (scoped.some((message) => !message.projectIds))
      throw new Error(
        "Voice context contains unverified source scope; this question cannot yet be persisted safely.",
      );
    const projectIds = [
      ...new Set([...scoped.flatMap((message) => message.projectIds!), ...input.contextProjectIds]),
    ].sort();
    for (const id of projectIds) await this.store.project(id);
    const sourceToken = createHash("sha256")
      .update(
        JSON.stringify({
          threadId: thread.id,
          threadProjectId: thread.projectId,
          ownerMessageId: ownerMessage.id,
          projectIds,
          messages: scoped.map((message) => ({
            id: message.id,
            version: message.version,
            projectIds: message.projectIds,
            sessionId: message.sessionId,
            jobIds: message.jobIds,
            text: message.text,
          })),
        }),
      )
      .digest("hex");
    return {
      sourceToken,
      projectIds,
      origin: ownerMessage.via === "voice" ? "voice-proposal" : "thread-proposal",
      messageIds: messages.map((message) => message.id),
    };
  }
  private async ownerQuestionEvent(
    question: AssistantOwnerQuestion,
    kind: "requested" | "answer" | "snooze" | "cancel",
  ): Promise<void> {
    if (question.threadId && (kind === "answer" || kind === "snooze") && question.lastOwnerAction) {
      const receipt = question.lastOwnerAction,
        key = `owner-question:${question.id}:${receipt.requestId}`;
      if (
        !(await this.repository.byKey<AssistantMessage>("messages", key)) &&
        (await this.repository.get<AssistantThread>("threads", question.threadId))
      ) {
        const selections =
          kind === "answer"
            ? question.prompt.questions.flatMap((item) => {
                const selected = question.answer?.answers[item.id] ?? [];
                return [
                  ...selected.flatMap(
                    (id) => item.options.find((option) => option.id === id)?.label ?? [],
                  ),
                  ...(question.answer?.custom?.[item.id] ? [question.answer.custom[item.id]] : []),
                ];
              })
            : [];
        const text =
          kind === "answer"
            ? `${question.prompt.title ?? question.prompt.questions[0].prompt}\n${selections.join(", ")}`
            : (question.prompt.title ?? question.prompt.questions[0].prompt);
        const message = await this.repository.put<AssistantMessage>(
          "messages",
          {
            ...this.stamp(),
            threadId: question.threadId,
            role: "user",
            via: "text",
            text: text.slice(0, 16000),
            jobIds: [],
            ownerQuestionId: question.id,
            ownerQuestionRequestId: receipt.requestId,
            ownerQuestionAction: kind,
          },
          0,
          key,
        );
        await this.setRuntime(`messageScopeQuestion:${message.id}`, {
          questionId: question.id,
          requestId: receipt.requestId,
          version: receipt.version,
        });
        await this.threadSummaries.record(message.id);
        const contextId = await this.ownerQuestions.capturedVoiceContext(question.id);
        if (contextId)
          await this.voiceContexts.recordQuestionChoice(
            contextId,
            message.id,
            question.id,
            receipt.requestId,
          );
      }
    }
    const extra = question.jobId ? { jobId: question.jobId } : {},
      event = await this.activity(
        `ownerQuestion.${kind}`,
        kind === "requested"
          ? "A persistent decision is waiting for the owner."
          : `The owner recorded a decision ${kind}.`,
        { ...extra, ownerQuestionId: question.id },
      );
    if (kind === "answer") await this.enqueueChiefEvent(event);
    if (kind === "requested") {
      const prior = await this.store.db
        .prepare(
          "SELECT id FROM assistant_owner_questions WHERE json_extract(value,'$.supersededBy')=?",
        )
        .all(question.id);
      for (const old of prior) await this.clearOwnerQuestionNotifications(old.id, question.id);
      await this.queueNotification({
        id: `decision:${question.id}`,
        kind: "owner.question",
        title: "Decision needed",
        body: "Your assistant has a decision for you in Room.",
        createdAt: this.now(),
        ...extra,
        projectIds: question.projectIds,
      });
    } else
      await this.clearOwnerQuestionNotifications(
        question.id,
        `decision:${question.id}:v${question.version}`,
      );
  }
  private async clearOwnerQuestionNotifications(id: string, supersededBy: string): Promise<void> {
    const rows = await this.store.db
      .prepare("SELECT id,value FROM assistant_runtime WHERE id LIKE ? AND deleted_at IS NULL")
      .all(`notification:decision:${id}%`);
    for (const row of rows) {
      const notification = (JSON.parse(row.value) as Runtime).value as PendingNotification;
      await this.setRuntime(row.id, { ...notification, supersededBy });
    }
  }
  private async queueOwnerQuestionReminders(): Promise<void> {
    for (const question of await this.ownerQuestions.dueSnoozed())
      await this.queueNotification({
        id: `decision:${question.id}:v${question.version}:reminder`,
        kind: "owner.question",
        title: "Decision reminder",
        body: "A deferred decision is waiting for you in Room.",
        createdAt: this.now(),
        ...(question.jobId ? { jobId: question.jobId } : {}),
        projectIds: question.projectIds,
      });
  }
  async reserveSessionTokens(input: {
    requestId: string;
    estimatedTokens: number;
    jobId?: string;
    supervisionId?: string;
    phase?: "compact" | "handoff" | "send" | "answer";
    answerSource?: WorkerReservation["answerSource"];
  }): Promise<void> {
    if (typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 1000)
      throw new Error("Invalid reservation identity.");
    if (!Number.isSafeInteger(input.estimatedTokens) || input.estimatedTokens < 0)
      throw new Error("Invalid token reservation.");
    await this.store.transaction(async () => {
      if (!(await this.supervisionAllowed()))
        throw new Error("The supervisor is paused or restricted by its budget.");
      if (input.supervisionId && !(await this.manualSupervisionAllowed()))
        throw new Error("Manual supervision is disabled.");
      if (input.phase === "answer") {
        if (
          !input.jobId ||
          input.supervisionId ||
          !input.answerSource ||
          !(await this.routineQuestionsAllowed())
        )
          throw new Error(
            "Routine-answer reservation requires the current owner policy and exact worker source.",
          );
        const source = input.answerSource,
          record = await this.store.session(source.sessionId);
        if (
          record.runId !== source.runId ||
          assistantQuestionToken(record) !== source.questionToken ||
          !record.session.blocks.some(
            (block) =>
              block.id === source.turnBlockId &&
              block.role === "user" &&
              !block.continuationOf &&
              !block.draft,
          )
        )
          throw new Error("The answer reservation's original turn or question changed.");
      }
      if (await this.runtime(`reservation:${input.requestId}`, false)) return;
      const profile = await this.profile();
      const usage = await this.usage(profile);
      if (usage.total + input.estimatedTokens >= profile.dailyTokenBudget * 0.8)
        throw new Error("This session operation reaches the report-only token threshold.");
      await this.adjustWorkerUsage(usage.day, 0, input.estimatedTokens);
      await this.setRuntime(`reservation:${input.requestId}`, {
        tokens: input.estimatedTokens,
        remaining: input.estimatedTokens,
        day: usage.day,
        operationId:
          input.phase === "compact"
            ? input.requestId
            : input.requestId.replace(/:(?:handoff|send|answer)$/, ""),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.supervisionId ? { supervisionId: input.supervisionId } : {}),
        ...(input.phase ? { phase: input.phase } : {}),
        ...(input.answerSource ? { answerSource: input.answerSource } : {}),
      } satisfies WorkerReservation);
    }, "critical");
  }
  async recordSessionAnswer(input: {
    jobId: string;
    operationId: string;
    sessionId: string;
    runId: string;
    questionToken: string;
    turnBlockId: string;
    answeredBlockId: string;
  }): Promise<void> {
    await this.ready;
    await this.store.transaction(async () => {
      const key = `reservation:${input.operationId}:answer`,
        reservation = await this.runtime<WorkerReservation | null>(key, null),
        record = await this.store.session(input.sessionId),
        block = record.session.blocks.find((block) => block.id === input.answeredBlockId),
        source = reservation?.answerSource;
      if (
        !reservation ||
        reservation.phase !== "answer" ||
        reservation.jobId !== input.jobId ||
        !source ||
        source.sessionId !== input.sessionId ||
        source.runId !== input.runId ||
        source.questionToken !== input.questionToken ||
        source.turnBlockId !== input.turnBlockId ||
        record.runId !== input.runId ||
        block?.author?.kind !== "assistant" ||
        block.author.jobId !== input.jobId ||
        block.author.reason !== "answer" ||
        block.author.operationId !== input.operationId ||
        block.continuationOf !== input.turnBlockId ||
        !block.questionAnswers?.length
      )
        throw new Error("The actual answer receipt does not match its reserved worker turn.");
      await this.setRuntime(key, { ...reservation, answeredBlockId: input.answeredBlockId });
    }, "critical");
  }
  /** Internal lookup for a verified voice grant, never a tool authorization. */
  async threadBinding(id: string): Promise<{ id: string; projectId?: string } | null> {
    await this.ready;
    if (typeof id !== "string" || !id || id.length > 200)
      throw new Error("Invalid conversation identity.");
    const thread = await this.repository.get<AssistantThread>("threads", id);
    return thread
      ? { id: thread.id, ...(thread.projectId ? { projectId: thread.projectId } : {}) }
      : null;
  }
  /** Trusted Host bookkeeping only; never exposed through assistant.request or model arguments. */
  recordDesktopOperation(raw: DesktopOperationAudit): Promise<void> {
    const event = DesktopOperationAuditSchema.parse(raw);
    if (
      event.id !==
      desktopOperationAuditId(event.principal, event.operation.requestId, event.operation.state)
    )
      return Promise.reject(new Error("Desktop audit identity changed."));
    return this.store.db.outsideScope(() =>
      this.serialize(async () => {
        const key = `desktopAudit:${event.id}`;
        const fingerprint = createHash("sha256").update(JSON.stringify(event)).digest("hex");
        let recorded = await this.runtime<{
          fingerprint: string;
          activityId: string;
          noteDelivered: boolean;
        } | null>(key, null);
        if (recorded && recorded.fingerprint !== fingerprint)
          throw new Error("Desktop audit metadata changed for an existing operation.");
        if (recorded?.noteDelivered) return;
        let activity = recorded
          ? await this.repository.get<AssistantActivity>("activity", recorded.activityId)
          : undefined;
        if (!recorded) {
          const plain = (value: string) =>
            replaceControlCharacters(value, " ", false)
              .replace(/[<>`[\]\\*_#]/g, " ")
              .slice(0, 200);
          const outcome =
            event.operation.state === "unknown"
              ? "delivery unknown"
              : event.operation.delivery.replaceAll("_", " ");
          const summary = await this.safeOutput(
            `Computer input · ${plain(event.app)} · ${event.action} · ${outcome} · ${event.principal.kind} · request ${plain(event.operation.requestId)}`,
          );
          activity = await this.store.transaction(async () => {
            const value = await this.repository.put("activity", {
              id: `desktop:${event.id}`,
              version: 0,
              createdAt: event.at,
              updatedAt: this.now(),
              kind: `desktop.${event.operation.state}`,
              summary,
            });
            recorded = { fingerprint, activityId: value.id, noteDelivered: false };
            await this.setRuntime(key, recorded);
            return value;
          }, "critical");
        }
        // A cleared History row stays cleared; a retry must not restore owner-deleted content.
        if (activity)
          await this.appendDailyNote(await this.profile(), [activity], {
            strict: true,
            day: utcDay(event.at),
          });
        await this.store.transaction(
          () => this.setRuntime(key, { ...recorded!, noteDelivered: true }),
          "critical",
        );
        this.ports.onChange?.();
      }),
    );
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Assistant is closing."));
    return this.queue.run(async () => {
      await this.ready;
      if (this.closing) throw new Error("Assistant is closing.");
      return run();
    });
  }
  private readonly report = (error: unknown) => this.ports.onError?.(error);
  private readonly later = (run: () => Promise<unknown>) =>
    this.store.db.outsideScope(() => void this.serialize(run).catch(this.report));
  private readonly kick = () => void this.tick().catch(this.report);
  start() {
    if (this.closing || this.timer) return;
    this.store.db.outsideScope(() => {
      this.threadSummaries.start();
      this.timer = setInterval(this.kick, 60000);
      this.timer.unref?.();
      this.kick();
    });
  }
  close(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.queue.abortTurns();
    this.threadSummaries.abort();
    this.disposal = this.queue.idle().then(async () => {
      await this.ready;
      await this.threadSummaries.close();
      await this.ports.keepAwake?.(false);
    });
    return this.disposal;
  }
  private owner(principal: AssistantPrincipal) {
    if (principal !== "owner")
      throw new Error("This action requires the owner's direct authority.");
  }
  private async profile(): Promise<AssistantProfile> {
    const row = await this.repository.get<AssistantProfile>("profile", "profile");
    if (!row) return { ...assistantProfileDefaults };
    return Object.fromEntries(
      Object.keys(assistantProfileDefaults).map((key) => [
        key,
        row[key as keyof AssistantProfile] ??
          assistantProfileDefaults[key as keyof AssistantProfile],
      ]),
    ) as AssistantProfile;
  }
  private async runtime<T>(id: string, fallback: T): Promise<T> {
    return ((await this.repository.get<Runtime>("runtime", id))?.value as T) ?? fallback;
  }
  private async setRuntime(id: string, value: unknown) {
    const old = await this.repository.get<Runtime>("runtime", id);
    return this.repository.put("runtime", {
      id,
      version: old?.version ?? 0,
      createdAt: old?.createdAt ?? this.now(),
      updatedAt: this.now(),
      value,
    });
  }
  private async narrationSource(eventId: string): Promise<NarrationEvent | undefined> {
    if (eventId.startsWith("question:")) {
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_owner_questions WHERE id=?")
        .get(eventId.slice(9));
      if (!row) return undefined;
      const question = JSON.parse(String(row.value)) as {
        id: string;
        status: string;
        origin: string;
        jobId: string | null;
        createdAt: number;
        projectIds: string[];
        sourceToken: string;
        version: number;
      };
      // Chief questions derive from the canonical job/goal/task/session graph. Proposal
      // questions can carry account context and need a separately verified account lease.
      if (
        question.origin !== "chief" ||
        !question.jobId ||
        question.status !== "open" ||
        !Array.isArray(question.projectIds) ||
        question.createdAt > this.now() ||
        this.now() - question.createdAt > 300_000
      )
        return undefined;
      return {
        eventId,
        kind: "question",
        text: "Your assistant needs a decision.",
        createdAt: question.createdAt,
        projectIds: question.projectIds,
        accountProofs: [],
        sourceVersion: `${question.version}:${question.sourceToken}`,
      };
    }
    if (eventId.startsWith("notification:observation:")) {
      const notificationId = eventId.slice("notification:".length);
      const notice = await this.runtime<PendingNotification | null>(
        `notification:${notificationId}`,
        null,
      );
      if (
        !notice ||
        notice.supersededBy ||
        !notice.taskId ||
        !notice.projectId ||
        notice.taskCreatedAt === undefined ||
        !["task.done", "task.needsInput"].includes(notice.kind) ||
        notice.createdAt > this.now() ||
        this.now() - notice.createdAt > 300_000
      )
        return undefined;
      const observedId = notificationId.slice("observation:".length);
      const observed = await this.store.db
        .prepare(
          "SELECT source_id,source_revision,project_ids FROM assistant_observation_events WHERE event_id=? AND source='task'",
        )
        .get(observedId);
      const revision = await this.store.db
        .prepare(
          "SELECT version FROM assistant_observation_source_revisions WHERE source='task' AND source_id=?",
        )
        .get(notice.taskId);
      const taskRow = await this.store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(notice.taskId);
      const task = taskRow
        ? (JSON.parse(String(taskRow.value)) as {
            id: string;
            projectId: string;
            createdAt: number;
            status: string;
            needsInput?: boolean;
          })
        : undefined;
      const manual = await this.manualPolicy(),
        policy = assistantPolicy(await this.profile());
      if (
        !observed ||
        observed.source_id !== notice.taskId ||
        observed.source_revision !== `db:${Number(revision?.version)}` ||
        JSON.stringify(JSON.parse(String(observed.project_ids))) !==
          JSON.stringify([notice.projectId]) ||
        !manual.enabled ||
        !manual.projectIds.includes(notice.projectId) ||
        (notice.kind === "task.done"
          ? !policy.observationTaskDone
          : !policy.observationTaskNeedsInput) ||
        !task ||
        task.id !== notice.taskId ||
        task.projectId !== notice.projectId ||
        task.createdAt !== notice.taskCreatedAt ||
        (notice.kind === "task.done"
          ? task.status !== "done"
          : task.status === "done" || !task.needsInput)
      )
        return undefined;
      return {
        eventId,
        kind: notice.kind === "task.done" ? "completed" : "question",
        text:
          notice.kind === "task.done"
            ? "An observed task completed."
            : "An observed task needs your input.",
        createdAt: notice.createdAt,
        projectIds: [notice.projectId],
        sourceVersion: String(observed.source_revision),
      };
    }
    const activity = await this.repository.get<AssistantActivity>("activity", eventId);
    if (!activity?.jobId) return undefined;
    if (activity.createdAt > this.now() || this.now() - activity.createdAt > 300_000)
      return undefined;
    const kind =
      activity.kind === "job.done"
        ? "completed"
        : activity.kind === "job.waiting"
          ? "question"
          : activity.kind === "job.running"
            ? "progress"
            : undefined;
    if (!kind) return undefined;
    const job = await this.repository.get<AssistantJob>("jobs", activity.jobId);
    if (!job?.projectId) return undefined;
    if (
      (kind === "completed" && job.status !== "done") ||
      (kind === "question" && job.status !== "waiting") ||
      (kind === "progress" && job.status !== "running")
    )
      return undefined;
    const text =
      kind === "completed"
        ? "A job completed."
        : kind === "question"
          ? "A job needs your input."
          : "A job is making progress.";
    return {
      eventId,
      kind,
      text,
      createdAt: activity.createdAt,
      projectIds: assistantJobProjectIds(job),
    };
  }
  private async narrationSourceAuthorized(event: NarrationEvent): Promise<boolean> {
    if (event.eventId.startsWith("question:")) {
      const question = (await this.ownerQuestions.get(event.eventId.slice(9))).ownerQuestion;
      return (
        question?.status === "open" &&
        question.sourceCurrent === true &&
        `${question.version}:${question.sourceToken}` === event.sourceVersion &&
        JSON.stringify(question.projectIds) === JSON.stringify(event.projectIds)
      );
    }
    if (event.eventId.startsWith("notification:observation:")) {
      const notice = await this.runtime<PendingNotification | null>(
        `notification:${event.eventId.slice("notification:".length)}`,
        null,
      );
      return (
        !!notice &&
        (!this.ports.taskNotificationAllowed ||
          (await this.ports.taskNotificationAllowed({
            ...notice,
            eligible: false,
            deferredReason: "unknown",
          })))
      );
    }
    return true;
  }
  private narrationReceipts(admission: RoomManagementAdmission) {
    return new AssistantNarrationReceipts({
      transaction: (effect) => this.store.transaction(effect, "critical"),
      read: (key) => this.runtime<NarrationReceipt | null>(key, null),
      write: async (key, receipt) => {
        await this.setRuntime(key, receipt);
      },
      source: (id) => this.narrationSource(id),
      withAuthorization: async (identity, event, effect) => {
        const profile = await this.profile();
        const hour = new Date(this.now()).getHours();
        const quiet =
          profile.quietStart !== profile.quietEnd &&
          (profile.quietStart < profile.quietEnd
            ? hour >= profile.quietStart && hour < profile.quietEnd
            : hour >= profile.quietStart || hour < profile.quietEnd);
        if (
          !profile.voiceNarration ||
          !profile.enabled ||
          !profile.setupComplete ||
          quiet ||
          (await this.effectivePresence()) !== "present" ||
          !this.ports.withVoiceNarrationAuthorization ||
          !(await admission.authorized()) ||
          admission.signal?.aborted ||
          !(await this.narrationSourceAuthorized(event))
        )
          throw new Error("Narration authority unavailable.");
        return this.ports.withVoiceNarrationAuthorization(
          {
            threadId: identity.threadId,
            generation: identity.generation,
            eventId: event.eventId,
            projectIds: event.projectIds,
            accountProofs: event.accountProofs,
          },
          admission,
          async (valid) => {
            if (!valid() || !(await this.narrationSourceAuthorized(event)) || !valid())
              throw new Error("Narration source changed.");
            return effect(valid);
          },
        );
      },
    });
  }
  private stamp() {
    const now = this.now();
    return { id: randomUUID(), version: 0, createdAt: now, updatedAt: now };
  }
  private async activity(
    kind: string,
    summary: string,
    extra: Partial<
      Pick<
        AssistantActivity,
        "jobId" | "supervisionId" | "sessionId" | "tokens" | "ownerQuestionId"
      >
    > = {},
  ) {
    const safe = await this.safeOutput(summary.slice(0, 4000));
    return this.store.transaction(async () => {
      const event = await this.repository.put("activity", {
        ...this.stamp(),
        kind,
        summary: safe,
        ...extra,
      });
      const quick =
        extra.jobId &&
        (await this.repository.get<AssistantJob>("jobs", extra.jobId, true))?.kind === "quick";
      if (
        !quick &&
        (kind.startsWith("job.") || kind.startsWith("manual.")) &&
        !["job.usage", "job.received", "manual.usage", "manual.policy"].includes(kind)
      )
        await this.enqueueChiefEvent(event);
      return event;
    }, "critical");
  }
  async instructions(scope: "voice" | "sessions" | "all"): Promise<string> {
    await this.ready;
    const entries = await this.repository.memory<AssistantMemory>();
    const relevant = entries.filter(
      (entry) =>
        entry.active && (scope === "all" || entry.scope === "all" || entry.scope === scope),
    );
    const rules = relevant.filter((entry) => entry.kind === "rule");
    const facts = relevant.filter((entry) => entry.kind !== "rule").slice(0, 10);
    return assistantOwnerInstructions(
      await this.profile(),
      rules.map((r) => r.text),
      facts.map((r) => r.text),
    );
  }
  private async safeOutput(text: string) {
    const entries = await this.repository.memory<AssistantMemory>();
    const blocked = entries
      .filter((entry) => entry.active && entry.kind === "rule")
      .flatMap((entry) => entry.forbiddenTerms);
    let safe = text;
    for (const term of blocked) {
      // Unicode-aware case folding, with literal matching rather than a rule-
      // supplied regular expression. No topic text is echoed in the fallback.
      if (safe.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
        const profile = await this.profile();
        return assistantUpdateFallback(
          profile.language === "auto"
            ? (await this.runtime<{ language: string } | null>("lastSpokenLanguage", null))
                ?.language
            : profile.language,
        );
      }
    }
    return safe;
  }
  /** Direct Room notebook port. Never re-enters the serialized assistant request queue. */
  async roomNotebookList() {
    if (!this.ports.listNotes)
      throw new Error("Global assistant notes are unavailable on this Host.");
    return this.ports.listNotes();
  }
  async roomNotebookGet(id: string) {
    return this.assertNote(id);
  }
  async roomNotebookSave(
    input: { id?: string; title: string; body: string; expectedUpdatedAt: number },
    authorized: () => Promise<boolean>,
  ) {
    if (!this.ports.saveNote)
      throw new Error("Global assistant notes are unavailable on this Host.");
    if (input.id && input.expectedUpdatedAt !== 0) await this.assertNote(input.id);
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
    return this.ports.saveNote(input, authorized);
  }
  async roomNotebookDelete(
    id: string,
    expectedUpdatedAt: number,
    authorized: () => Promise<boolean>,
  ) {
    if (!this.ports.deleteNote)
      throw new Error("Global assistant notes are unavailable on this Host.");
    const note = await this.assertNote(id);
    if (note.updatedAt !== expectedUpdatedAt)
      throw new Error("Note changed; reload before deleting.");
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
    const backup = await this.store.transaction(async () => {
      const item = await this.repository.put("notetrash", {
        ...this.stamp(),
        note,
        title: note.title,
      });
      await this.repository.trash("notetrash", item.id, item.version, this.now());
      await this.setRuntime(`notebookSuppressed:${note.title}`, true);
      return item;
    }, "critical");
    try {
      if (!(await authorized())) throw new Error("Conversation authority revoked.");
      await this.ports.deleteNote(id, expectedUpdatedAt, authorized);
    } catch (error) {
      this.ports.onError?.(error);
      throw new Error(
        `Note deletion outcome is unknown; its recovery copy ${backup.id} is in Recently deleted.`,
      );
    }
    return { ok: true, trashId: `notetrash:${backup.id}` };
  }
  async request(
    raw: unknown,
    principal: AssistantPrincipal,
    admission?: RoomManagementAdmission,
  ): Promise<AssistantResponse> {
    if (!["owner", "assistant", "chief"].includes(principal))
      throw new Error("A captured assistant principal is required.");
    const input = AssistantRequestValidationSchema.parse(raw);
    if (
      principal === "owner" &&
      input.op === "profile.update" &&
      (input.patch.enabled === false || input.patch.setupComplete === false)
    )
      this.quickPolicyEpoch++;
    // Emergency stop must interrupt a slow text-only provider before joining
    // the service queue. The durable paused flag is then saved by that request.
    if (principal === "owner" && input.op === "pauseAll") {
      this.emergencyStop = true;
      this.queue.abortTurns();
      this.threadSummaries.abort();
      this.ports.onPause?.();
    }
    if (
      principal === "owner" &&
      input.op === "profile.update" &&
      (input.patch.enabled === false || input.patch.setupComplete === false)
    )
      this.threadSummaries.abort();
    if (
      principal === "owner" &&
      input.op === "jobs.control" &&
      (input.action === "stop" || input.action === "delete")
    )
      this.queue.abortTurns();
    if (principal === "owner" && input.op === "jobs.control" && input.action !== "resume") {
      this.pendingJobStops.add(input.id);
      this.queue.abortTurns();
      this.ports.onJobPause?.(input.id);
    }
    const revokeSupervision =
      principal === "owner" &&
      (input.op === "manual.policy" ||
        input.op === "manual.revoke" ||
        input.op === "manual.enroll" ||
        (input.op === "profile.update" &&
          (input.patch.enabled === false ||
            input.patch.setupComplete === false ||
            input.patch.allowRoutineQuestions === false ||
            input.patch.activeStart !== undefined ||
            input.patch.activeEnd !== undefined ||
            input.patch.nudgeLimit !== undefined ||
            (input.patch.autonomy !== undefined && input.patch.autonomy !== "chief"))));
    if (revokeSupervision) {
      this.queue.abortTurns();
      this.ports.onPause?.();
    }
    const work = async (): Promise<AssistantResponse> => {
      try {
        const causalId =
          input.op === "voice.context.open"
            ? input.previousContextId
            : input.op === "voice.context.get"
              ? input.id
              : input.op === "questions.present" || input.op === "threads.append"
                ? input.causalContextId
                : undefined;
        let nativeScope:
          | {
              threadId: string;
              nativeProofs: NativeLibraryProof[];
              projectProofs: { projectId: string; cwd: string }[];
            }
          | undefined;
        let causalVersion: number | undefined;
        const nativeSeedFingerprints = new Map<string, string>();
        if (input.op === "voice.context.open") {
          let nativeProofs: NativeLibraryProof[] = [];
          const projectProofs: { projectId: string; cwd: string }[] = [];
          for (const id of input.seedMessageIds) {
            const message = await this.repository.get<AssistantMessage>("messages", id);
            if (!message || message.threadId !== input.threadId) continue;
            nativeSeedFingerprints.set(
              id,
              createHash("sha256").update(JSON.stringify(message)).digest("hex"),
            );
            const native = await this.messageNativeProofs(message);
            if (!native) throw new Error("Voice Native seed provenance is unavailable.");
            nativeProofs = mergeNativeLibraryProofs(nativeProofs, native);
            const projects = await this.messageProjectProofs(message);
            if (!projects && native.length)
              throw new Error("Voice Native seed project scope is unavailable.");
            projectProofs.push(...(projects ?? []));
          }
          if (input.summaryProofId) {
            const summary = await this.threadSummaries.sourceProofs(
              input.threadId,
              input.summaryProofId,
            );
            if (summary) {
              nativeProofs = mergeNativeLibraryProofs(nativeProofs, summary.nativeProofs ?? []);
              projectProofs.push(...summary.projectProofs);
            }
          }
          if (nativeProofs.length)
            nativeScope = { threadId: input.threadId, nativeProofs, projectProofs };
        }
        if (causalId) {
          const current = await this.voiceContexts.get(causalId);
          causalVersion = current.version;
          const nativeProofs = await this.voiceContexts.historicalNativeProofs(
            current.id,
            current.version,
            current.threadId,
            true,
          );
          if (!nativeProofs && current.status !== "unknown")
            throw new Error("Voice Native source provenance is unavailable.");
          if (nativeProofs?.length) {
            const projectProofs = await this.voiceContexts.historicalProjectProofs(
              current.id,
              current.version,
              current.threadId,
            );
            if (!projectProofs || !admission || !this.ports.withRoomResponseDisclosure)
              throw new Error("Voice Native source authority is unavailable.");
            nativeScope = nativeScope
              ? {
                  threadId: current.threadId,
                  nativeProofs: mergeNativeLibraryProofs(nativeScope.nativeProofs, nativeProofs),
                  projectProofs: [...nativeScope.projectProofs, ...projectProofs],
                }
              : { threadId: current.threadId, nativeProofs, projectProofs };
          }
        }
        const dispatchFenced = async (valid: () => boolean) => {
          if (!causalId && input.op !== "voice.context.open")
            return this.dispatch(input, principal, admission);
          return this.store.db.scope(async () => {
            if (!valid()) throw new Error("Voice Native source authority changed.");
            if (causalId && (await this.voiceContexts.currentVersion(causalId)) !== causalVersion)
              throw new Error("Voice Native context changed.");
            for (const [id, fingerprint] of nativeSeedFingerprints) {
              const seed = await this.repository.get<AssistantMessage>("messages", id);
              if (
                !seed ||
                createHash("sha256").update(JSON.stringify(seed)).digest("hex") !== fingerprint
              )
                throw new Error("Voice Native seed changed.");
            }
            const result = await this.dispatch(input, principal, admission);
            if (!valid()) throw new Error("Voice Native source authority changed.");
            return result;
          });
        };
        if (nativeScope && (!admission || !this.ports.withRoomResponseDisclosure))
          throw new Error("Voice Native source authority is unavailable.");
        const response = nativeScope
          ? await this.ports.withRoomResponseDisclosure!(
              [
                {
                  threadId: nativeScope.threadId,
                  projects: nativeScope.projectProofs.map((proof) => proof.projectId),
                  accounts: [],
                  projectProofs: nativeScope.projectProofs,
                  nativeProofs: nativeScope.nativeProofs,
                },
              ],
              admission!,
              async (valid) => {
                return dispatchFenced(valid);
              },
            )
          : await dispatchFenced(() => true);
        if (response.profile) await this.syncHoursHolds(response.profile);
        if (response.job) response.job = this.jobOutput(response.job);
        if (response.snapshot)
          response.snapshot.jobs = response.snapshot.jobs.map((job) => this.jobOutput(job));
        if (response.thread)
          response.thread = await this.threadSummaries.projection(response.thread);
        if (response.snapshot)
          response.snapshot.threads = await Promise.all(
            response.snapshot.threads.map((thread) => this.threadSummaries.projection(thread)),
          );
        if (response.message) await this.threadSummaries.record(response.message.id);
        if (response.message)
          response.message = await this.messageAnnotations(
            await this.accountSafeMessage(await this.messageProjectScope(response.message)),
          );
        if (response.messages && input.op === "conversations.search") {
          const visible: AssistantMessage[] = [];
          for (const message of response.messages) {
            const safe = await this.accountSafeMessage(message);
            if (safe.text === message.text) visible.push(message);
          }
          response.messages = visible;
        }
        if (response.messages) {
          response.messages = await this.messageProjectScopes(response.messages);
          for (let index = 0; index < response.messages.length; index++)
            response.messages[index] = await this.messageAnnotations(
              await this.accountSafeMessage(response.messages[index]),
            );
        }
        await this.syncKeepAwake();
        if (response.snapshot && this.keepAwakeStatus)
          response.snapshot.keepAwake = this.keepAwakeStatus;
        if (response.message) response.message = await this.accountSafeMessage(response.message);
        if (response.messages)
          response.messages = await Promise.all(
            response.messages.map((message) => this.accountSafeMessage(message)),
          );
        if (response.messages && input.op === "conversations.search")
          response.messages = response.messages.filter(
            (message) =>
              message.text !== "This message is unavailable because its source access changed.",
          );
        AssistantResponseValidationSchema.parse(response);
        this.ports.onChange?.();
        return response;
      } finally {
        // An optimistic conflict does not change saved policy. Old commands
        // remain fenced by the pause epoch; new commands use current policy.
        if (
          principal === "owner" &&
          (revokeSupervision || input.op === "profile.update") &&
          (await this.supervisionAllowed())
        )
          this.ports.onResume?.();
      }
    };
    if (ASSISTANT_QUEUE_FREE_READS.has(input.op) && !this.closing) return this.ready.then(work);
    return this.serialize(work);
  }
  private async dispatch(
    input: AssistantRequest,
    principal: AssistantPrincipal,
    admission?: RoomManagementAdmission,
  ): Promise<AssistantResponse> {
    switch (input.op) {
      case "narration.pending":
      case "narration.claim":
      case "narration.settle": {
        this.owner(principal);
        if (
          !admission ||
          !(await admission.authorized()) ||
          admission.signal?.aborted ||
          (await this.globalRoomBinding())?.id !== input.threadId
        )
          throw new Error("Narration source unavailable.");
        const identity: NarrationIdentity = {
          threadId: input.threadId,
          environmentId: admission.environmentId,
          deviceHash: admission.deviceHash,
          generation: input.generation,
        };
        const receipts = this.narrationReceipts(admission);
        if (input.op === "narration.settle")
          return { narrationClaimed: await receipts.settle(identity, input.eventId, input.state) };
        if (input.op === "narration.claim") {
          const event = await receipts.claim(identity, input.eventId);
          return {
            narrationClaimed: !!event,
            narrationEvents: event
              ? [
                  {
                    eventId: event.eventId,
                    kind: event.kind,
                    text: event.text,
                    createdAt: event.createdAt,
                  },
                ]
              : [],
          };
        }
        const profile = await this.profile();
        const hour = new Date(this.now()).getHours();
        const quiet =
          profile.quietStart !== profile.quietEnd &&
          (profile.quietStart < profile.quietEnd
            ? hour >= profile.quietStart && hour < profile.quietEnd
            : hour >= profile.quietStart || hour < profile.quietEnd);
        if (
          !profile.voiceNarration ||
          !profile.enabled ||
          !profile.setupComplete ||
          quiet ||
          (await this.effectivePresence()) !== "present"
        )
          return { narrationEvents: [] };
        const rows = await this.store.db
          .prepare(
            "SELECT id FROM assistant_activity WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
          )
          .all();
        const notifications = await this.store.db
          .prepare(
            "SELECT id FROM assistant_runtime WHERE id LIKE 'notification:observation:%' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
          )
          .all();
        const questions = await this.store.db
          .prepare(
            "SELECT id FROM assistant_owner_questions WHERE json_extract(value,'$.status')='open' ORDER BY json_extract(value,'$.createdAt') DESC LIMIT 40",
          )
          .all();
        const events: NarrationEvent[] = [];
        const candidates = [
          ...rows.map((row) => String(row.id)),
          ...notifications.map((row) => String(row.id)),
          ...questions.map((row) => `question:${String(row.id)}`),
        ];
        for (const id of candidates) {
          try {
            const event = await this.narrationSource(id);
            if (
              !event ||
              this.now() - event.createdAt > 300_000 ||
              event.createdAt > this.now() ||
              !(await receipts.available(identity.threadId, event.eventId))
            )
              continue;
            if (!(await this.narrationSourceAuthorized(event))) continue;
            const port = this.ports.withVoiceNarrationAuthorization;
            if (!port) break;
            const allowed = await port(
              {
                threadId: identity.threadId,
                generation: identity.generation,
                eventId: event.eventId,
                projectIds: event.projectIds,
                accountProofs: event.accountProofs,
              },
              admission,
              async (valid) =>
                valid() &&
                (await this.narrationSourceAuthorized(event)) &&
                JSON.stringify(await this.narrationSource(event.eventId)) ===
                  JSON.stringify(event) &&
                valid(),
            );
            if (allowed) events.push(event);
            if (events.length === 20) break;
          } catch {
            // A missing or revoked source is unavailable; continue with other events.
          }
        }
        return {
          narrationEvents: events.map(({ eventId, kind, text, createdAt }) => ({
            eventId,
            kind,
            text,
            createdAt,
          })),
        };
      }
      case "projects.list":
        return { projects: ((await this.ports.listProjects?.()) ?? []).slice(0, 1000) };
      case "snapshot":
        return { snapshot: await this.snapshot(input.limit ?? 50) };
      case "profile.get":
        // Carries no project data, so no Room disclosure capture runs for it.
        return { profile: await this.profile() };
      case "voice.runtime.register": {
        this.owner(principal);
        if (!admission || !(await admission.authorized()) || admission.signal?.aborted)
          throw new Error("Voice runtime owner authority is unavailable.");
        const thread = await this.require<AssistantThread>("threads", input.threadId);
        let nativeProofs: NativeLibraryProof[] = [];
        const projectProofs: { projectId: string; cwd: string }[] = [],
          accountProofs: { accountId: string; version: string }[] = [];
        const fingerprints = new Map<string, string>();
        for (const id of input.seedMessageIds) {
          const message = await this.require<AssistantMessage>("messages", id);
          if (message.threadId !== thread.id)
            throw new Error("Voice runtime seed belongs to another Room.");
          fingerprints.set(id, createHash("sha256").update(JSON.stringify(message)).digest("hex"));
          const native = await this.messageNativeProofs(message),
            projects = await this.messageProjectProofs(message),
            accounts = await this.messageAccountProofs(message);
          if (!native || !projects || !accounts)
            throw new Error("Voice runtime seed provenance is unavailable.");
          if (native.length) {
            const scoped = await this.messageProjectScope(message);
            if (
              !scoped.projectIds ||
              scoped.projectIds.some(
                (projectId) => !projects.some((proof) => proof.projectId === projectId),
              )
            )
              throw new Error("Voice runtime seed project scope is unavailable.");
          }
          nativeProofs = mergeNativeLibraryProofs(nativeProofs, native);
          projectProofs.push(...projects);
          accountProofs.push(...accounts);
        }
        if (input.summaryProofId) {
          const currentProof = await this.threadSummaries.proof(thread.id, thread.summary);
          const sources = await this.threadSummaries.sourceProofs(thread.id, input.summaryProofId);
          if (!currentProof || currentProof.id !== input.summaryProofId || !sources)
            throw new Error("Voice runtime summary provenance is unavailable.");
          nativeProofs = mergeNativeLibraryProofs(nativeProofs, sources.nativeProofs ?? []);
          projectProofs.push(...sources.projectProofs);
          accountProofs.push(...sources.accountProofs);
        }
        if (!nativeProofs.length) return { ok: true };
        if (!this.ports.withNativeVoiceRuntimeRegistration)
          throw new Error("Voice runtime Native registration is unavailable.");
        return this.ports.withNativeVoiceRuntimeRegistration(
          {
            threadId: thread.id,
            generationKey: input.generationKey,
            nativeProofs,
            projectProofs,
            accountProofs,
          },
          admission,
          async (valid) => {
            if (!valid()) throw new Error("Voice runtime source changed.");
            const currentThread = await this.require<AssistantThread>("threads", thread.id);
            if (
              currentThread.version !== thread.version ||
              currentThread.summary !== thread.summary
            )
              throw new Error("Voice runtime Room changed.");
            for (const [id, fingerprint] of fingerprints) {
              const message = await this.require<AssistantMessage>("messages", id);
              if (
                createHash("sha256").update(JSON.stringify(message)).digest("hex") !== fingerprint
              )
                throw new Error("Voice runtime seed changed.");
              const current = await this.messageNativeProofs(message);
              if (
                !current ||
                current.some(
                  (proof) =>
                    !nativeProofs.some(
                      (expected) => JSON.stringify(expected) === JSON.stringify(proof),
                    ),
                )
              )
                throw new Error("Voice runtime source changed.");
            }
            if (!valid()) throw new Error("Voice runtime source changed.");
            return { ok: true };
          },
        );
      }
      case "voice.context.open":
        this.owner(principal);
        return { voiceContext: await this.voiceContexts.open(input) };
      case "voice.context.get":
        this.owner(principal);
        return { voiceContext: await this.voiceContexts.get(input.id) };
      case "voice.context.invalidate":
        this.owner(principal);
        return { voiceContext: await this.voiceContexts.invalidate(input) };
      case "jobs.get":
        this.owner(principal);
        return { job: this.jobOutput(await this.require<AssistantJob>("jobs", input.id)) };
      case "jobs.activity":
        this.owner(principal);
        return {
          jobActivity: await jobLog.listAssistantJobActivity(this.store.db, input.id, input.limit),
        };
      case "questions.get":
        this.owner(principal);
        return this.ownerQuestions.get(input.id, input.requestId);
      case "questions.ask": {
        if (principal !== "chief" || !(await this.supervisionAllowed()))
          throw new Error("Only the current Chief may request a decision for its assigned job.");
        return this.ownerQuestions.ask(
          input,
          () => this.supervisionAllowed(),
          (question) => this.ownerQuestionEvent(question, "requested"),
        );
      }
      case "questions.present": {
        this.owner(principal);
        return this.ownerQuestions.present(input, (question) =>
          this.ownerQuestionEvent(question, "requested"),
        );
      }
      case "questions.answer":
      case "questions.snooze":
      case "questions.cancel": {
        this.owner(principal);
        return this.ownerQuestions.mutate(input, (question, kind) =>
          this.ownerQuestionEvent(question, kind),
        );
      }
      case "manual.list":
        this.owner(principal);
        return this.manualResult();
      case "observation.delivery.list":
      case "observation.delivery.refresh":
        throw new Error("Task notification recovery requires the native Room transport.");
      case "manual.policy": {
        this.owner(principal);
        if (!this.ports.manual) throw new Error("Manual supervision is unavailable on this Host.");
        const projectIds = [...new Set(input.projectIds)],
          known = new Set(((await this.ports.listProjects?.()) ?? []).map((project) => project.id));
        if (projectIds.some((id) => !known.has(id)))
          throw new Error("Choose only current Host projects for manual supervision.");
        if (input.enabled)
          for (const id of projectIds)
            if (!(await this.ports.manualProjectVisible?.(id)))
              throw new Error(
                "A fresh owner privacy snapshot must expose every selected project before enabling manual supervision.",
              );
        await this.store.transaction(async () => {
          const old = await this.manualPolicy();
          if (old.version !== input.expectedVersion)
            throw new Error("Manual supervision policy changed; reload before saving.");
          await this.setRuntime("manualPolicy", {
            enabled: input.enabled,
            version: old.version + 1,
            projectIds,
          });
          await this.activity(
            "manual.policy",
            "The owner updated manual conversation supervision policy.",
          );
        }, "critical");
        return this.manualResult();
      }
      case "manual.enroll": {
        this.owner(principal);
        if (!this.ports.manual || !(await this.manualSupervisionAllowed()))
          throw new Error("Enable Chief autonomy and manual supervision before enrolling.");
        const grant = await this.ports.manual.enroll(input, "owner");
        await this.store.transaction(
          () =>
            this.activity(
              "manual.enrolled",
              "The owner explicitly enrolled a manual conversation.",
              { supervisionId: grant.id, sessionId: grant.sessionId },
            ),
          "critical",
        );
        return this.manualResult();
      }
      case "manual.revoke": {
        this.owner(principal);
        if (!this.ports.manual) throw new Error("Manual supervision is unavailable on this Host.");
        const grant = await this.ports.manual.revoke(input, "owner");
        await this.store.transaction(
          () =>
            this.activity(
              "manual.revoked",
              "The owner revoked a manual conversation's supervision grant.",
              { supervisionId: grant.id, sessionId: grant.sessionId },
            ),
          "critical",
        );
        return this.manualResult();
      }
      case "manual.nudge": {
        if (principal !== "chief" || !(await this.manualSupervisionAllowed()))
          throw new Error("Current Chief autonomy and explicit manual supervision are required.");
        if (!this.ports.manual || !this.ports.manageManualSession)
          throw new Error("Manual supervision is unavailable on this Host.");
        await this.ports.manual.resolveStatus(input.supervisionId, input.sessionId);
        if (!(await this.manualSupervisionAllowed()))
          throw new Error("Manual supervision changed before dispatch.");
        const { op: _, ...operation } = input;
        await this.ports.manageManualSession(operation);
        await this.store.transaction(
          () =>
            this.activity(
              "manual.nudged",
              "The supervisor contacted its explicitly enrolled manual conversation.",
              { supervisionId: input.supervisionId, sessionId: input.sessionId },
            ),
          "critical",
        );
        return { ok: true };
      }
      case "profile.update": {
        this.owner(principal);
        const save = () =>
          this.store.transaction(async () => {
            const previous = await this.profile();
            if (previous.version !== input.expectedVersion)
              throw new Error("Assistant settings changed; reload before saving.");
            const next = { ...previous, ...input.patch, updatedAt: this.now() };
            next.name = next.name.trim();
            if (next.setupComplete && (!next.name.trim() || next.dailyTokenBudget <= 0))
              throw new Error(
                "Name and an explicit daily token budget are required to complete setup.",
              );
            if (next.enabled && !next.setupComplete)
              throw new Error("Complete assistant setup before enabling the core.");
            if (next.voiceSetupComplete && !next.setupComplete)
              throw new Error("Complete core setup before voice setup.");
            if (next.chiefSoftContext >= next.chiefHardContext)
              throw new Error("Chief soft context must be below the hard limit.");
            if (!validWorkerContextSettings(next))
              throw new Error("Worker context limits must increase from compact to handoff.");
            if (!validAssistantPolicy(next))
              throw new Error("The automatic away timeout must be longer than the idle timeout.");
            await this.repository.put(
              "profile",
              { ...next, id: "profile", createdAt: this.now() },
              input.expectedVersion,
            );
            if (next.enabled && next.setupComplete) await this.ensureGlobalRoom();
            await this.activity("profile.updated", "Assistant settings updated.");
            return { profile: await this.profile() };
          }, "critical");
        const previous = await this.profile();
        const removesVoiceSource =
          (previous.enabled && input.patch.enabled === false) ||
          (previous.setupComplete && input.patch.setupComplete === false) ||
          (previous.voiceSetupComplete && input.patch.voiceSetupComplete === false);
        if (removesVoiceSource && this.ports.withNativeVoiceSourcesRetired) {
          return this.ports.withNativeVoiceSourcesRetired((valid) =>
            this.store.db.withAuthorization(async () => valid(), save),
          );
        }
        return save();
      }
      case "memory.save": {
        if (principal !== "owner" && (input.kind !== "fact" || input.source !== "learned"))
          throw new Error("Only the owner may change explicit rules or profile preferences.");
        return this.store.transaction(async () => {
          const entries = await this.repository.memory<AssistantMemory>();
          const duplicate = entries.find(
            (entry) =>
              entry.kind === input.kind &&
              entry.scope === input.scope &&
              entry.text.toLocaleLowerCase() === input.text.toLocaleLowerCase(),
          );
          if (!input.id && duplicate) return { memory: duplicate };
          const old = input.id
            ? await this.repository.get<AssistantMemory>("memory", input.id)
            : undefined;
          if (input.id && (!old || input.expectedVersion === undefined))
            throw new Error("Editing memory requires its current version.");
          if (principal !== "owner" && old && (old.kind !== "fact" || old.source !== "learned"))
            throw new Error("Learned facts cannot replace an owner's explicit memory.");
          const item = {
            ...(old ?? this.stamp()),
            kind: input.kind,
            text: input.text,
            scope: input.scope,
            source: input.source,
            quote: input.quote ?? "",
            active: input.active ?? true,
            forbiddenTerms: input.forbiddenTerms ?? [],
            updatedAt: this.now(),
          };
          const all = [...entries.filter((entry) => entry.id !== item.id), item];
          const rules = all.filter((entry) => entry.kind === "rule" && entry.active);
          if (rules.length > 40 || rules.reduce((sum, r) => sum + r.text.length, 0) > 4000)
            throw new Error("Rule capacity reached; consolidate existing rules first.");
          if (
            all
              .filter((entry) => entry.kind === "profile" && entry.active)
              .reduce((sum, r) => sum + r.text.length, 0) > 1500
          )
            throw new Error("Profile memory capacity reached.");
          const memory = await this.repository.put(
            "memory",
            item,
            input.id ? input.expectedVersion : 0,
          );
          await this.activity(
            "memory.saved",
            input.kind === "rule" ? "An owner rule was saved." : "Memory was updated.",
          );
          return { memory };
        }, "critical");
      }
      case "memory.search": {
        const entries = await this.repository.searchMemory<AssistantMemory>(
          input.query ?? "",
          input.scope,
          input.limit ?? 50,
        );
        return { entries };
      }
      case "memory.delete":
        this.owner(principal);
        await this.store.transaction(
          () => this.repository.trash("memory", input.id, input.expectedVersion, this.now()),
          "critical",
        );
        return { ok: true };
      case "threads.open": {
        if (input.projectId) await this.assertProject(input.projectId);
        return this.store.transaction(async () => {
          if (!input.projectId) return { thread: await this.ensureGlobalRoom() };
          const key = input.projectId ? `project:${input.projectId}` : "global";
          const existing = await this.repository.byKey<AssistantThread>("threads", key);
          const thread =
            existing ??
            (await this.repository.put(
              "threads",
              {
                ...this.stamp(),
                ...(input.projectId ? { projectId: input.projectId } : {}),
                summary: "",
              },
              0,
              key,
            ));
          return { thread };
        });
      }
      case "threads.messages": {
        const thread = await this.require<AssistantThread>("threads", input.threadId);
        const messages = await this.repository.messages<AssistantMessage>(
          input.threadId,
          input.limit ?? 50,
          input.before,
          input.beforeId,
        );
        return { messages, thread };
      }
      case "threads.summary.refresh": {
        this.owner(principal);
        await this.require<AssistantThread>("threads", input.threadId);
        await this.threadSummaries.refresh(input.threadId, input.requestId);
        return { thread: await this.require<AssistantThread>("threads", input.threadId) };
      }
      case "threads.clear": {
        this.owner(principal);
        return this.store.transaction(async () => {
          const thread = await this.require<AssistantThread>("threads", input.threadId);
          if (thread.version !== input.expectedVersion)
            throw new Error("Conversation changed; reload before clearing it.");
          await this.store.db
            .prepare(
              "UPDATE assistant_messages SET deleted_at=? WHERE deleted_at IS NULL AND json_extract(value,'$.threadId')=?",
            )
            .run(this.now(), thread.id);
          await this.threadSummaries.clear(thread.id);
          const updated = await this.repository.put(
            "threads",
            { ...thread, updatedAt: this.now() },
            thread.version,
          );
          await this.activity(
            "conversation.cleared",
            "The owner cleared a conversation. Its summary was retained.",
          );
          return { ok: true, thread: updated };
        }, "critical");
      }
      case "conversations.retention": {
        this.owner(principal);
        await this.store.transaction(async () => {
          await this.setRuntime("conversationRetentionDays", input.days);
          await this.applyConversationRetention();
          await this.activity(
            "conversation.retention",
            "The owner changed conversation retention.",
          );
        }, "critical");
        return { ok: true };
      }
      case "voice.language.record": {
        this.owner(principal);
        if (input.observedAt > this.now() + 300000)
          throw new Error("The accepted speech timestamp is in the future.");
        await this.store.transaction(async () => {
          const key = `ownerLanguage:${input.requestId}`;
          const previous = await this.runtime<{ language: string; observedAt: number } | null>(
            key,
            null,
          );
          if (previous) {
            if (previous.language !== input.language || previous.observedAt !== input.observedAt)
              throw new Error("The accepted speech identity changed.");
            return;
          }
          await this.setRuntime(key, { language: input.language, observedAt: input.observedAt });
          const last = await this.runtime<{ language: string; observedAt: number } | null>(
            "lastSpokenLanguage",
            null,
          );
          if (!last || input.observedAt >= last.observedAt)
            await this.setRuntime("lastSpokenLanguage", {
              language: input.language,
              observedAt: input.observedAt,
            });
        }, "critical");
        return { ok: true };
      }
      case "conversations.search":
        return {
          messages: await this.repository.searchMessages<AssistantMessage>(
            input.query,
            input.threadId,
            input.limit ?? 50,
          ),
        };
      case "threads.append": {
        const ownerVoiceTranscript = principal === "owner" && input.via === "voice";
        if (!ownerVoiceTranscript && (principal === "owner") !== (input.role === "user"))
          throw new Error("Message authorship must match the captured principal.");
        if (input.causalContextId && (!ownerVoiceTranscript || input.role !== "assistant"))
          throw new Error("Only captured owner voice output may carry a voice context receipt.");
        return this.store.transaction(async () => {
          const thread = await this.require<AssistantThread>("threads", input.threadId);
          if (input.sessionId) {
            let session;
            try {
              session = await this.store.session(input.sessionId);
            } catch {
              throw new Error(
                "The transcript session is not available on this Host. Native-only or local shell IDs cannot be used as Host sources.",
              );
            }
            if (thread.projectId && session.projectId !== thread.projectId)
              throw new Error("The transcript session belongs to another project's thread scope.");
          }
          const key = `${input.threadId}:${input.idempotencyKey}`;
          const old = await this.repository.byKey<AssistantMessage>("messages", key);
          if (old) {
            const context = await this.runtime<{ contextId: string } | null>(
              `messageVoiceContextInput:${old.id}`,
              null,
            );
            if (
              old.text !== input.text ||
              old.role !== input.role ||
              old.via !== input.via ||
              old.sessionId !== input.sessionId ||
              context?.contextId !== input.causalContextId
            )
              throw new Error("A message retry must preserve the original payload.");
            return { message: old };
          }
          for (const jobId of input.jobIds ?? []) {
            const job = await this.require<AssistantJob>("jobs", jobId);
            const projects = assistantJobProjectIds(job);
            if (thread.projectId && projects.length && !projects.includes(thread.projectId))
              throw new Error("Job belongs to another thread scope.");
          }
          const message = await this.repository.put(
            "messages",
            {
              ...this.stamp(),
              threadId: input.threadId,
              role: input.role,
              via: input.via,
              text: input.text,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              jobIds: input.jobIds ?? [],
            },
            0,
            key,
          );
          if (input.role === "user") {
            const ids = new Set<string>();
            if (thread.projectId) ids.add(thread.projectId);
            if (input.sessionId) ids.add((await this.store.session(input.sessionId)).projectId);
            for (const jobId of input.jobIds ?? []) {
              const job = await this.require<AssistantJob>("jobs", jobId);
              for (const id of assistantJobProjectIds(job)) ids.add(id);
            }
            try {
              const proofs = await Promise.all(
                [...ids].sort().map(async (projectId) => ({
                  projectId,
                  cwd: (await this.store.project(projectId)).cwd,
                })),
              );
              await this.setRuntime(`messageProjectOrigins:${message.id}`, {
                threadId: message.threadId,
                proofs,
              });
            } catch {
              // The accepted transcript remains; unverified project identity cannot authorize derived output.
            }
          }
          if (input.causalContextId) {
            await this.setRuntime(`messageVoiceContextInput:${message.id}`, {
              contextId: input.causalContextId,
            });
            const proof = await this.voiceContexts.capture(input.causalContextId, input.threadId);
            if (proof)
              await this.setRuntime(`messageScopeVoice:${message.id}`, {
                contextId: proof.contextId,
                version: proof.version,
                threadId: input.threadId,
              });
          }
          await this.repository.put(
            "threads",
            { ...thread, updatedAt: this.now() },
            thread.version,
          );
          await this.threadSummaries.record(message.id);
          return { message };
        }, "critical");
      }
      case "messages.linkJob": {
        this.owner(principal);
        return this.store.transaction(async () => {
          const message = await this.require<AssistantMessage>("messages", input.id);
          if (message.role !== "user" || message.ownerQuestionId)
            throw new Error("Link work to its accepted owner message.");
          const thread = await this.require<AssistantThread>("threads", message.threadId);
          const job = await this.require<AssistantJob>("jobs", input.jobId);
          if (job.idempotencyKey !== input.jobKey)
            throw new Error("The original accepted job receipt is required.");
          const projects = assistantJobProjectIds(job);
          if (thread.projectId && projects.length && !projects.includes(thread.projectId))
            throw new Error("Job belongs to another thread scope.");
          if (message.jobIds.includes(job.id)) return { message };
          if (message.jobIds.length >= 20)
            throw new Error("This message already links twenty jobs.");
          const origins = await this.runtime<{
            threadId: string;
            proofs: { projectId: string; cwd: string }[];
          } | null>(`messageProjectOrigins:${message.id}`, null);
          if (origins?.threadId === message.threadId && Array.isArray(origins.proofs)) {
            const captured = new Map(origins.proofs.map((proof) => [proof.projectId, proof.cwd]));
            for (const projectId of projects) {
              const cwd = (await this.store.project(projectId)).cwd;
              if (captured.has(projectId) && captured.get(projectId) !== cwd)
                throw new Error("Message project source changed.");
              captured.set(projectId, cwd);
            }
            await this.setRuntime(`messageProjectOrigins:${message.id}`, {
              threadId: message.threadId,
              proofs: [...captured].map(([projectId, cwd]) => ({ projectId, cwd })),
            });
          }
          return {
            message: await this.repository.put(
              "messages",
              { ...message, jobIds: [...message.jobIds, job.id], updatedAt: this.now() },
              message.version,
            ),
          };
        }, "critical");
      }
      case "threads.sendIdentity": {
        this.owner(principal);
        return { sendIdentity: { instanceId: this.nativeSendInstance } };
      }
      case "threads.sendStatus": {
        this.owner(principal);
        if (input.expectedHostInstance !== this.nativeSendInstance)
          throw new Error("The original Host instance changed.");
        await this.require<AssistantThread>("threads", input.threadId);
        const key = `reply:${input.threadId}:${input.idempotencyKey}`;
        const receipt = await this.runtime<{
          status: string;
          text: string;
          via?: "text" | "voice";
          userMessageId?: string;
          userFingerprint?: string;
          messageId?: string;
        } | null>(key, null);
        // Absence can mean admission is still in progress. It never permits a resend.
        if (!receipt) return { sendReceipt: { status: "unknown" } };
        if (receipt.text !== input.text || (receipt.via && receipt.via !== "text"))
          throw new Error("Conversation receipt identity changed.");
        if (!receipt.userMessageId || !receipt.userFingerprint)
          return { sendReceipt: { status: "unknown" } };
        const user = await this.require<AssistantMessage>("messages", receipt.userMessageId);
        if (
          user.threadId !== input.threadId ||
          user.role !== "user" ||
          user.via !== "text" ||
          user.text !== input.text ||
          user.sessionId !== input.sessionId ||
          createHash("sha256").update(JSON.stringify(user)).digest("hex") !==
            receipt.userFingerprint
        )
          throw new Error("Conversation receipt identity changed.");
        if (receipt.status === "settled" && receipt.messageId) {
          const reply = await this.require<AssistantMessage>("messages", receipt.messageId);
          if (reply.threadId !== input.threadId || reply.role !== "assistant")
            throw new Error("Conversation receipt identity changed.");
          return { sendReceipt: { status: "settled" }, messages: [reply] };
        }
        return { sendReceipt: { status: receipt.status === "refused" ? "refused" : "unknown" } };
      }
      case "threads.send": {
        this.owner(principal);
        if (input.expectedHostInstance && input.expectedHostInstance !== this.nativeSendInstance)
          throw new Error("The original Host instance changed.");
        if (!this.ports.reply)
          throw new Error("Conversation replies are unavailable on this Host.");
        const profile = await this.profile();
        if (!profile.setupComplete || !profile.enabled || !assistantRoleExecution(profile, "reply"))
          throw new Error("Configure and enable the assistant before starting a conversation.");
        const thread = await this.require<AssistantThread>("threads", input.threadId);
        const rawSummaryProof = await this.threadSummaries.proof(thread.id, thread.summary);
        const summarySources = rawSummaryProof
          ? await this.threadSummaries.sourceProofs(thread.id, rawSummaryProof.id)
          : undefined;
        const summaryValid =
          summarySources &&
          (!summarySources.projectProofs.length ||
            (!!this.ports.roomProjectProofsValid &&
              (await this.ports.roomProjectProofsValid(summarySources.projectProofs)))) &&
          (!summarySources.accountProofs.length ||
            (!!this.ports.roomAccountProofsValid &&
              (await this.ports.roomAccountProofsValid(thread.id, summarySources.accountProofs))));
        const replySummaryProof = summaryValid ? rawSummaryProof : undefined;
        const key = `reply:${thread.id}:${input.idempotencyKey}`;
        const existing = await this.runtime<{
          status: string;
          text: string;
          via?: "text" | "voice";
          messageId?: string;
          userMessageId?: string;
          userFingerprint?: string;
          attemptFingerprint?: string;
          tokenCap?: number;
          day?: string;
        } | null>(key, null);
        if (existing) {
          if (existing.text !== input.text) throw new Error("Conversation retry payload changed.");
          if (existing.via && existing.via !== input.via)
            throw new Error("Conversation retry payload changed.");
          if (existing.messageId)
            return {
              messages: [await this.require<AssistantMessage>("messages", existing.messageId)],
            };
          const saved =
            admission && this.ports.roomManagement
              ? await this.runtime<RoomManagementTurnState | null>(`room-turn:${key}`, null)
              : null;
          if (
            saved?.phase === "settled" &&
            saved.result &&
            existing.day &&
            existing.tokenCap &&
            admission
          ) {
            const check = async () => {
              admission.signal?.throwIfAborted();
              if (
                !(await admission.authorized()) ||
                saved.environmentId !== admission.environmentId ||
                saved.deviceHash !== admission.deviceHash ||
                saved.threadId !== thread.id ||
                saved.ownerMessageId !== existing.userMessageId
              )
                throw new Error("The original Room management source is unavailable.");
              const owner = await this.require<AssistantMessage>("messages", saved.ownerMessageId);
              if (
                createHash("sha256").update(JSON.stringify(owner)).digest("hex") !==
                existing.userFingerprint
              )
                throw new Error("The original Room owner message changed.");
              const context = JSON.parse(saved.context) as {
                summary: string;
                messages: AssistantMessage[];
              };
              if (
                !Array.isArray(context.messages) ||
                context.messages.length > 6 ||
                (context.summary && context.summary !== thread.summary)
              )
                throw new Error("The original Room context changed.");
              const projects = new Set(saved.result!.contributorProjectIds ?? []);
              for (const record of saved.calls) {
                if (
                  record.call.input.nativeLibrary === true &&
                  record.status === "completed" &&
                  (!record.contributorNativeProofs?.length ||
                    record.contributorNativeProofs.some(
                      (proof) =>
                        !saved.result!.contributorNativeProofs?.some(
                          (item) => JSON.stringify(item) === JSON.stringify(proof),
                        ),
                    ))
                )
                  throw new Error("The original Native library provenance is unavailable.");
                if (record.call.projectId) {
                  projects.add(record.call.projectId);
                  if (
                    record.status === "completed" &&
                    !record.contributorProjects?.some(
                      (proof) =>
                        proof.projectId === record.call.projectId &&
                        saved.result!.contributorProjects?.some(
                          (savedProof) =>
                            savedProof.projectId === proof.projectId &&
                            savedProof.cwd === proof.cwd,
                        ),
                    )
                  )
                    throw new Error("The original Room project provenance is unavailable.");
                }
              }
              const canonical = (message: AssistantMessage) => {
                const {
                  projectIds: _scope,
                  toolActions: _actions,
                  visibilityProjectIds: _visibility,
                  unverifiedToolContext: _unknown,
                  ...raw
                } = message;
                return JSON.stringify(raw);
              };
              for (const message of context.messages) {
                const current = await this.require<AssistantMessage>("messages", message.id);
                if (canonical(current) !== canonical(message))
                  throw new Error("The original Room context changed.");
                for (const id of message.projectIds ?? []) projects.add(id);
              }
              if (context.summary) {
                if (!replySummaryProof)
                  throw new Error("The original Room summary proof is unavailable.");
                for (const id of replySummaryProof.projectIds) projects.add(id);
              }
              if ([...projects].some((id) => !saved.result!.visibilityProjectIds?.includes(id)))
                throw new Error("The original Room project disclosure proof is unavailable.");
              const accountProofs = saved.result!.contributorAccounts ?? [];
              if (
                accountProofs.length &&
                (!this.ports.roomAccountProofsValid ||
                  !(await this.ports.roomAccountProofsValid(thread.id, accountProofs)))
              )
                throw new Error("The original Room account access became unavailable or changed.");
              if (
                projects.size &&
                (!this.ports.roomManagementVisible ||
                  !(await this.ports.roomManagementVisible(thread.id, [...projects], admission)))
              )
                throw new Error("The original Room context became private.");
              return context;
            };
            const context = await this.reason(async () => check());
            const output = await this.safeOutput(truncateGraphemes(saved.result.text, 16000));
            await check();
            return this.withRoomDisclosure(
              thread.id,
              saved.result!.visibilityProjectIds ?? [],
              saved.result!.contributorAccounts ?? [],
              admission,
              (valid) =>
                this.store.transaction(async () => {
                  if (!valid()) throw new Error("Room source visibility changed.");
                  if (
                    saved.result!.contributorAccounts?.length &&
                    (!this.ports.roomAccountProofsValid ||
                      !(await this.ports.roomAccountProofsValid(
                        thread.id,
                        saved.result!.contributorAccounts,
                      )))
                  )
                    throw new Error(
                      "The original Room account access became unavailable or changed.",
                    );
                  const reply = (
                    await this.dispatch(
                      {
                        op: "threads.append",
                        threadId: thread.id,
                        role: "assistant",
                        via: input.via,
                        text: output,
                        jobIds: [],
                        idempotencyKey: `reply:${input.idempotencyKey}`,
                      },
                      "assistant",
                    )
                  ).message!;
                  await this.setRuntime(`messageScopeSources:${reply.id}`, {
                    threadId: thread.id,
                    messageIds: context.messages.map((message) => message.id),
                    summaryUsed: !!context.summary,
                    ...(replySummaryProof ? { summaryProofId: replySummaryProof.id } : {}),
                    managementTurnId: `room-turn:${key}`,
                  });
                  await this.setRuntime(key, {
                    ...existing,
                    status: "settled",
                    messageId: reply.id,
                  });
                  await this.settleChiefUsage(
                    existing.day!,
                    existing.tokenCap!,
                    saved.result!.tokens ?? existing.tokenCap!,
                    saved.result!.tokens === undefined,
                  );
                  if (!valid()) throw new Error("Room source visibility changed.");
                  return {
                    messages: [
                      await this.require<AssistantMessage>("messages", saved.ownerMessageId),
                      reply,
                    ],
                  };
                }, "critical"),
              saved.result!.contributorProjects ?? [],
              saved.result!.contributorNativeProofs ?? [],
            );
          }
          if (existing.status !== "refused")
            throw new Error(
              "The previous reply has an uncertain outcome. Read History before sending another request.",
            );
          if (!existing.userMessageId || !existing.userFingerprint || !existing.attemptFingerprint)
            throw new AssistantTextPreflightError();
        }
        const usage = await this.usage(profile);
        const tokenCap = Math.min(
          profile.perWakeTokenCap,
          Math.floor(profile.dailyTokenBudget * 0.8 - usage.total),
        );
        if (tokenCap < 1000 || usage.mode !== "run")
          throw new Error("The assistant token budget does not allow another reply.");
        const user = existing
          ? await this.require<AssistantMessage>("messages", existing.userMessageId!)
          : (
              await this.dispatch(
                { ...input, op: "threads.append", role: "user", jobIds: [] },
                "owner",
              )
            ).message!;
        const userFingerprint = createHash("sha256").update(JSON.stringify(user)).digest("hex");
        if (
          user.threadId !== thread.id ||
          user.role !== "user" ||
          user.via !== input.via ||
          user.text !== input.text ||
          (existing && existing.userFingerprint !== userFingerprint)
        )
          throw new Error("The original conversation message changed or is no longer available.");
        const recent = (
          await this.dispatch({ op: "threads.messages", threadId: thread.id, limit: 6 }, principal)
        ).messages!;
        const messages = await Promise.all(
          [...recent.filter((message) => message.id !== user.id).slice(-5), user].map((message) =>
            this.accountSafeMessage(message),
          ),
        );
        const instructions = await this.instructions("all");
        const management = admission && this.ports.roomManagement;
        const scopedMessages = management ? await this.messageProjectScopes(messages) : messages;
        const contextAccounts = new Map<string, string>();
        const contextProjects = new Map<string, string>();
        let contextNativeProofs: NativeLibraryProof[] = [];
        if (replySummaryProof && summarySources) {
          contextNativeProofs = mergeNativeLibraryProofs(
            contextNativeProofs,
            summarySources.nativeProofs ?? [],
          );
          for (const proof of summarySources.accountProofs)
            contextAccounts.set(proof.accountId, proof.version);
          for (const proof of summarySources.projectProofs)
            contextProjects.set(proof.projectId, proof.cwd);
        }
        const managementMessages: AssistantMessage[] = [];
        for (const message of scopedMessages) {
          const native = await this.messageNativeProofs(message);
          if (
            !native ||
            (native.length &&
              (!this.ports.roomNativeProofsValid ||
                !(await this.ports.roomNativeProofsValid(native, admission))))
          )
            continue;
          contextNativeProofs = mergeNativeLibraryProofs(contextNativeProofs, native);
          const proofs = await this.messageAccountProofs(message);
          if (
            !proofs ||
            (proofs.length &&
              (!this.ports.roomAccountProofsValid ||
                !(await this.ports.roomAccountProofsValid(thread.id, proofs))))
          )
            continue;
          const projectProofs = await this.messageProjectProofs(message);
          if (
            !projectProofs ||
            (projectProofs.length &&
              (!this.ports.roomProjectProofsValid ||
                !(await this.ports.roomProjectProofsValid(projectProofs))))
          )
            continue;
          for (const proof of projectProofs) {
            if (
              contextProjects.has(proof.projectId) &&
              contextProjects.get(proof.projectId) !== proof.cwd
            )
              throw new Error("Room project source changed while preparing context.");
            contextProjects.set(proof.projectId, proof.cwd);
          }
          for (const proof of proofs) {
            const previous = contextAccounts.get(proof.accountId);
            if (previous && previous !== proof.version)
              throw new Error("Room account access changed while preparing context.");
            contextAccounts.set(proof.accountId, proof.version);
          }
          if (
            !management ||
            message.id === user.id ||
            Array.isArray(message.projectIds) ||
            (proofs.length &&
              message.text !== "This message is unavailable because its source access changed.")
          )
            managementMessages.push(message);
        }
        const contextProjectIds = [
          ...new Set(scopedMessages.flatMap((message) => message.projectIds ?? [])),
        ];
        if (replySummaryProof)
          for (const id of replySummaryProof.projectIds)
            if (!contextProjectIds.includes(id)) contextProjectIds.push(id);
        const attemptFingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              tokenCap,
              execution: assistantRoleExecution(profile, "reply"),
              summary: thread.summary,
              messages,
              instructions,
            }),
          )
          .digest("hex");
        if (existing?.attemptFingerprint === attemptFingerprint)
          throw new AssistantTextPreflightError();
        const receipt = {
          text: input.text,
          via: input.via,
          userMessageId: user.id,
          userFingerprint,
          attemptFingerprint,
          tokenCap,
          day: usage.day,
        };
        await this.store.transaction(async () => {
          await this.setRuntime(key, { ...receipt, status: "unknown" });
          await this.setRuntime(`usage:${usage.day}`, {
            ...usage,
            chiefTokens: usage.chiefTokens + tokenCap,
            total: usage.total + tokenCap,
            estimated: true,
          });
        }, "critical");
        let result: RoomManagementTurnResult;
        try {
          result = await this.reason(async (signal) => {
            const reply = (managementPrompt?: string, remaining = tokenCap, replySignal = signal) =>
              this.ports.reply!({
                profile,
                thread,
                messages,
                instructions,
                tokenCap: remaining,
                operationId: key,
                signal: replySignal,
                ...(managementPrompt ? { managementPrompt } : {}),
              });
            if (!admission || !this.ports.roomManagement) return reply();
            const contextFingerprints = new Map(
              managementMessages.map((message) => [
                message.id,
                createHash("sha256")
                  .update(JSON.stringify(messages.find((source) => source.id === message.id)))
                  .digest("hex"),
              ]),
            );
            return runRoomManagementTurn(
              {
                operationId: key,
                ownerMessageId: user.id,
                threadId: thread.id,
                ...(thread.projectId ? { projectId: thread.projectId } : {}),
                execution: assistantRoleExecution(profile, "reply"),
                tokenCap,
                signal,
                admission,
                context: JSON.stringify({
                  instructions,
                  summary: replySummaryProof ? thread.summary : "",
                  messages: managementMessages,
                }),
                contextProjectIds,
                contextAccounts: [...contextAccounts].map(([accountId, version]) => ({
                  accountId,
                  version,
                })),
                contextProjects: [...contextProjects].map(([projectId, cwd]) => ({
                  projectId,
                  cwd,
                })),
                contextNativeProofs,
                validateNativeProofs: async (proofs) =>
                  !!this.ports.roomNativeProofsValid &&
                  (await this.ports.roomNativeProofsValid(proofs, admission)),
                validateProjects: async (proofs) =>
                  !!this.ports.roomProjectProofsValid &&
                  (await this.ports.roomProjectProofsValid(proofs)),
                validateAccounts: async (proofs) =>
                  !!this.ports.roomAccountProofsValid &&
                  (await this.ports.roomAccountProofsValid(thread.id, proofs)),
                validateContext: async (ids) => {
                  const current = await this.repository.get<AssistantThread>("threads", thread.id);
                  if (
                    !current ||
                    current.summary !== thread.summary ||
                    current.projectId !== thread.projectId
                  )
                    return false;
                  for (const [id, fingerprint] of contextFingerprints) {
                    const currentMessage = await this.repository.get<AssistantMessage>(
                      "messages",
                      id,
                    );
                    if (
                      !currentMessage ||
                      createHash("sha256").update(JSON.stringify(currentMessage)).digest("hex") !==
                        fingerprint
                    )
                      return false;
                  }
                  return (
                    ids.length === 0 ||
                    (!!this.ports.roomManagementVisible &&
                      (await this.ports.roomManagementVisible(thread.id, ids, admission)))
                  );
                },
              },
              {
                load: () => this.runtime<RoomManagementTurnState | null>(`room-turn:${key}`, null),
                save: (state) =>
                  this.store.transaction(async () => {
                    await this.setRuntime(`room-turn:${key}`, state);
                    await this.setRuntime(`messageRoomTurn:${user.id}`, {
                      managementTurnId: `room-turn:${key}`,
                    });
                  }, "critical"),
                model: (
                  prompt,
                  remaining,
                  modelSignal,
                  projects,
                  proofs,
                  projectProofs,
                  nativeProofs,
                ) =>
                  this.withRoomDisclosure(
                    thread.id,
                    projects,
                    proofs,
                    admission,
                    async (valid) => {
                      if (!valid()) throw new Error("Room source visibility changed.");
                      return await reply(prompt, remaining, modelSignal);
                    },
                    projectProofs,
                    nativeProofs,
                  ),
                delivered: (observations, proofs, projectProofs, nativeProofs) =>
                  this.withRoomDisclosure(
                    thread.id,
                    projectProofs.map((proof) => proof.projectId),
                    proofs,
                    admission,
                    (valid) =>
                      this.ports.roomObservationDelivered?.(
                        thread.id,
                        observations,
                        proofs,
                        valid,
                        projectProofs,
                        nativeProofs,
                      ) ?? Promise.resolve(),
                    projectProofs,
                    nativeProofs,
                  ),
                tool: (call, owner) =>
                  this.ports.roomManagement!(call, {
                    ...owner,
                    signal: owner.signal ? AbortSignal.any([signal, owner.signal]) : signal,
                  }),
              },
            );
          });
        } catch (error) {
          // Only this local preflight type proves no provider request was made.
          // Accepted/uncertain provider failures retain the original reservation.
          if (error instanceof AssistantTextPreflightError)
            await this.store.transaction(async () => {
              await this.setRuntime(key, { ...receipt, status: "refused" });
              await this.settleChiefUsage(usage.day, tokenCap, 0, false);
            }, "critical");
          throw error;
        }
        if (
          result.contributorAccounts?.length &&
          (!this.ports.roomAccountProofsValid ||
            !(await this.ports.roomAccountProofsValid(thread.id, result.contributorAccounts)))
        )
          throw new Error("Room account access became unavailable or changed.");
        const output = await this.safeOutput(result.text.slice(0, 16000));
        if (
          result.contributorAccounts?.length &&
          (!this.ports.roomAccountProofsValid ||
            !(await this.ports.roomAccountProofsValid(thread.id, result.contributorAccounts)))
        )
          throw new Error("Room account access became unavailable or changed.");
        const tokens =
          result.tokens !== undefined && Number.isFinite(result.tokens)
            ? Math.max(0, Math.ceil(result.tokens))
            : tokenCap;
        const reply = await this.withRoomDisclosure(
          thread.id,
          result.visibilityProjectIds ?? [],
          result.contributorAccounts ?? [],
          admission,
          (valid) =>
            this.store.transaction(async () => {
              if (!valid()) throw new Error("Room source visibility changed.");
              if (
                result.contributorAccounts?.length &&
                (!this.ports.roomAccountProofsValid ||
                  !(await this.ports.roomAccountProofsValid(thread.id, result.contributorAccounts)))
              )
                throw new Error("Room account access became unavailable or changed.");
              const reply = (
                await this.dispatch(
                  {
                    op: "threads.append",
                    threadId: thread.id,
                    role: "assistant",
                    via: input.via,
                    text: output,
                    jobIds: [],
                    idempotencyKey: `reply:${input.idempotencyKey}`,
                  },
                  "assistant",
                )
              ).message!;

              await this.setRuntime(`messageScopeSources:${reply.id}`, {
                threadId: thread.id,
                messageIds: (management ? managementMessages : messages).map(
                  (message) => message.id,
                ),
                summaryUsed: management
                  ? !!replySummaryProof && !!thread.summary
                  : !!thread.summary,
                ...(replySummaryProof ? { summaryProofId: replySummaryProof.id } : {}),
                ...(admission && this.ports.roomManagement
                  ? { managementTurnId: `room-turn:${key}` }
                  : {}),
              });
              await this.setRuntime(key, { ...receipt, status: "settled", messageId: reply.id });
              await this.settleChiefUsage(usage.day, tokenCap, tokens, result.tokens === undefined);
              await this.activity("conversation.replied", "A conversation reply was recorded.", {
                tokens,
              });
              if (!valid()) throw new Error("Room source visibility changed.");
              return reply;
            }, "critical"),
          result.contributorProjects ?? [],
          result.contributorNativeProofs ?? [],
        );
        return { messages: [user, reply] };
      }
      case "threads.summary": {
        if (principal === "owner")
          throw new Error("Conversation summaries are generated by the assistant.");
        const thread = await this.require<AssistantThread>("threads", input.threadId);
        return {
          thread: await this.store.transaction(() =>
            this.repository.put(
              "threads",
              { ...thread, summary: input.summary, updatedAt: this.now() },
              input.expectedVersion,
            ),
          ),
        };
      }
      case "messages.delete":
        this.owner(principal);
        await this.store.transaction(
          () => this.repository.trash("messages", input.id, input.expectedVersion, this.now()),
          "critical",
        );
        return { ok: true };
      case "jobs.create": {
        const profile = await this.profile();
        if (!profile.setupComplete || !profile.enabled)
          throw new Error("Complete setup and enable the assistant before assigning work.");
        if (input.kind === "quick") {
          this.owner(principal);
          const quickAction =
            input.quickAction.kind === "note"
              ? normalizeAssistantQuickNoteAction(input.quickAction)
              : normalizeAssistantQuickAutomationAction(input.quickAction);
          if (quickAction.kind === "note" ? !this.quickJobs : !this.quickAutomations)
            throw new Error("This quick action is unavailable on this Host.");
          if (quickAction.kind === "automation") await this.assertProject(quickAction.projectId);
          const job = await this.store.transaction(async () => {
            const old = await this.repository.byKey<AssistantJob>("jobs", input.idempotencyKey);
            if (old) {
              if (
                old.kind !== "quick" ||
                old.title !== input.title ||
                old.request !== input.request ||
                JSON.stringify(old.quickAction) !== JSON.stringify(quickAction)
              )
                throw new Error("A job retry must preserve the original request.");
              return old;
            }
            if (
              (await this.repository.list<AssistantJob>("jobs", 10000)).filter(
                (job) => !terminal.has(job.status),
              ).length >= 100
            )
              throw new Error("The assistant already tracks 100 active jobs.");
            const base = {
              ...this.stamp(),
              kind: "quick" as const,
              title: input.title,
              request: input.request,
              status: "queued" as const,
              taskIds: [],
              sessionIds: [],
              progress: { done: 0, total: 1 },
              summary: "",
              tokens: 0,
              tokensComplete: true,
              idempotencyKey: input.idempotencyKey,
              dispatchState: "pending" as const,
            };
            const value: AssistantQuickJob =
              quickAction.kind === "note"
                ? await this.repository.put<AssistantQuickNoteJob>(
                    "jobs",
                    { ...base, projectId: null, projectIds: [], quickAction },
                    0,
                    input.idempotencyKey,
                  )
                : await this.repository.put<AssistantQuickAutomationJob>(
                    "jobs",
                    {
                      ...base,
                      projectId: quickAction.projectId,
                      projectIds: [quickAction.projectId],
                      quickAction,
                      quickIntent: { automationId: assistantQuickAutomationId(base.id) },
                    },
                    0,
                    input.idempotencyKey,
                  );
            await this.activity(
              "job.received",
              quickAction.kind === "note"
                ? "The owner reviewed a one-tool global note job."
                : "The owner reviewed an exact project automation creation.",
              { jobId: value.id },
            );
            return value;
          }, "critical");
          await this.runQuickJob(job);
          return { job: await this.require<AssistantJob>("jobs", job.id) };
        }
        const projectIds = assistantJobProjectIds(input);
        if (projectIds.length > 20)
          throw new Error("Choose at most 20 projects including the lead.");
        for (const id of projectIds) await this.assertProject(id);
        const job = await this.store.transaction(async () => {
          const old = await this.repository.byKey<AssistantJob>("jobs", input.idempotencyKey);
          if (old) {
            if (
              old.kind === "quick" ||
              old.title !== input.title ||
              old.request !== input.request ||
              old.projectId !== input.projectId ||
              JSON.stringify(assistantJobProjectIds(old)) !== JSON.stringify(projectIds)
            )
              throw new Error("A job retry must preserve the original request.");
            return old;
          }
          const active = (await this.repository.list<AssistantJob>("jobs", 10000)).filter(
            (job) => !terminal.has(job.status),
          );
          if (active.length >= 100)
            throw new Error("The assistant already tracks 100 active jobs.");
          const value = await this.repository.put(
            "jobs",
            {
              ...this.stamp(),
              title: input.title,
              request: input.request,
              projectId: input.projectId,
              projectIds,
              status: "queued" as const,
              taskIds: [],
              sessionIds: [],
              progress: { done: 0, total: 0 },
              summary: "",
              tokens: 0,
              idempotencyKey: input.idempotencyKey,
              dispatchState: "pending" as const,
            },
            0,
            input.idempotencyKey,
          );
          await this.activity("job.received", "A new job was received.", { jobId: value.id });
          return value;
        }, "critical");
        await this.tickInner(this.later); // The Chief's model turn may outlast this RPC.
        return { job: await this.require<AssistantJob>("jobs", job.id) };
      }
      case "jobs.control": {
        this.owner(principal);
        const job = await this.controlJob(
          input.id,
          input.expectedVersion,
          input.action,
          input.deleteTasks === true,
          input.taskDeleteToken,
        );
        if (input.action === "resume") {
          this.pendingJobStops.delete(input.id);
          this.ports.onJobResume?.(input.id);
        }
        return { job };
      }
      case "jobs.deleteReview": {
        this.owner(principal);
        const job = await this.require<AssistantJob>("jobs", input.id);
        if (job.version !== input.expectedVersion)
          throw new Error("Job changed; refresh before reviewing task deletion.");
        if (!this.ports.jobDeletion)
          throw new Error("Canonical task deletion is unavailable on this Host.");
        return { deleteReview: await this.ports.jobDeletion.review(job) };
      }
      case "jobs.deleteAbort": {
        this.owner(principal);
        const job = await this.require<AssistantJob>("jobs", input.id);
        if (job.version !== input.expectedVersion)
          throw new Error("Job changed; refresh before keeping its tasks.");
        if (!this.ports.jobDeletion)
          throw new Error("Canonical task deletion is unavailable on this Host.");
        return {
          job: await this.ports.jobDeletion.abort(job, this.now(), (state) =>
            this.repository.put<AssistantJob>(
              "jobs",
              {
                ...job,
                status: "paused",
                pendingTaskDeletion: false,
                awaitingOwnerRestart: true,
                summary: state.retirementUnknown
                  ? "Job and tasks were kept paused. Only the deletion hold was released; original execution retirement is still unknown."
                  : "Job and tasks were kept after original work retired. Review before an explicit restart.",
                updatedAt: this.now(),
              },
              job.version,
            ),
          ),
        };
      }
      case "sessions.nudge": {
        if (principal !== "chief" || !(await this.supervisionAllowed()))
          throw new Error("A current supervisor grant is required.");
        if (!this.ports.manageSession) throw new Error("Managed session control is unavailable.");
        const { op: _, ...operation } = input;
        const recovery = await this.ports.manageSession(operation);
        if (recovery) {
          if (recovery.state !== "queued") throw new Error(recovery.message);
          return { ok: true };
        }
        await this.store.transaction(
          () =>
            this.activity("session.nudged", "The supervisor contacted its managed session.", {
              jobId: input.jobId,
              sessionId: input.sessionId,
            }),
          "critical",
        );
        return { ok: true };
      }
      case "sessions.answer": {
        if (
          principal !== "chief" ||
          !(await this.routineQuestionsAllowed()) ||
          this.pendingJobStops.has(input.jobId)
        )
          throw new Error(
            "Routine worker answers require current Chief autonomy and explicit owner policy.",
          );
        if (!this.ports.answerSession)
          throw new Error("Routine worker answers are unavailable on this Host.");
        const { op: _, ...operation } = input;
        try {
          await this.ports.answerSession(operation);
          await this.store.transaction(
            () =>
              this.activity(
                "session.answerSubmitted",
                "A routine clarification was submitted through its exact worker question protocol. Model consumption remains unverified.",
                { jobId: input.jobId, sessionId: input.sessionId },
              ),
            "critical",
          );
        } catch (error) {
          const event = await this.store.transaction(
            () =>
              this.activity(
                "session.answerUnknown",
                "A worker answer needs owner inspection; its original occurrence will not be replayed.",
                { jobId: input.jobId, sessionId: input.sessionId },
              ),
            "critical",
          );
          await this.appendDailyNote(await this.profile(), [event]);
          throw error;
        }
        return { ok: true };
      }
      case "jobs.priority": {
        this.owner(principal);
        return this.store.transaction(async () => {
          const job = await this.require<AssistantJob>("jobs", input.id);
          if (job.kind === "quick") throw new Error("Only project jobs have scheduling priority.");
          if (job.version !== input.expectedVersion)
            throw new Error("Job changed; reload before changing priority.");
          if (terminal.has(job.status))
            throw new Error("A finished job cannot change scheduling priority.");
          const next = await this.repository.put<AssistantProjectJob>(
            "jobs",
            { ...job, priority: input.priority, updatedAt: this.now() },
            input.expectedVersion,
          );
          await this.activity("job.priority", "The owner changed the job's scheduling priority.", {
            jobId: job.id,
          });
          return { job: next };
        }, "critical");
      }
      case "sessions.detach": {
        this.owner(principal);
        if (input.supervisionId) {
          if (!this.ports.manual)
            throw new Error("Manual supervision is unavailable on this Host.");
          const current = (await this.ports.manual.list()).find(
            (grant) => grant.id === input.supervisionId && grant.sessionId === input.sessionId,
          );
          if (!current || current.version !== input.expectedVersion)
            throw new Error("The supervision source changed. Refresh before retrying.");
          const grant = await this.ports.manual.revoke(
            { id: current.id, expectedVersion: input.expectedVersion },
            "owner",
          );
          await this.store.transaction(
            () =>
              this.activity(
                "manual.revoked",
                "The owner revoked a manual conversation's supervision grant.",
                { supervisionId: grant.id, sessionId: grant.sessionId },
              ),
            "critical",
          );
          return { ok: true };
        }
        if (!this.ports.detachSession)
          throw new Error("Session supervision withdrawal is unavailable on this Host.");
        const job = await this.require<AssistantJob>("jobs", input.jobId!);
        if (
          job.kind === "quick" ||
          job.version !== input.expectedVersion ||
          !job.sessionIds.includes(input.sessionId)
        )
          throw new Error("The supervision source changed. Refresh before retrying.");
        const result = await this.ports.detachSession({
          jobId: job.id,
          sessionId: input.sessionId,
          expectedVersion: input.expectedVersion,
        });
        if (result.detached !== true)
          throw new Error("Session supervision withdrawal was not confirmed.");
        await this.store.transaction(
          () =>
            this.activity(
              "session.detached",
              "The owner withdrew supervision from this session; its task and worker remain unchanged.",
              { jobId: job.id, sessionId: input.sessionId },
            ),
          "critical",
        );
        return { ok: true };
      }
      case "jobs.replan": {
        if (principal === "assistant")
          throw new Error("Replanning requires the owner or the supervisor.");
        if (principal === "chief" && !(await this.supervisionAllowed()))
          throw new Error("Automatic replanning requires current Chief autonomy.");
        const profile = await this.profile();
        const usage = await this.usage(profile);
        if (usage.mode !== "run" || (await this.runtime("paused", false)))
          throw new Error("The supervisor is paused or restricted by its budget.");
        if (!this.ports.replanGoal) throw new Error("Goal replanning is unavailable.");
        const job = await this.require<AssistantJob>("jobs", input.id);
        if (job.kind === "quick") throw new Error("Quick actions do not use goal replanning.");
        if (job.version !== input.expectedVersion)
          throw new Error("Job changed; reload before replanning.");
        if (!job.goalId || terminal.has(job.status) || job.status === "paused")
          throw new Error("Only an active unpaused linked goal may be replanned.");
        const attempts = await this.runtime<number>(`replans:${job.id}`, 0);
        if (attempts >= 3)
          throw new Error("Automatic replan limit reached; the owner must review this job.");
        await this.store.transaction(async () => {
          if (principal === "chief" && !(await this.supervisionAllowed()))
            throw new Error("Automatic replanning requires current Chief autonomy.");
          await this.setRuntime(`replans:${job.id}`, attempts + 1);
        }, "critical");
        if (principal === "chief" && !(await this.supervisionAllowed()))
          throw new Error("Automatic replanning requires current Chief autonomy.");
        await this.ports.replanGoal(job.goalId, input.feedback, job);
        const next = await this.store.transaction(async () => {
          const next = await this.repository.put<AssistantJob>(
            "jobs",
            { ...job, status: "planning", updatedAt: this.now() },
            job.version,
          );
          await this.activity("job.replanned", "The goal was sent for replanning.", {
            jobId: job.id,
          });
          return next;
        }, "critical");
        return { job: next };
      }
      case "activity.clear": {
        this.owner(principal);
        await this.store.transaction(async () => {
          for (const item of await this.repository.list<AssistantActivity>("activity", 100000))
            if (!input.jobId || item.jobId === input.jobId)
              await this.repository.trash("activity", item.id, item.version, this.now());
        }, "critical");
        return { ok: true };
      }
      case "presence.set": {
        this.owner(principal);
        const old = await this.runtime<AssistantPresence>("presence", {
          state: "present",
          since: this.now(),
          updatedAt: this.now(),
        });
        const next = {
          state: input.state,
          since: old.state === input.state ? old.since : this.now(),
          updatedAt: this.now(),
        };
        await this.store.transaction(async () => {
          await this.setRuntime("presence", next);
          if (input.state !== "present") {
            if ((await this.runtime<number | null>("presenceAbsenceSince", null)) === null)
              await this.setRuntime("presenceAbsenceSince", this.now());
          } else if ((await this.effectivePresence()) === "present")
            await this.setRuntime("presenceAbsenceSince", null);
        });
        if (
          input.state === "present" &&
          old.state !== "present" &&
          this.now() - old.since >= 30 * 60000
        )
          await this.prepareBriefing(old.since, undefined, this.now());
        return { ok: true };
      }
      case "briefing.dismiss":
        this.owner(principal);
        if ((await this.runtime<{ id: string } | null>("briefing", null))?.id === input.id)
          await this.store.transaction(() => this.setRuntime("briefing", null));
        return { ok: true };
      case "briefing.daily": {
        this.owner(principal);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
          !Number.isFinite(Date.parse(input.day)) ||
          utcDay(input.day) !== input.day ||
          Math.abs(Date.parse(input.day) - this.now()) > 2 * DAY
        )
          throw new Error("Daily briefing requires a current local calendar date.");
        await this.prepareBriefing(this.now() - DAY, input.day);
        const snapshot = await this.snapshot(100),
          savedId = await this.runtime<string | null>(`dailyBriefing:${input.day}`, null);
        const artifact = await this.runtime<AssistantSnapshot["briefing"]>(
          `dailyBriefingArtifact:${input.day}`,
          null,
        );
        // A return briefing may replace the global pointer. A daily read must
        // return its own immutable artifact without restoring or notifying it.
        const briefing =
          artifact && artifact.id === savedId
            ? artifact
            : snapshot.briefing?.id === savedId
              ? snapshot.briefing
              : null;
        return { ok: true, snapshot: { ...snapshot, briefing } };
      }
      case "briefing.schedule": {
        this.owner(principal);
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time))
          throw new Error("Briefing time must be HH:mm in the Host's local time.");
        await this.store.transaction(
          () => this.setRuntime("briefingSchedule", { enabled: input.enabled, time: input.time }),
          "critical",
        );
        return { ok: true };
      }
      case "notifications.ack": {
        this.owner(principal);
        const key = `notification:${input.id}`,
          value = await this.runtime<PendingNotification | null>(key, null);
        if (value && !value.acknowledgedAt)
          await this.store.transaction(
            () => this.setRuntime(key, { ...value, acknowledgedAt: this.now() }),
            "critical",
          );
        return { ok: true };
      }
      case "notes.get":
        this.owner(principal);
        return {
          note: this.ports.getNote
            ? await this.ports.getNote(input.id)
            : await this.assertNote(input.id),
        };
      case "notes.save": {
        this.owner(principal);
        if (!this.ports.saveNote)
          throw new Error("Global assistant notes are unavailable on this Host.");
        if (input.id && input.expectedUpdatedAt !== 0) await this.assertNote(input.id);
        return {
          note: await this.ports.saveNote({
            ...(input.id ? { id: input.id } : {}),
            title: input.title,
            body: input.body,
            expectedUpdatedAt: input.expectedUpdatedAt,
          }),
        };
      }
      case "notes.delete": {
        this.owner(principal);
        return this.roomNotebookDelete(input.id, input.expectedUpdatedAt, async () => true);
      }
      case "trash.restore":
      case "trash.purge": {
        this.owner(principal);
        const [table, id] = this.trashIdentity(input.id);
        const row = await this.store.db
          .prepare(`SELECT deleted_at FROM assistant_${table} WHERE id=?`)
          .get(id);
        if (!row?.deleted_at) throw new Error("Deleted item was not found.");
        if (input.op === "trash.restore" && this.now() - row.deleted_at >= 7 * DAY)
          throw new Error("The restore period has expired.");
        if (table === "memory" && input.op === "trash.restore") {
          const restored = await this.repository.get<AssistantMemory>("memory", id, true);
          const all = await this.repository.memory<AssistantMemory>();
          if (restored?.active && restored.kind === "rule") {
            const rules = all.filter((item) => item.kind === "rule" && item.active);
            if (
              rules.length >= 40 ||
              rules.reduce((sum, item) => sum + item.text.length, 0) + restored.text.length > 4000
            )
              throw new Error("Rule capacity reached; consolidate before restoring this rule.");
          }
          if (
            restored?.active &&
            restored.kind === "profile" &&
            all
              .filter((item) => item.kind === "profile" && item.active)
              .reduce((sum, item) => sum + item.text.length, 0) +
              restored.text.length >
              1500
          )
            throw new Error("Profile memory capacity reached.");
        }
        if (table === "notetrash" && input.op === "trash.restore") {
          if (!this.ports.saveNote)
            throw new Error("Global assistant notes are unavailable on this Host.");
          const backup = await this.repository.get<RecordValue & { note: AssistantNote }>(
            "notetrash",
            id,
            true,
          );
          if (!backup) throw new Error("Note recovery copy is unavailable.");
          const existing = ((await this.ports.listNotes?.()) ?? []).find(
            (note) => note.id === backup.note.id,
          );
          if (existing)
            throw new Error(
              "A note with this identity already exists; inspect it before restoring.",
            );
          await this.ports.saveNote({
            id: backup.note.id,
            title: backup.note.title,
            body: backup.note.body,
            expectedUpdatedAt: 0,
          });
          await this.store.transaction(async () => {
            await this.store.db.prepare("DELETE FROM assistant_notetrash WHERE id=?").run(id);
            await this.setRuntime(`notebookSuppressed:${backup.note.title}`, false);
          }, "critical");
          return { ok: true };
        }
        if (table === "jobs" && input.op === "trash.restore" && this.ports.jobDeletion) {
          const job = await this.repository.get<AssistantJob>("jobs", id, true);
          if (
            job &&
            (await this.ports.jobDeletion.restore(job, this.now(), async () => {
              const value = {
                ...job,
                status: "paused",
                pendingTaskDeletion: false,
                awaitingOwnerRestart: true,
                summary:
                  "Job and tasks restored quiescent. Review the task board before explicitly restarting work.",
                version: job.version + 1,
                updatedAt: this.now(),
              };
              const restored = await this.store.db
                .prepare(
                  "UPDATE assistant_jobs SET value=?,version=?,updated_at=?,deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL AND version=?",
                )
                .run(JSON.stringify(value), value.version, value.updatedAt, id, job.version);
              if (Number(restored.changes) !== 1)
                throw new Error("The deleted job changed before restore; nothing was restored.");
            }))
          )
            return { ok: true };
        }
        await this.store.transaction(async () => {
          if (input.op === "trash.restore")
            await this.store.db
              .prepare(`UPDATE assistant_${table} SET deleted_at=NULL WHERE id=?`)
              .run(id);
          else {
            if (table === "jobs") await this.ports.jobDeletion?.purge(id);
            await this.repository.purge(table, id);
          }
        }, "critical");
        return { ok: true };
      }
      case "pauseAll": {
        this.owner(principal);
        await this.store.transaction(() => this.setRuntime("paused", true), "critical");
        const errors: string[] = [];
        for (const job of await this.repository.list<AssistantJob>("jobs", 10000))
          if (!terminal.has(job.status))
            try {
              await this.controlJob(job.id, job.version, "stop");
            } catch (error) {
              errors.push(String(error));
            }
        if (errors.length)
          throw new Error(
            `Supervisor paused; ${errors.length} jobs could not be stopped. ${errors[0]}`,
          );
        return { ok: true };
      }
      case "resumeAll":
        this.owner(principal);
        await this.store.transaction(async () => {
          await this.setRuntime("paused", false);
          if (
            (await this.runtime<ChiefIntent | null>("chiefPendingIntent", null))?.status ===
            "unknown"
          ) {
            await this.setRuntime("chiefPendingIntent", null);
            await this.activity(
              "chief.reviewResumed",
              "The owner requested a new review after an uncertain reasoning result.",
            );
          }
        }, "critical");
        this.emergencyStop = false;
        this.ports.onResume?.();
        await this.tickInner(this.later); // The Chief's model turn may outlast this RPC.
        return { ok: true };
      case "chief.retry": {
        this.owner(principal);
        const intent = await this.runtime<ChiefIntent | null>("chiefPendingIntent", null);
        if (intent && !["unknown", "capacity"].includes(intent.status))
          throw new Error(
            "An existing supervisor action must be inspected; it cannot be replayed by retrying a review.",
          );
        await this.store.transaction(async () => {
          await this.setRuntime("chiefPendingIntent", null);
          await this.setRuntime("chiefRetry", { after: 0, attempts: 0 });
          await this.activity(
            "chief.reviewResumed",
            "The owner requested a fresh model review of pending events.",
          );
        }, "critical");
        await this.tickInner(this.later); // The Chief's model turn may outlast this RPC.
        return { ok: true };
      }
      case "tick":
        this.owner(principal);
        await this.tickInner();
        return { ok: true };
    }
  }
  private async require<T>(table: AssistantTable, id: string): Promise<T> {
    const row = await this.repository.get<T>(table, id);
    if (!row) throw new Error("Assistant record was not found.");
    return row;
  }
  private async reason<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.emergencyStop || this.closing || (await this.runtime("paused", false)))
      throw new Error("The supervisor is paused.");
    if (this.emergencyStop || this.closing) throw new Error("The supervisor is paused.");
    return this.queue.turn(async (signal) => {
      const result = await run(signal);
      if (this.emergencyStop || this.closing) throw new Error("Assistant reasoning was stopped.");
      return result;
    });
  }
  private async assertProject(id: string) {
    if (!this.ports.listProjects) throw new Error("Project discovery is unavailable.");
    if (!(await this.ports.listProjects()).some((project) => project.id === id))
      throw new Error("Project is not available on this Host.");
  }
  private async assertNote(id: string) {
    const note = this.ports.getNote
      ? await this.ports.getNote(id)
      : ((await this.ports.listNotes?.()) ?? []).find(
          (note) => note.id === id && note.tags.includes("assistant"),
        );
    if (!note) throw new Error("This note is outside the assistant's notebook.");
    return note;
  }
  private trashIdentity(
    value: string,
  ): ["jobs" | "memory" | "activity" | "messages" | "notetrash", string] {
    const colon = value.indexOf(":");
    const table = value.slice(0, colon);
    const id = value.slice(colon + 1);
    if (!["jobs", "memory", "activity", "messages", "notetrash"].includes(table) || !id)
      throw new Error("Invalid deleted item identity.");
    return [table as "jobs" | "memory" | "activity" | "messages" | "notetrash", id];
  }
  private async controlJob(
    id: string,
    expectedVersion: number,
    action: "pause" | "resume" | "stop" | "delete",
    deleteTasks = false,
    taskDeleteToken?: string,
  ): Promise<AssistantJob> {
    const job = await this.require<AssistantJob>("jobs", id);
    if (job.version !== expectedVersion) throw new Error("Job changed; reload before changing it.");
    if (action === "delete" && deleteTasks) {
      if (!this.ports.jobDeletion || !taskDeleteToken)
        throw new Error("Review the exact canonical task deletion scope first.");
      try {
        return await this.ports.jobDeletion.delete(
          job,
          taskDeleteToken,
          this.now(),
          async (scope) => {
            const next = await this.repository.put<AssistantJob>(
              "jobs",
              {
                ...job,
                ...scope,
                pendingTaskDeletion: false,
                status: "cancelled",
                updatedAt: this.now(),
              },
              job.version,
            );
            await this.repository.trash("jobs", id, next.version, this.now());
            await this.activity(
              "job.deletedWithTasks",
              "The reviewed job and task metadata were deleted. Sessions, branches and working files were retained.",
              { jobId: id },
            );
            return next;
          },
        );
      } catch (error) {
        if (await this.store.db.runRecoveryBookkeeping(() => this.ports.jobDeletion!.pending(id)))
          await this.store.db.runRecoveryBookkeeping(() =>
            this.store.transaction(async () => {
              const current = await this.repository.get<AssistantJob>("jobs", id);
              if (current?.version === job.version) {
                await this.repository.put<AssistantJob>(
                  "jobs",
                  {
                    ...current,
                    status: "waiting",
                    pendingTaskDeletion: true,
                    summary: `Job and tasks were kept for owner inspection. ${String(error).slice(0, 1000)}`,
                    updatedAt: this.now(),
                  },
                  current.version,
                );
                await this.activity(
                  "job.deleteAttention",
                  "Task deletion needs owner inspection; its exact original Stop will not be repeated.",
                  { jobId: id },
                );
              }
            }, "critical"),
          );
        throw error;
      }
    }
    if (await this.ports.jobDeletion?.pending(id))
      throw new Error(
        "Resolve the pending task deletion by retrying its reviewed scope or choosing Keep job and tasks; no Stop will be replayed.",
      );
    if (action === "resume" && job.awaitingOwnerRestart)
      throw new Error(
        "Review and explicitly restart the restored tasks from the task board; restoring never starts work.",
      );
    if (action === "resume" && terminal.has(job.status))
      throw new Error("A finished or cancelled job cannot restart; submit a new job.");
    if (job.goalId && !terminal.has(job.status)) {
      if (!this.ports.controlGoal)
        throw new Error("Goal control is unavailable; this job has not been stopped.");
      await this.ports.controlGoal(job.goalId, action === "delete" ? "stop" : action, job);
    }
    return this.store.transaction(async () => {
      const status: AssistantJobStatus =
        action === "pause"
          ? "paused"
          : action === "resume"
            ? job.goalId
              ? "running"
              : "queued"
            : "cancelled";
      const receipt =
        job.kind === "quick"
          ? job.projectId === null
            ? await this.quickJobs?.receipt(job.id)
            : await this.quickAutomations?.receipt(job.id)
          : undefined;
      const completed =
        job.kind === "quick" &&
        receipt?.state === "completed" &&
        receipt.fingerprint === assistantQuickFingerprint(job);
      const value: AssistantJob =
        job.kind !== "quick"
          ? { ...job, status, updatedAt: this.now() }
          : job.projectId === null
            ? {
                ...job,
                ...(completed && "noteId" in receipt
                  ? { quickResult: { noteId: receipt.noteId } }
                  : {}),
                status,
                updatedAt: this.now(),
              }
            : {
                ...job,
                ...(completed && "automationId" in receipt
                  ? { quickResult: { automationId: receipt.automationId } }
                  : {}),
                status,
                updatedAt: this.now(),
              };
      const next = await this.repository.put<AssistantJob>("jobs", value, expectedVersion);
      await this.activity(`job.${action}`, `Job ${action} acknowledged.`, { jobId: job.id });
      if (action === "delete") await this.repository.trash("jobs", id, next.version, this.now());
      return next;
    }, "critical");
  }
  private async usage(profile: AssistantProfile, includeCache = false): Promise<AssistantUsage> {
    const day = utcDay(this.now());
    const old = await this.runtime<AssistantUsage>(`usage:${day}`, {
      day,
      chiefTokens: 0,
      workerTokens: 0,
      total: 0,
      mode: "run",
      estimated: false,
    });
    if (!includeCache)
      return { ...old, mode: tokenBudgetMode(old.total, profile.dailyTokenBudget) };
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'workerTurn:%' AND json_extract(value,'$.value.day')=?",
      )
      .all(day);
    const turns = rows.map(
      (row) =>
        (JSON.parse(row.value) as Runtime).value as {
          settled: boolean;
          cacheMetrics?: AssistantCacheMeasurement;
          cacheTimeKnown?: boolean;
        },
    );
    const cacheUsage = assistantCacheUsage(turns, old.workerUsageIncomplete === true);
    return {
      ...old,
      mode: tokenBudgetMode(old.total, profile.dailyTokenBudget),
      ...(cacheUsage ? { cacheUsage } : {}),
    };
  }
  private async settleChiefUsage(
    day: string,
    reserved: number,
    charged: number,
    estimated: boolean,
  ) {
    const current = await this.runtime<AssistantUsage>(`usage:${day}`, {
      day,
      chiefTokens: reserved,
      workerTokens: 0,
      total: reserved,
      mode: "run",
      estimated: true,
    });
    await this.setRuntime(`usage:${day}`, {
      ...current,
      chiefTokens: Math.max(0, current.chiefTokens - reserved + charged),
      total: Math.max(0, current.total - reserved + charged),
      estimated: current.estimated || estimated,
    });
  }
  private async summaryAdmission() {
    const profile = await this.profile();
    if (
      this.closing ||
      this.emergencyStop ||
      !this.ports.summarize ||
      !profile.enabled ||
      !profile.setupComplete ||
      !assistantRoleExecution(profile, "reply") ||
      !assistantActiveHours(profile, this.now()) ||
      (await this.runtime("paused", false))
    )
      return null;
    const usage = await this.usage(profile),
      tokenCap = Math.min(
        profile.perWakeTokenCap,
        Math.max(0, Math.floor(profile.dailyTokenBudget * 0.8 - usage.total)),
      );
    if (usage.mode !== "run" || tokenCap < 1000) return null;
    return {
      profile,
      day: usage.day,
      tokenCap,
      capacityKey: JSON.stringify([
        assistantRoleExecution(profile, "reply"),
        profile.perWakeTokenCap,
        profile.dailyTokenBudget,
        usage.day,
        tokenCap,
      ]),
    };
  }
  private async reserveSummary(
    id: string,
    admission: { day: string; tokenCap: number; capacityKey: string },
  ) {
    if (await this.runtime(`summaryReservation:${id}`, null))
      throw new Error("This summary already has a reservation.");
    const current = await this.summaryAdmission();
    if (
      !current ||
      current.day !== admission.day ||
      current.tokenCap < admission.tokenCap ||
      current.capacityKey !== admission.capacityKey
    )
      throw new AssistantTextPreflightError();
    const usage = await this.usage(current.profile);
    await this.setRuntime(`usage:${usage.day}`, {
      ...usage,
      chiefTokens: usage.chiefTokens + admission.tokenCap,
      total: usage.total + admission.tokenCap,
      estimated: true,
    });
    await this.setRuntime(`summaryReservation:${id}`, {
      day: admission.day,
      tokens: admission.tokenCap,
      settled: false,
    });
  }
  private async settleSummary(
    id: string,
    day: string,
    reserved: number,
    tokens: number,
    estimated: boolean,
  ) {
    const receipt = await this.runtime<{ day: string; tokens: number; settled: boolean } | null>(
      `summaryReservation:${id}`,
      null,
    );
    if (!receipt || receipt.settled) return;
    if (receipt.day !== day || receipt.tokens !== reserved)
      throw new Error("Summary reservation identity changed.");
    await this.settleChiefUsage(day, reserved, tokens, estimated);
    await this.setRuntime(`summaryReservation:${id}`, {
      ...receipt,
      settled: true,
      charged: tokens,
      estimated,
    });
  }
  private usageDefault(day: string): AssistantUsage {
    return { day, chiefTokens: 0, workerTokens: 0, total: 0, mode: "run", estimated: false };
  }
  private async adjustWorkerUsage(day: string, observedDelta: number, reservedDelta: number) {
    const current = await this.runtime<AssistantUsage>(`usage:${day}`, this.usageDefault(day));
    const observed = Math.max(
      0,
      (current.observedWorkerTokens ?? current.workerTokens - (current.reservedWorkerTokens ?? 0)) +
        observedDelta,
    );
    const reserved = Math.max(0, (current.reservedWorkerTokens ?? 0) + reservedDelta);
    await this.setRuntime(`usage:${day}`, {
      ...current,
      workerTokens: observed + reserved,
      observedWorkerTokens: observed,
      reservedWorkerTokens: reserved,
      total: current.chiefTokens + observed + reserved,
      estimated: current.estimated || reserved > 0,
    });
  }
  /** Deduplicate actual turn readings by immutable session/block identity.
   * Only a proven send author can retire that send's reservation. Uncorrelated
   * maintenance estimates remain visibly reserved rather than invented actuals. */
  private async reconcileWorkerTurns(
    scope: { jobId?: string; supervisionId?: string },
    turns: AssistantUsageTurn[],
  ) {
    for (const turn of turns) {
      if (
        !turn.key ||
        turn.key.length > 1000 ||
        !Number.isSafeInteger(turn.tokens) ||
        turn.tokens < 0
      )
        throw new Error("Invalid worker token observation.");
      if (turn.settled && scope.jobId) {
        const answers = await this.store.db
          .prepare(
            "SELECT id,value FROM assistant_runtime WHERE id LIKE 'reservation:%' AND json_extract(value,'$.value.phase')='answer' AND json_extract(value,'$.value.jobId')=?",
          )
          .all(scope.jobId);
        for (const row of answers) {
          const reservation = (JSON.parse(row.value) as Runtime).value as WorkerReservation,
            source = reservation.answerSource;
          if (
            !source ||
            !reservation.answeredBlockId ||
            !reservation.remaining ||
            `${source.sessionId}:${source.turnBlockId}` !== turn.key
          )
            continue;
          const record = await this.store.session(source.sessionId),
            block = record.session.blocks.find((block) => block.id === reservation.answeredBlockId);
          if (
            block?.author?.kind !== "assistant" ||
            block.author.jobId !== scope.jobId ||
            block.author.reason !== "answer" ||
            block.author.operationId !== reservation.operationId ||
            block.continuationOf !== source.turnBlockId ||
            !block.questionAnswers?.length
          )
            continue;
          await this.adjustWorkerUsage(reservation.day, 0, -reservation.remaining);
          await this.setRuntime(String(row.id), { ...reservation, remaining: 0 });
        }
      }
      const key = `workerTurn:${turn.key}`;
      const previous = await this.runtime<{
        tokens: number;
        day: string;
        settled: boolean;
        cacheMetrics?: AssistantCacheMeasurement;
        cacheTimeKnown?: boolean;
      } | null>(key, null);
      const timestamp = turn.at === undefined ? this.now() : turn.at;
      const day = previous?.day ?? utcDay(timestamp);
      const observed = Math.max(previous?.tokens ?? 0, turn.tokens);
      const delta = observed - (previous?.tokens ?? 0);
      const cacheMetrics = assistantCacheMeasurement(turn.cacheMetrics) ?? previous?.cacheMetrics;
      const cacheTimeKnown =
        previous?.cacheTimeKnown === true ||
        (turn.at !== undefined &&
          Number.isSafeInteger(turn.at) &&
          turn.at >= 0 &&
          turn.at <= this.now() &&
          utcDay(turn.at) === day);
      if (
        previous &&
        delta === 0 &&
        previous.settled === turn.settled &&
        JSON.stringify(previous.cacheMetrics) === JSON.stringify(cacheMetrics) &&
        previous.cacheTimeKnown === cacheTimeKnown
      )
        continue;
      if (delta) await this.adjustWorkerUsage(day, delta, 0);
      let uncovered = delta;
      if (turn.operationId) {
        const reservations = await this.store.db
          .prepare(
            "SELECT id,value FROM assistant_runtime WHERE id LIKE 'reservation:%' AND json_extract(value,'$.value.operationId')=?",
          )
          .all(turn.operationId);
        for (const row of reservations) {
          const reservation = (JSON.parse(row.value) as Runtime).value as WorkerReservation;
          if (
            !reservation.phase ||
            reservation.phase === "answer" ||
            !reservation.remaining ||
            (scope.supervisionId
              ? reservation.supervisionId !== scope.supervisionId
              : !!reservation.supervisionId ||
                (!!reservation.jobId && reservation.jobId !== scope.jobId))
          )
            continue;
          if (reservation.phase === "compact" && !turn.operationId.endsWith(":compact")) continue;
          const released = turn.settled
            ? reservation.remaining
            : Math.min(uncovered, reservation.remaining);
          if (!released) continue;
          await this.adjustWorkerUsage(reservation.day, 0, -released);
          uncovered = Math.max(0, uncovered - released);
          await this.setRuntime(String(row.id), {
            ...reservation,
            remaining: reservation.remaining - released,
          });
        }
      }
      await this.setRuntime(key, {
        tokens: observed,
        day,
        settled: turn.settled,
        ...scope,
        cacheTimeKnown,
        ...(cacheMetrics ? { cacheMetrics } : {}),
      });
    }
  }
  private async manualTick(
    profile: AssistantProfile,
  ): Promise<{ digest: Record<string, unknown>[]; incomplete: boolean }> {
    if (!this.ports.manual) return { digest: [], incomplete: false };
    const digest: Record<string, unknown>[] = [],
      policy = await this.manualPolicy();
    let incomplete = false;
    for (const grant of await this.ports.manual.listAllForUsage()) {
      if (this.closing || this.emergencyStop) break;
      try {
        if (this.ports.manualUsage) {
          const usage = await this.ports.manualUsage(grant);
          incomplete ||= usage.incomplete;
          await this.store.transaction(
            () => this.reconcileWorkerTurns({ supervisionId: grant.id }, usage.turns),
            "critical",
          );
        }
      } catch {
        incomplete = true;
      }
      if (!grant.active || !policy.enabled || !policy.projectIds.includes(grant.source.projectId))
        continue;
      try {
        const { session: record } = await this.ports.manual.resolveStatus(
            grant.id,
            grant.sessionId,
            grant.version,
          ),
          session = record.session;
        const action = workerContextAction(session.context?.used, session.context?.window, profile),
          pendingApproval = session.blocks.some(
            (block) => !!block.approval && !block.approval.decided,
          ),
          pendingQuestion = !!session.pendingQuestion;
        const activity =
          record.runActivity?.runId === record.runId
            ? record.runActivity?.lastActivityAt
            : undefined;
        const knownActivity =
          activity !== undefined &&
          Number.isSafeInteger(activity) &&
          activity >= 0 &&
          activity <= this.now();
        const attention =
          pendingApproval || pendingQuestion
            ? "owner-input"
            : record.status === "running" &&
                knownActivity &&
                this.now() - activity >= profile.stallMinutes * 60000
              ? "stalled"
              : "current";
        const state = { state: record.status, attention, contextAction: action };
        const key = `manualState:${grant.id}`,
          old = await this.runtime<string | null>(key, null),
          signature = JSON.stringify(state);
        if (old !== signature)
          await this.store.transaction(async () => {
            await this.setRuntime(key, signature);
            if (old !== null)
              await this.activity(
                "manual.status",
                "An enrolled manual conversation changed supervision state.",
                { supervisionId: grant.id, sessionId: grant.sessionId },
              );
          }, "critical");
        digest.push({
          supervisionId: grant.id,
          grantVersion: grant.version,
          sessionId: grant.sessionId,
          projectId: grant.source.projectId,
          title: session.title.slice(0, 80),
          ...state,
          pendingApproval,
          pendingQuestion,
          contextTokens: session.context?.used,
          contextWindow: session.context?.window,
          lastAssistantMessage:
            session.blocks
              .filter((block) => block.role === "assistant")
              .at(-1)
              ?.text.slice(0, 200) ?? "",
        });
      } catch {
        /* Source/policy/role drift removes this target from Chief admission. */
      }
    }
    return { digest: digest.slice(0, 100), incomplete };
  }
  private async syncBudgetHolds(profile: AssistantProfile) {
    const usage = await this.usage(profile),
      hold = usage.mode === "paused";
    if (hold)
      await this.store.transaction(
        () =>
          this.queueNotification({
            id: `budget-${usage.day}`,
            kind: "budget.exhausted",
            title: "Assistant budget reached",
            body: "New assistant work is held until token capacity becomes available. Existing owner pauses remain in place.",
            createdAt: this.now(),
          }),
        "critical",
      );
    if (this.ports.setGoalBudgetHeld)
      for (const job of await this.repository.list<AssistantJob>("jobs", 10000))
        if (job.kind !== "quick" && job.goalId)
          await this.ports.setGoalBudgetHeld(job.goalId, hold && !terminal.has(job.status));
  }
  private async syncHoursHolds(profile: AssistantProfile): Promise<void> {
    const closed =
      !profile.enabled || !profile.setupComplete || !assistantActiveHours(profile, this.now());
    if (this.ports.setGoalHoursHeld)
      for (const job of await this.repository.list<AssistantJob>("jobs", 10000))
        if (job.kind !== "quick" && job.goalId)
          await this.ports.setGoalHoursHeld(job.goalId, closed && !terminal.has(job.status));
    if (closed) {
      this.queue.abortTurns();
      this.ports.onPause?.();
    } else if (await this.supervisionAllowed()) this.ports.onResume?.();
  }
  private recordJobProblem(jobId: string, summary: string) {
    return this.store.transaction(
      () =>
        jobLog.recordJobProblemActivity(
          {
            runtime: (id, fallback) => this.runtime(id, fallback),
            setRuntime: (id, value) => this.setRuntime(id, value),
            activity: (kind, text, extra) => this.activity(kind, text, extra),
          },
          jobId,
          summary,
        ),
      "critical",
    );
  }
  private async holdJobScope(job: AssistantJob, error: unknown) {
    const summary = `Goal source needs owner attention: ${String(error).slice(0, 1000)}`;
    if (job.status === "waiting" && job.summary === summary) return;
    await this.store.transaction(async () => {
      await this.repository.put(
        "jobs",
        { ...job, status: "waiting", summary, updatedAt: this.now() },
        job.version,
      );
      await this.activity("job.scopeBlocked", summary, { jobId: job.id });
    }, "critical");
  }
  private async enqueueChiefEvent(event: AssistantActivity): Promise<void> {
    await this.store.transaction(async () => {
      // Activity history is always retained. Only the saved Chief mode admits
      // new supervisor work; report/jobs history is not a future catch-up queue.
      if ((await this.profile()).autonomy === "chief")
        await this.setRuntime(`chiefEvent:${event.id}`, { event });
    }, "critical");
  }
  private async pendingChiefEvents(): Promise<AssistantActivity[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'chiefEvent:%' AND deleted_at IS NULL ORDER BY updated_at,id LIMIT 20",
      )
      .all();
    return rows
      .map((row) => (JSON.parse(row.value) as Runtime).value as { event: AssistantActivity })
      .map((value) => value.event);
  }
  private async runChief(profile: AssistantProfile, manualDigest: Record<string, unknown>[] = []) {
    if (this.chiefTurn || !this.ports.chiefWake || profile.autonomy !== "chief") return;
    if (!(await this.supervisionAllowed())) return;
    let intent = await this.runtime<ChiefIntent | null>("chiefPendingIntent", null);
    const capacityKey = JSON.stringify([
      profile.perWakeTokenCap,
      profile.chiefSoftContext,
      profile.chiefHardContext,
      profile.dailyTokenBudget,
      profile.chiefExecution ?? profile.execution,
    ]);
    if (intent?.status === "capacity") {
      if (intent.capacityKey === capacityKey) return;
      await this.store.transaction(() => this.setRuntime("chiefPendingIntent", null), "critical");
      intent = null;
    }
    if (intent?.status === "unknown") return;
    const retry = await this.runtime<{ after: number; attempts: number }>("chiefRetry", {
      after: 0,
      attempts: 0,
    });
    if (retry.after > this.now()) return;
    let events: AssistantActivity[] = [];
    if (intent?.status !== "response") {
      events =
        intent?.input?.events ??
        (await this.pendingChiefEvents()).map((event) => ({
          ...event,
          summary: event.summary.slice(0, 200),
        }));
      if (!events.length) return;
      if (!intent) {
        const usage = await this.usage(profile),
          hour = Math.floor(this.now() / 3600000);
        const wakes = await this.runtime<number>(`wakes:${hour}`, 0);
        const tokenCap = Math.min(
          profile.perWakeTokenCap,
          Math.max(0, Math.floor(profile.dailyTokenBudget * 0.8 - usage.total)),
        );
        if (wakes >= assistantPolicy(profile).chiefWakeLimit || tokenCap < 1000) return;
        intent = {
          operationId: newRequestId(),
          day: usage.day,
          tokenCap,
          eventIds: events.map((event) => event.id),
          status: "running",
        };
        const ownerInstructions = await this.instructions("all");
        const currentJobs = (await this.repository.list<AssistantJob>("jobs", 10000))
            .filter((job) => job.kind !== "quick" && !terminal.has(job.status))
            .slice(0, 100),
          questions: Array<AssistantQuestionStatus & { jobId: string }> = [];
        for (const job of currentJobs)
          for (const question of await this.runtime<AssistantQuestionStatus[]>(
            `questions:${job.id}`,
            [],
          ))
            questions.push({ ...question, jobId: job.id });
        const decisionScopes = new Map<string, unknown>();
        for (const job of currentJobs) {
          try {
            decisionScopes.set(job.id, await this.ownerQuestions.source(job.id));
          } catch {
            /* A missing/replaced canonical source grants no question authority. */
          }
        }
        const listedDecisions = await this.ownerQuestions.list(),
          eventDecisionIds = [
            ...new Set(
              events.flatMap((event) => (event.ownerQuestionId ? [event.ownerQuestionId] : [])),
            ),
          ],
          decisionInputs = new Map(listedDecisions.map((question) => [question.id, question]));
        for (const id of eventDecisionIds) {
          const { ownerQuestion } = await this.ownerQuestions.get(id);
          if (ownerQuestion) decisionInputs.set(id, ownerQuestion);
        }
        const ownerDecisionRefs = [...decisionInputs.values()].map(
          ({ id, version, jobId, status, sourceCurrent }) => ({
            id,
            version,
            jobId,
            status,
            sourceCurrent,
          }),
        );
        const ownerDecisions = [...decisionInputs.values()]
          .sort(
            (a, b) =>
              Number(eventDecisionIds.includes(b.id)) - Number(eventDecisionIds.includes(a.id)) ||
              b.updatedAt - a.updatedAt,
          )
          .slice(0, 20)
          .map((question) => ({
            id: question.id,
            version: question.version,
            jobId: question.jobId,
            projectIds: question.projectIds,
            origin: question.origin,
            status: question.status,
            sourceCurrent: question.sourceCurrent,
            title: question.prompt.title?.slice(0, 80),
            questions: question.prompt.questions.map((item) => ({
              id: item.id,
              prompt: item.prompt.slice(0, 120),
              selected: question.answer?.answers[item.id] ?? [],
              selectedLabels: item.options
                .filter((option) => question.answer?.answers[item.id]?.includes(option.id))
                .map((option) => option.label.slice(0, 80)),
              custom: question.answer?.custom?.[item.id]?.slice(0, 240),
              customTruncated: (question.answer?.custom?.[item.id]?.length ?? 0) > 240,
            })),
            answerRequestId: question.answer?.requestId,
          }));
        const workerReads = await this.ports.chiefReadSnapshot?.(profile, () =>
          this.supervisionAllowed(),
        );
        if (!(await this.supervisionAllowed())) return;
        const stateCard = JSON.stringify({
          ownerInstructions: ownerInstructions.slice(0, 12000),
          ownerInstructionsTruncated: ownerInstructions.length > 12000,
          ownerDecisions,
          ownerDecisionRefs,
          jobs: currentJobs.map((job) => ({
            id: job.id,
            version: job.version,
            ...(decisionScopes.has(job.id) ? { questionScope: decisionScopes.get(job.id) } : {}),
            projectId: job.projectId,
            projectIds: assistantJobProjectIds(job),
            sessionIds: job.sessionIds,
            title: job.title.slice(0, 80),
            status: job.status,
            progress: job.progress,
            summary: job.summary.slice(0, 200),
          })),
          nudgeLimit: assistantPolicy(profile).nudgeLimit,
          routineQuestionsAllowed: profile.allowRoutineQuestions === true,
          workerQuestions: questions
            .filter((question) => !question.questionOwnerRequired)
            .slice(0, 5),
          pendingWorkerQuestionCount: questions.length,
          pendingWorkerQuestionRefs: questions
            .slice(0, 20)
            .map(
              ({
                jobId,
                sessionId,
                questionToken,
                questionOwnerRequired,
                questionOwnerReason,
              }) => ({
                jobId,
                sessionId,
                questionToken,
                questionOwnerRequired,
                questionOwnerReason,
              }),
            ),
          manualSessions: manualDigest,
          ...(workerReads ? { workerReads } : {}),
        });
        intent.input = {
          profile,
          stateCard,
          events,
          tokenCap,
          operationId: intent.operationId,
          contextPolicy: { soft: profile.chiefSoftContext, hard: profile.chiefHardContext },
        };
        await this.store.transaction(async () => {
          await this.setRuntime("chiefReviewWindow", Math.floor(this.now() / 1800000));
          await this.setRuntime(`wakes:${hour}`, wakes + 1);
          const current = await this.usage(profile);
          await this.setRuntime(`usage:${usage.day}`, {
            ...current,
            chiefTokens: current.chiefTokens + tokenCap,
            total: current.total + tokenCap,
            estimated: true,
          });
          await this.setRuntime("chiefPendingIntent", intent);
          await this.setRuntime("chiefIntent", intent);
        }, "critical");
      }
      try {
        if (!intent?.input)
          throw Object.assign(new Error("Interrupted legacy reasoning has no retained input."), {
            code: "ASSISTANT_CHIEF_CONTEXT_UNKNOWN",
          });
        const tokenCap = intent.tokenCap;
        // The provider call runs with the request queue open (minutes at most);
        // its durable "running" intent and chiefTurn fence any second wake.
        this.chiefTurn = true;
        const result = await this.queue
          .released(() =>
            this.reason((signal) => this.ports.chiefWake!({ ...intent!.input!, signal })),
          )
          .finally(() => (this.chiefTurn = false));
        const actions = (result.actions ?? [])
          .slice(0, 10)
          .map((candidate) => AssistantRequestValidationSchema.parse(candidate));
        const reads = parseChiefReadRequests(result.reads ?? []);
        if (reads.length && actions.length)
          throw new Error("Chief reads and mutations require separate wakes.");
        if (
          actions.some(
            (action) =>
              ![
                "jobs.replan",
                "memory.save",
                "sessions.nudge",
                "sessions.answer",
                "manual.nudge",
                "questions.ask",
              ].includes(action.op),
          )
        )
          throw new Error("The supervisor proposed an action outside its narrow grant.");
        const tokens =
          result.tokens !== undefined && Number.isFinite(result.tokens)
            ? Math.max(0, Math.ceil(result.tokens))
            : tokenCap;
        intent = {
          ...intent,
          status: "response",
          actions,
          reads,
          tokens,
          estimated: result.tokens === undefined,
        };
        await this.store.transaction(async () => {
          await this.settleChiefUsage(intent!.day, tokenCap, tokens, result.tokens === undefined);
          await this.setRuntime("chiefPendingIntent", intent);
          await this.setRuntime("chiefRetry", { after: 0, attempts: 0 });
        }, "critical");
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ASSISTANT_CHIEF_CONTEXT_TOO_LARGE"
        ) {
          await this.store.transaction(async () => {
            await this.settleChiefUsage(intent!.day, intent!.tokenCap, 0, false);
            await this.setRuntime("chiefPendingIntent", {
              ...intent,
              status: "capacity",
              capacityKey,
              tokens: 0,
              estimated: false,
            });
            await this.setRuntime("chiefRetry", { after: 0, attempts: 0 });
            await this.activity(
              "chief.contextTooLarge",
              "The supervisor review exceeds its current context reservation. No provider call was made and the reservation was refunded. Increase review capacity or retry review after inspecting pending events.",
            );
          }, "critical");
          this.ports.onError?.(error);
          return;
        }
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          ["ASSISTANT_CHIEF_CONTEXT_UNKNOWN", "ASSISTANT_CHIEF_CONTEXT_CONFLICT"].includes(
            String(error.code),
          )
        ) {
          await this.store.transaction(async () => {
            await this.setRuntime("chiefPendingIntent", { ...intent, status: "unknown" });
            await this.activity(
              "chief.contextUnknown",
              "A supervisor reasoning result is uncertain. No new Host actions were issued. Inspect History, then Resume to request a new review.",
            );
          }, "critical");
          this.ports.onError?.(error);
          return;
        }
        // The utility model has no Host actions. Its uncertain token reservation
        // stays charged; the durable events can be reconsidered after backoff.
        await this.store.transaction(async () => {
          await this.setRuntime("chiefPendingIntent", null);
          await this.setRuntime("chiefRetry", {
            after: this.now() + Math.min(1800000, 60000 * 2 ** Math.min(retry.attempts, 5)),
            attempts: retry.attempts + 1,
          });
        }, "critical");
        this.ports.onError?.(error);
        return;
      }
    }
    if (!intent) return;
    if (intent.reads?.length) {
      if (!this.ports.chiefRead) {
        this.ports.onError?.(new Error("Finite Chief reads are unavailable."));
        return;
      }
      if (!(await this.supervisionAllowed())) return;
      try {
        await this.ports.chiefRead(
          { operationId: intent.operationId, requests: intent.reads },
          () => this.supervisionAllowed(),
        );
        if (!(await this.supervisionAllowed())) return;
        await this.store.transaction(async () => {
          for (const id of intent!.eventIds)
            await this.store.db
              .prepare("DELETE FROM assistant_runtime WHERE id=?")
              .run(`chiefEvent:${id}`);
          await this.setRuntime("chiefPendingIntent", null);
          await this.setRuntime("chiefIntent", { ...intent, status: "settled" });
          const event = await this.activity(
            "chief.readsReady",
            "Requested scoped context is ready for the next supervisor review.",
          );
          await this.enqueueChiefEvent(event);
        }, "critical");
      } catch (error) {
        this.ports.onError?.(error);
      }
      return;
    }
    for (const [index, action] of (intent.actions ?? []).entries()) {
      if (this.emergencyStop || this.closing) return;
      const receiptKey = `chiefAction:${intent.operationId}:${index}`;
      const state = await this.runtime<string | null>(receiptKey, null);
      if (state === "settled") continue;
      if (state === "unknown") {
        await this.store.transaction(async () => {
          await this.activity(
            "chief.actionUnknown",
            "A supervisor action has an uncertain outcome. Inspect the linked job before issuing another instruction.",
          );
          for (const id of intent!.eventIds)
            await this.store.db
              .prepare("DELETE FROM assistant_runtime WHERE id=?")
              .run(`chiefEvent:${id}`);
          await this.setRuntime("chiefPendingIntent", null);
        }, "critical");
        return;
      }
      await this.store.transaction(() => this.setRuntime(receiptKey, "unknown"), "critical");
      try {
        await this.dispatch(action, "chief");
        await this.store.transaction(() => this.setRuntime(receiptKey, "settled"), "critical");
      } catch (error) {
        this.ports.onError?.(error);
        return;
      }
    }
    await this.store.transaction(async () => {
      for (const id of intent!.eventIds)
        await this.store.db
          .prepare("DELETE FROM assistant_runtime WHERE id=?")
          .run(`chiefEvent:${id}`);
      await this.setRuntime("chiefPendingIntent", null);
      await this.setRuntime("chiefIntent", { ...intent, status: "settled" });
      await this.activity("chief.woke", "The supervisor reviewed new job events.", {
        tokens: intent!.tokens ?? intent!.tokenCap,
      });
    }, "critical");
  }
  private async syncKeepAwake() {
    if (!this.ports.keepAwake) return;
    const profile = await this.profile();
    const jobs = await this.repository.list<AssistantJob>("jobs", 10000);
    const eligible =
      !this.closing &&
      !this.emergencyStop &&
      profile.enabled &&
      profile.setupComplete &&
      profile.keepAwakeWhileWorking &&
      !(await this.runtime("paused", false));
    let running = false;
    if (eligible) {
      try {
        running = this.ports.hasRunningChildren
          ? await this.ports.hasRunningChildren(
              jobs.flatMap((job) => (job.goalId ? [job.goalId] : [])),
            )
          : jobs.some(
              (job) =>
                job.kind !== "quick" && ["planning", "running", "stalled"].includes(job.status),
            );
        if (!running) running = await this.hasRunningManualTurn();
      } catch (error) {
        this.keepAwakeStatus = {
          ...(this.keepAwakeStatus ?? { supported: false, requested: false, active: false }),
          error:
            error instanceof Error
              ? error.message
              : "Running work could not be verified; the previous keep-awake request is retained.",
        };
        return;
      }
    }
    const requested = eligible && running;
    try {
      this.keepAwakeStatus = await this.ports.keepAwake(requested);
    } catch (error) {
      this.keepAwakeStatus = {
        supported: false,
        requested,
        active: false,
        error: error instanceof Error ? error.message : "Keep-awake is unavailable.",
      };
    }
  }
  private async hasRunningManualTurn(): Promise<boolean> {
    if (!this.ports.manual) return false;
    // Revocation prevents future writes, but does not stop an already running
    // assistant-authored provider turn. Archived grants retain this provenance.
    const grants = await this.ports.manual.listAllForUsage(),
      sessions = new Set(grants.map((grant) => grant.sessionId));
    for (const sessionId of sessions) {
      let record;
      try {
        record = await this.store.session(sessionId);
      } catch {
        continue;
      }
      if (record.status !== "running" || !record.runId) continue;
      const accepted = await this.store.db
        .prepare(
          "SELECT receipt FROM receipts WHERE json_extract(receipt,'$.sessionId')=? AND json_extract(receipt,'$.runId')=? LIMIT 2",
        )
        .all(sessionId, record.runId);
      if (accepted.length !== 1) continue;
      const receipt = JSON.parse(accepted[0].receipt),
        block = record.session.blocks.find((value) => value.id === receipt.commandId);
      if (
        !block ||
        block.role !== "user" ||
        block.draft ||
        block.author?.kind !== "assistant-manual"
      )
        continue;
      const author = block.author,
        grant = grants.find(
          (value) =>
            value.id === author.supervisionId &&
            value.sessionId === sessionId &&
            value.source.projectId === record.projectId,
        );
      if (!grant || !author.operationId?.startsWith(`manual:${grant.id}:${sessionId}:`)) continue;
      const operationId = author.operationId.endsWith(":compact")
        ? author.operationId.slice(0, -8)
        : author.operationId;
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_session_receipts WHERE id=?")
        .get(operationId);
      if (row && JSON.parse(row.value).operation?.sessionId === sessionId) return true;
    }
    return false;
  }
  async tick(): Promise<void> {
    // Native presence starts a PowerShell process (seconds on Windows); read it
    // before joining the queue so owner requests never wait behind it.
    const profile = await this.ready.then(() => this.profile());
    const presence =
      profile.enabled && profile.setupComplete
        ? await readAssistantPresence(this.ports.readPresence)
        : undefined;
    return this.serialize(async () => {
      try {
        await this.tickInner(undefined, presence);
      } finally {
        await this.syncKeepAwake();
      }
    });
  }
  private async applyConversationRetention() {
    const days = await this.runtime<number>("conversationRetentionDays", 0);
    if (!days) return;
    await this.store.db
      .prepare(
        "UPDATE assistant_messages SET deleted_at=? WHERE deleted_at IS NULL AND json_extract(value,'$.createdAt')<?",
      )
      .run(this.now(), this.now() - days * DAY);
  }
  private async cleanupDeletedRecords() {
    await this.store.transaction(async () => {
      await this.applyConversationRetention();
      for (const table of ["jobs", "memory", "activity", "messages", "notetrash"] as const) {
        const expired = await this.store.db
          .prepare(
            `SELECT id FROM assistant_${table} WHERE deleted_at IS NOT NULL AND deleted_at<=? ORDER BY deleted_at,id LIMIT 1000`,
          )
          .all(this.now() - 7 * DAY);
        for (const row of expired) {
          if (table === "jobs") await this.ports.jobDeletion?.purge(String(row.id));
          await this.repository.purge(table, String(row.id));
        }
      }
    }, "critical");
  }
  /** Called only with a live, exact project permit captured by the Host observation owner. */
  async acceptObservedTaskEvent(
    event: AssistantObservation & { id: string; sequence: number },
    guard: () => boolean,
  ): Promise<boolean> {
    if (event.source !== "task" || event.projectIds.length !== 1 || event.accountId || !guard())
      return false;
    const projectId = event.projectIds[0];
    if (!(await this.manualProjectAllowed(projectId)) || !guard()) return false;
    return this.store.transaction(async () => {
      if (!guard() || this.closing || this.emergencyStop || (await this.runtime("paused", false)))
        return false;
      const profile = await this.profile();
      const policy = assistantPolicy(profile);
      const manual = await this.manualPolicy();
      if (
        !profile.enabled ||
        !profile.setupComplete ||
        !manual.enabled ||
        !manual.projectIds.includes(projectId) ||
        (!policy.observationTaskDone && !policy.observationTaskNeedsInput)
      )
        return false;
      const receipt = `observation-task-event:${event.id}`;
      if (await this.runtime(receipt, false)) return guard();
      const match = /^db:([1-9]\d*)$/.exec(event.sourceRevision);
      if (!match || !Number.isSafeInteger(Number(match[1]))) return false;
      const revision = await this.store.db
        .prepare(
          "SELECT version FROM assistant_observation_source_revisions WHERE source='task' AND source_id=?",
        )
        .get(event.sourceId);
      if (!revision || Number(revision.version) < Number(match[1])) return false;
      if (Number(revision.version) > Number(match[1])) {
        await this.setRuntime(receipt, true);
        if (!guard()) throw new Error("Observation source was revoked before commit.");
        return true;
      }
      const row = await this.store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(event.sourceId);
      const task = row
        ? (JSON.parse(String(row.value)) as {
            id?: string;
            projectId?: string;
            status?: string;
            needsInput?: boolean;
            createdAt?: number;
          })
        : undefined;
      const category =
        task?.projectId === projectId &&
        task.id === event.sourceId &&
        Number.isSafeInteger(task.createdAt) &&
        task.createdAt! >= 0
          ? task.status === "done"
            ? "task.done"
            : task.needsInput === true
              ? "task.needsInput"
              : undefined
          : undefined;
      const stateKey = `observation-task-state:${createHash("sha256")
        .update(JSON.stringify([projectId, event.sourceId]))
        .digest("hex")}`;
      const previous = await this.runtime<string | null>(stateKey, null);
      if (!guard()) return false;
      if (
        category !== previous &&
        ((category === "task.done" && policy.observationTaskDone) ||
          (category === "task.needsInput" && policy.observationTaskNeedsInput))
      ) {
        await this.queueNotification({
          id: `observation:${event.id}`,
          kind: category,
          title: category === "task.done" ? "Task completed" : "Task needs input",
          body:
            category === "task.done"
              ? "An observed task completed."
              : "An observed task needs your input.",
          createdAt: this.now(),
          taskId: event.sourceId,
          taskCreatedAt: task!.createdAt,
          projectId,
          projectIds: [projectId],
        });
      }
      await this.setRuntime(stateKey, category ?? null);
      await this.setRuntime(receipt, true);
      if (!guard()) throw new Error("Observation source was revoked before commit.");
      return true;
    }, "critical");
  }
  private async tickInner(
    chief: (turn: () => Promise<void>) => unknown = (turn) => turn(),
    presence?: AssistantPresenceObservation,
  ) {
    await this.cleanupDeletedRecords();
    await this.store.transaction(() => this.queueOwnerQuestionReminders(), "critical");
    const profile = await this.profile();
    if (profile.enabled && profile.setupComplete) await this.syncPresence(presence);
    if (profile.enabled && profile.setupComplete) {
      const schedule = await this.runtime("briefingSchedule", { enabled: true, time: "09:00" }),
        date = new Date(this.now()),
        time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (schedule.enabled && time >= schedule.time)
        await this.prepareBriefing(this.now() - DAY, day);
    }
    await this.syncHoursHolds(profile);
    if (
      this.emergencyStop ||
      !profile.enabled ||
      !profile.setupComplete ||
      (await this.runtime("paused", false))
    )
      return;
    await this.store.transaction(() => this.setRuntime("heartbeat", this.now()));
    await this.syncBudgetHolds(profile);
    const observationPolicy = assistantPolicy(profile);
    if (
      this.ports.pollObservedTasks &&
      (this.ports.observedTaskDeliveryConfigured?.() === true ||
        this.ports.observationTasksReady?.() === true) &&
      (observationPolicy.observationTaskDone || observationPolicy.observationTaskNeedsInput)
    ) {
      const scope = await this.manualPolicy();
      if (scope.enabled) {
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.ports.pollObservedTasks(
              scope.projectIds,
              (event, guard) => this.acceptObservedTaskEvent(event, () => active && guard()),
              () => active,
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Observation poll timed out.")), 10000);
            }),
          ]);
        } catch (error) {
          this.ports.onError?.(error);
        } finally {
          active = false;
          if (timer) clearTimeout(timer);
        }
      }
    }
    let usage = await this.usage(profile);
    let incompleteUsage = false;
    const events: AssistantActivity[] = [];
    const jobs = (await this.repository.list<AssistantJob>("jobs", 10000)).sort(
      compareAssistantJobPriority,
    );
    for (const original of jobs) {
      if (this.closing || this.emergencyStop) break;
      if (original.kind === "quick") {
        await this.runQuickJob(original);
        continue;
      }
      let job: AssistantProjectJob = { ...original, projectIds: assistantJobProjectIds(original) };
      if (terminal.has(job.status) && job.tokensComplete !== false) continue;
      if (
        job.status === "queued" &&
        usage.mode === "run" &&
        profile.autonomy !== "report" &&
        assistantActiveHours(profile, this.now())
      ) {
        if (!profile.execution || !this.ports.createGoal) continue;
        job = await this.store.transaction(
          () =>
            this.repository.put(
              "jobs",
              { ...job, status: "planning", dispatchState: "unknown", updatedAt: this.now() },
              job.version,
            ),
          "critical",
        );
        try {
          await this.store.db.checkAuthorization();
          for (const id of assistantJobProjectIds(job)) await this.assertProject(id);
          const goal = await this.ports.createGoal({ job, profile });
          job = await this.store.transaction(async () => {
            const next = await this.repository.put<AssistantProjectJob>(
              "jobs",
              { ...job, goalId: goal.goalId, dispatchState: "submitted", updatedAt: this.now() },
              job.version,
            );
            events.push(
              await this.activity("job.started", "The job was submitted to the goal planner.", {
                jobId: job.id,
              }),
            );
            return next;
          }, "critical");
        } catch (error) {
          // The effect might have committed before transport/storage failed.
          // Keep its stable identity and reconcile it via findGoal on next tick.
          await this.store.transaction(async () => {
            await this.repository.put(
              "jobs",
              {
                ...job,
                status: "waiting",
                summary: `Planner submission outcome is unknown. ${String(error).slice(0, 1000)}`,
                updatedAt: this.now(),
              },
              job.version,
            );
            await this.activity("job.unknown", "Planner submission needs reconciliation.", {
              jobId: job.id,
            });
          }, "critical");
          continue;
        }
      }
      if (job.dispatchState === "unknown" && !job.goalId) {
        let recovered;
        try {
          recovered = await this.ports.findGoal?.(job.id, job);
        } catch (error) {
          incompleteUsage = true;
          await this.holdJobScope(job, error);
          continue;
        }
        if (!recovered) {
          await this.recordJobProblem(job.id, "Planner submission is still unconfirmed.");
          continue;
        }
        job = await this.store.transaction(
          () =>
            this.repository.put(
              "jobs",
              {
                ...job,
                goalId: recovered.goalId,
                dispatchState: "submitted",
                status: "planning",
                updatedAt: this.now(),
              },
              job.version,
            ),
          "critical",
        );
      }
      if (job.goalId && this.ports.goalStatus) {
        let status: Awaited<ReturnType<NonNullable<AssistantPorts["goalStatus"]>>>;
        try {
          status = await this.ports.goalStatus(job.goalId, profile, job.sessionIds, job);
        } catch (error) {
          incompleteUsage = true;
          if (hasErrorCode(error, "ASSISTANT_JOB_SCOPE")) await this.holdJobScope(job, error);
          else if (await resubmitGoal(error, job, profile, this.ports))
            events.push(await this.activity("job.resubmitted", GOAL_RESENT, { jobId: job.id }));
          else await this.recordJobProblem(job.id, jobLog.jobStatusFailureSummary(error));
          continue;
        }
        if (status.sessionQuestions) {
          const questions = status.sessionQuestions.slice(0, 20),
            old = await this.runtime<AssistantQuestionStatus[]>(`questions:${job.id}`, []);
          if (JSON.stringify(old) !== JSON.stringify(questions))
            await this.store.transaction(async () => {
              await this.setRuntime(`questions:${job.id}`, questions);
              if (questions.length)
                events.push(
                  await this.activity(
                    "session.question",
                    "A current worker clarification needs routine-policy or owner review.",
                    { jobId: job.id },
                  ),
                );
            }, "critical");
        }
        const summary =
          job.awaitingOwnerRestart || job.pendingTaskDeletion
            ? job.summary
            : (status.summary ?? "").slice(0, 4000);
        const stalled =
          status.status === "running" &&
          status.lastActivityAt !== undefined &&
          this.now() - status.lastActivityAt >= profile.stallMinutes * 60000;
        const nextStatus = job.pendingTaskDeletion
          ? "waiting"
          : job.awaitingOwnerRestart
            ? "paused"
            : terminal.has(status.status)
              ? status.status
              : job.status === "paused"
                ? "paused"
                : stalled
                  ? "stalled"
                  : status.status;
        const charged = Math.max(job.tokens, status.tokens ?? job.tokens);
        const tokensComplete = status.tokensComplete ?? status.tokens !== undefined;
        incompleteUsage ||= status.usageIncomplete ?? !tokensComplete;
        await this.store.transaction(async () => {
          if (status.usageTurns)
            await this.reconcileWorkerTurns({ jobId: job.id }, status.usageTurns);
          else if (charged > job.tokens)
            await this.adjustWorkerUsage(usage.day, charged - job.tokens, 0);
        }, "critical");
        usage = await this.usage(profile);
        const stateChanged =
          nextStatus !== job.status ||
          summary !== job.summary ||
          JSON.stringify(status.progress) !== JSON.stringify(job.progress) ||
          JSON.stringify(status.taskIds) !== JSON.stringify(job.taskIds) ||
          JSON.stringify(status.sessionIds) !== JSON.stringify(job.sessionIds);
        if (stateChanged || charged !== job.tokens || tokensComplete !== job.tokensComplete) {
          job = await this.store.transaction(async () => {
            const next = await this.repository.put(
              "jobs",
              {
                ...job,
                status: nextStatus,
                taskIds: status.taskIds,
                sessionIds: status.sessionIds,
                progress: status.progress,
                summary,
                tokens: charged,
                tokensComplete,
                updatedAt: this.now(),
              },
              job.version,
            );
            const event = await this.activity(
              stateChanged ? `job.${nextStatus}` : "job.usage",
              stateChanged ? summary || `Job is ${nextStatus}.` : "Worker usage was updated.",
              { jobId: job.id },
            );
            if (stateChanged) events.push(event);
            if (nextStatus !== job.status && ["done", "waiting", "failed"].includes(nextStatus))
              await this.queueNotification({
                id: event.id,
                kind: `job.${nextStatus}` as PendingNotification["kind"],
                title: job.title,
                body: summary || `Job is ${nextStatus}.`,
                createdAt: this.now(),
                jobId: job.id,
                projectId: job.projectId,
                projectIds: assistantJobProjectIds(job),
              });
            return next;
          }, "critical");
        }
        try {
          await this.ports.markManagedSessions?.(job);
        } catch (error) {
          this.ports.onError?.(error);
        }
      }
    }
    const manualState = await this.manualTick(profile);
    incompleteUsage ||= manualState.incomplete;
    await this.store.transaction(async () => {
      const current = await this.usage(profile);
      await this.setRuntime(`usage:${current.day}`, {
        ...current,
        workerUsageIncomplete: incompleteUsage,
        estimated: current.estimated || incompleteUsage,
      });
    }, "critical");
    usage = await this.usage(profile);
    await this.syncBudgetHolds(profile);
    if (usage.mode === "paused" && (await this.runtime("budgetAlertDay", "")) !== usage.day) {
      await this.store.transaction(async () => {
        await this.activity("budget.exhausted", "The daily assistant token budget is exhausted.");
        await this.setRuntime("budgetAlertDay", usage.day);
      }, "critical");
    }
    if (events.length) await this.appendDailyNote(profile, events);
    const reviewJobs = (await this.repository.list<AssistantJob>("jobs", 10000)).filter(
      (job) =>
        job.kind !== "quick" && job.goalId && !terminal.has(job.status) && job.status !== "paused",
    );
    const reviewWindow = Math.floor(this.now() / 1800000);
    if (
      (reviewJobs.length || manualState.digest.length) &&
      profile.autonomy === "chief" &&
      (await this.runtime<number>("chiefReviewWindow", -1)) !== reviewWindow &&
      !(await this.pendingChiefEvents()).length
    )
      await this.store.transaction(async () => {
        await this.setRuntime("chiefReviewWindow", reviewWindow);
        const event = await this.activity(
          "chief.periodicReview",
          "Active supervised work is due for its half-hour review.",
        );
        await this.enqueueChiefEvent(event);
      }, "critical");
    await chief(() => this.runChief(profile, manualState.digest));
    this.ports.onChange?.();
  }
  private appendDailyNote(
    profile: AssistantProfile,
    events: AssistantActivity[],
    options: { strict?: boolean; day?: string } = {},
  ) {
    return appendAssistantDailyNote(
      {
        ports: this.ports,
        runtime: (id, fallback) => this.runtime(id, fallback),
        now: () => this.now(),
      },
      profile,
      events,
      options,
    );
  }
  private async snapshot(limit: number): Promise<AssistantSnapshot> {
    const profile = await this.profile();
    const trash: AssistantSnapshot["trash"] = [];
    for (const kind of ["jobs", "memory", "activity", "messages", "notetrash"] as const) {
      const rows = await this.store.db
        .prepare(
          `SELECT id,value,deleted_at FROM assistant_${kind} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`,
        )
        .all(limit);
      for (const row of rows) {
        const value = JSON.parse(row.value);
        let projectId: string | null | undefined, projectIds: string[] | undefined;
        if (kind === "memory" || kind === "notetrash") {
          projectId = null;
          projectIds = [];
        } else if (
          kind === "jobs" &&
          (typeof value.projectId === "string" ||
            (value.kind === "quick" && value.projectId === null))
        ) {
          projectId = value.projectId;
          projectIds = assistantJobProjectIds(value);
        } else if (kind === "messages" && typeof value.threadId === "string") {
          projectIds = (await this.messageProjectScope(value as AssistantMessage)).projectIds;
          if (projectIds?.length === 0) projectId = null;
          else if (projectIds?.length === 1) projectId = projectIds[0];
        } else if (kind === "activity") {
          if (typeof value.jobId === "string") {
            const job = await this.repository.get<AssistantJob>("jobs", value.jobId, true);
            if (job) {
              projectId = job.projectId;
              projectIds = assistantJobProjectIds(job);
            }
          } else if (typeof value.supervisionId === "string") {
            projectId = (await this.ports.manual?.listAllForUsage())?.find(
              (grant) => grant.id === value.supervisionId,
            )?.source.projectId;
            if (projectId) projectIds = [projectId];
          }
        }
        const deletedTaskCount =
          kind === "jobs"
            ? await this.ports.jobDeletion?.deletedTaskCount(String(row.id))
            : undefined;
        trash.push({
          id: `${kind}:${row.id}`,
          kind,
          ...(projectId === undefined ? {} : { projectId }),
          ...(projectIds === undefined ? {} : { projectIds }),
          ...(deletedTaskCount === undefined ? {} : { deletedTaskCount }),
          title: String(value.title ?? value.text ?? value.summary ?? "").slice(0, 300),
          deletedAt: row.deleted_at,
          expiresAt: row.deleted_at + 7 * DAY,
        });
      }
    }
    let notes: AssistantNote[] = [];
    let notesError: string | undefined;
    try {
      notes = ((await this.ports.listNotes?.()) ?? [])
        .filter((note) => note.tags.includes("assistant"))
        .slice(0, limit);
    } catch (error) {
      notesError = String(error).slice(0, 2000);
    }
    const automatic = await this.runtime<AssistantAutomaticPresence | null>(
      "automaticPresence",
      null,
    );
    const review = await this.runtime<ChiefIntent | null>("chiefPendingIntent", null);
    const chiefReview =
      review && ["unknown", "capacity"].includes(review.status)
        ? {
            blocked: true,
            message: await this.safeOutput(
              review.status === "capacity"
                ? "The review exceeds its context reservation. No provider call was made. Increase review capacity or retry review."
                : "The last reasoning result is uncertain. No new Host actions were issued. Inspect History, then retry review.",
            ),
          }
        : undefined;
    return {
      workHoursActive: assistantActiveHours(profile, this.now()),
      ownerQuestions: await this.ownerQuestions.list(),
      profile,
      briefingSchedule: await this.runtime("briefingSchedule", { enabled: true, time: "09:00" }),
      manualPolicy: await this.manualPolicy(),
      manualGrants: (await this.ports.manual?.list()) ?? [],
      conversationRetentionDays: await this.runtime<number>("conversationRetentionDays", 0),
      lastSpokenLanguage:
        (await this.runtime<{ language: string } | null>("lastSpokenLanguage", null))?.language ??
        null,
      jobs: await this.repository.list("jobs", limit),
      memory: await this.repository.list("memory", limit),
      threads: await this.repository.list("threads", limit),
      activity: await this.repository.list("activity", limit),
      notes,
      ...(notesError ? { notesError } : {}),
      trash: trash.sort((a, b) => b.deletedAt - a.deletedAt).slice(0, limit),
      presence: await this.runtime("presence", {
        state: "present",
        since: this.now(),
        updatedAt: this.now(),
      }),
      ...(automatic ? { automaticPresence: automatic } : {}),
      ...(chiefReview ? { chiefReview } : {}),
      effectivePresence: await this.effectivePresence(),
      notifications: await this.notifications(profile),
      usage: await this.usage(profile, true),
      paused: await this.runtime("paused", false),
      lastHeartbeatAt: await this.runtime("heartbeat", null),
      briefing: await this.runtime("briefing", null),
      capabilities: {
        jobs: !!this.ports.createGoal,
        chief: !!this.ports.chiefWake,
        notes: !!this.ports.listNotes && !notesError,
        quickNotes: !!this.ports.quickNotes && !notesError,
        quickAutomations: !!this.ports.quickAutomations,
        observationTasks:
          !!this.ports.pollObservedTasks &&
          (!!this.ports.taskNotificationAllowed ||
            this.ports.observedTaskDeliveryConfigured?.() === true) &&
          this.ports.observationTasksReady?.() === true,
        conversations: !!this.ports.reply,
      },
    };
  }
}
