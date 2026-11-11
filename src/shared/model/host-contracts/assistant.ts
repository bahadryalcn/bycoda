import { z } from "zod";
import {
  AssistantJobHoldReasonSchema,
  AssistantNotificationKindSchema,
  type AssistantJobHoldReason,
  type AssistantNotificationKind,
} from "./assistant-attention";
import { AssistantProfilePatchSchema, type AssistantProfilePatch } from "./assistant-profile";
import { AssistantModelPoolOps, AssistantModelPoolResponseSchema } from "../assistantModelPool";
import { AssistantAlwaysOnSchema, AssistantRoomSettingsOps } from "../assistantAlwaysOn";
import { AssistantFoldersResponseSchema } from "../assistantFolders";
import { AssistantReminderOps, AssistantRemindersResponseSchema } from "../assistantReminders";
import { quickAutomationActionSchema } from "./assistant-quick-automation";
export {
  ASSISTANT_MIN_DAILY_TOKEN_BUDGET,
  AssistantExecutionSchema,
  AssistantProfilePatchSchema,
  type AssistantExecution,
  type AssistantProfilePatch,
} from "./assistant-profile";
import { ModelSettingsSchema } from "./session-commands";
import type {
  ManualSupervisionPolicy,
  ManualSupervisionGrant,
  ManualSessionCandidate,
} from "../assistantManual";
import type { AssistantQuickAutomationAction } from "../assistantQuickAutomation";
import type { AssistantPolicy } from "../assistantPolicy";
import {
  AssistantThreadSummaryProofSchema,
  AssistantThreadSummaryStateSchema,
  type AssistantThreadSummaryProof,
  type AssistantThreadSummaryState,
} from "../assistantThreadSummary";
import {
  AssistantVoiceContextSchema,
  AssistantVoiceContextOpenSchema,
  AssistantVoiceContextGetSchema,
  AssistantVoiceContextInvalidateSchema,
  AssistantVoiceRuntimeRegisterSchema,
  type AssistantVoiceContext,
} from "../assistantVoiceContext";
import {
  AssistantOwnerQuestionSchema,
  AssistantOwnerQuestionReceiptSchema,
  AssistantOwnerQuestionAskSchema,
  AssistantOwnerQuestionPresentSchema,
  AssistantOwnerQuestionGetSchema,
  AssistantOwnerQuestionAnswerSchema,
  AssistantOwnerQuestionSnoozeSchema,
  AssistantOwnerQuestionCancelSchema,
  type AssistantOwnerQuestion,
  type AssistantOwnerQuestionReceipt,
} from "../assistantOwnerQuestions";
const text = (max: number) => z.string().min(1).max(max);
const id = text(200);
const version = z.number().int().nonnegative();
const limit = z.number().int().min(1).max(100).optional();
const manualPolicySchema = z.strictObject({
  enabled: z.boolean(),
  version,
  projectIds: z.array(id).max(100),
});
const manualSourceSchema = z.strictObject({
  projectId: id,
  executionCwd: text(4096),
  authorityGeneration: version.optional(),
  harness: text(200),
  model: text(200),
  modelSettings: ModelSettingsSchema,
  runtimeMode: text(100),
  providerAccountId: id.optional(),
});
const manualGrantSchema = z.strictObject({
  id,
  sessionId: id,
  title: z.string().max(300).optional(),
  version,
  active: z.boolean(),
  source: manualSourceSchema,
  sourceToken: text(64),
  enrolledAt: version,
  updatedAt: version,
  revokedAt: version.optional(),
});
const manualCandidateSchema = z.strictObject({
  sessionId: id,
  projectId: id,
  title: z.string().max(300),
  sourceToken: text(64),
  eligible: z.boolean(),
  reason: z.string().max(1000).optional(),
  enrolledSourceChanged: z.boolean().optional(),
});
const retentionDays = z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(365)]);
/** Style fields stay optional on reads: an older Host omits them and readers use defaults. */
type AssistantStyleKey = "addressFrequency" | "tone" | "allowProfanity" | "persona" | "confirmJobs";
export type AssistantProfile = Required<
  Omit<AssistantProfilePatch, keyof AssistantPolicy | "voiceNarration" | AssistantStyleKey>
> &
  Pick<AssistantProfilePatch, AssistantStyleKey> &
  AssistantPolicy & { voiceNarration?: boolean; version: number; updatedAt: number };
export type AssistantMemory = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  kind: "rule" | "profile" | "fact";
  text: string;
  scope: "all" | "voice" | "sessions";
  source: "typed" | "spoken" | "learned";
  quote: string;
  active: boolean;
  forbiddenTerms: string[];
};
export type { AssistantJobHoldReason };
export type AssistantJobStatus =
  | "queued"
  | "planning"
  | "running"
  | "stalled"
  | "waiting"
  | "done"
  | "failed"
  | "paused"
  | "cancelled";
export type AssistantJobDeleteReview = {
  jobId: string;
  jobVersion: number;
  sourceToken: string;
  goalId: string;
  projectIds: string[];
  tasks: { id: string; title: string; projectId: string; status: string; updatedAt: number }[];
};
type AssistantJobBase = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  title: string;
  request: string;
  status: AssistantJobStatus;
  taskIds: string[];
  sessionIds: string[];
  progress: { done: number; total: number };
  summary: string;
  tokens: number;
  tokensComplete?: boolean;
  idempotencyKey: string;
  dispatchState: "pending" | "submitted" | "unknown";
  awaitingOwnerRestart?: boolean;
  pendingTaskDeletion?: boolean;
};
export type AssistantJobPriority = "low" | "normal" | "high";
export type AssistantProjectJob = AssistantJobBase & {
  kind?: "project";
  priority?: AssistantJobPriority;
  detachedSessionIds?: string[];
  projectId: string;
  projectIds?: string[];
  goalId?: string;
  quickAction?: never;
  quickResult?: never;
  quickIntent?: never;
};
export type AssistantQuickNoteJob = AssistantJobBase & {
  kind: "quick";
  projectId: null;
  projectIds: string[];
  goalId?: never;
  quickAction: { kind: "note"; title: string; body: string };
  quickResult?: { noteId: string; automationId?: never };
  quickIntent?: never;
};
export type AssistantQuickAutomationJob = AssistantJobBase & {
  kind: "quick";
  projectId: string;
  projectIds: string[];
  goalId?: never;
  quickAction: AssistantQuickAutomationAction;
  quickResult?: { automationId: string; noteId?: never };
  quickIntent?: { automationId: string };
};
export type AssistantQuickJob = AssistantQuickNoteJob | AssistantQuickAutomationJob;
export type AssistantJob = AssistantProjectJob | AssistantQuickJob;
export type AssistantThread = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  summary: string;
  summaryProof?: AssistantThreadSummaryProof;
  summaryState?: AssistantThreadSummaryState;
};
export type AssistantMessageToolAction = {
  id: string;
  family: string;
  action: string;
  status: "completed" | "unknown";
  createdAt: number;
};
export type AssistantMessage = {
  id: string;
  projectIds?: string[];
  /** Minimum visibility restrictions; these do not certify contributor provenance. */
  visibilityProjectIds?: string[];
  unverifiedToolContext?: true;
  toolActions?: AssistantMessageToolAction[];
  ownerQuestionId?: string;
  ownerQuestionRequestId?: string;
  ownerQuestionAction?: "answer" | "snooze";
  version: number;
  createdAt: number;
  updatedAt: number;
  threadId: string;
  role: "user" | "assistant";
  via: "text" | "voice";
  text: string;
  sessionId?: string;
  jobIds: string[];
};
export type AssistantActivity = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  kind: string;
  summary: string;
  ownerQuestionId?: string;
  jobId?: string;
  supervisionId?: string;
  sessionId?: string;
  tokens?: number;
};
export type AssistantNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  createdAt: number;
};
export type AssistantTrash = {
  id: string;
  projectId?: string | null;
  projectIds?: string[];
  kind: "jobs" | "memory" | "activity" | "messages" | "notetrash";
  title: string;
  deletedAt: number;
  expiresAt: number;
  deletedTaskCount?: number;
};
export type AssistantPresence = {
  state: "present" | "idle" | "away" | "dnd";
  since: number;
  updatedAt: number;
};
/**
 * How long one computer reading stays valid. It spans several Host presence ticks, so a slow or
 * failed probe keeps the last reading instead of changing the owner's availability.
 */
export const ASSISTANT_PRESENCE_FRESH_MS = 300000;
/** `supported: false` marks a computer that could not be read; it is reported as away. */
export type AssistantAutomaticPresence = {
  state: "present" | "idle" | "away" | "locked";
  since: number;
  updatedAt: number;
  supported: boolean;
  idleMs?: number;
};
/** Availability is always one of these; an unreadable computer counts as away, never as present. */
export type AssistantEffectivePresence = "present" | "idle" | "away" | "dnd";
export type AssistantNotification = {
  id: string;
  kind: AssistantNotificationKind;
  title: string;
  body: string;
  createdAt: number;
  jobId?: string;
  taskId?: string;
  taskCreatedAt?: number;
  projectId?: string;
  projectIds?: string[];
  eligible: boolean;
  deferredReason: "quiet" | "away" | "idle" | "dnd" | "unknown" | "settings" | null;
};
/** Provider worker root-turn measurements; percent is a per-turn mean, not a billing rate. */
export type AssistantCacheUsage = {
  scope: "worker-turns";
  measuredTurns: number;
  totalTurns: number;
  percentageTurns: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheHitPercent?: number;
  complete: boolean;
};
export type AssistantUsage = {
  day: string;
  chiefTokens: number;
  workerTokens: number;
  total: number;
  mode: "run" | "report" | "paused";
  estimated: boolean;
  workerUsageIncomplete?: boolean;
  observedWorkerTokens?: number;
  reservedWorkerTokens?: number;
  cacheUsage?: AssistantCacheUsage;
};
export type AssistantKeepAwakeStatus = {
  supported: boolean;
  requested: boolean;
  active: boolean;
  error?: string;
};
export type AssistantSnapshot = {
  workHoursActive?: boolean;
  ownerQuestions?: AssistantOwnerQuestion[];
  profile: AssistantProfile;
  jobs: AssistantJob[];
  memory: AssistantMemory[];
  threads: AssistantThread[];
  activity: AssistantActivity[];
  notes: AssistantNote[];
  trash: AssistantTrash[];
  presence: AssistantPresence;
  conversationRetentionDays?: number;
  lastSpokenLanguage?: string | null;
  automaticPresence?: AssistantAutomaticPresence;
  effectivePresence?: AssistantEffectivePresence;
  notifications?: AssistantNotification[];
  chiefReview?: { blocked: boolean; message: string };
  manualPolicy?: ManualSupervisionPolicy;
  manualGrants?: ManualSupervisionGrant[];
  usage: AssistantUsage;
  paused: boolean;
  lastHeartbeatAt: number | null;
  briefing: {
    id: string;
    text: string;
    createdAt: number;
    projectIds?: string[];
    voiceReceipt?: { reason: "return"; returnAt: number; meaningful: boolean; important: boolean };
  } | null;
  briefingSchedule?: { enabled: boolean; time: string };
  notesError?: string;
  keepAwake?: AssistantKeepAwakeStatus;
  jobHolds?: Record<string, AssistantJobHoldReason>;
  capabilities: {
    jobs: boolean;
    chief: boolean;
    notes: boolean;
    quickNotes?: boolean;
    quickAutomations?: boolean;
    observationTasks?: boolean;
    conversations: boolean;
  };
};
const quickNoteActionSchema = z.strictObject({
  kind: z.literal("note"),
  title: text(400),
  body: z.string().max(100000),
});
const quickJobCreateSchema = z.strictObject({
  op: z.literal("jobs.create"),
  kind: z.literal("quick"),
  title: text(300),
  request: text(16000),
  idempotencyKey: id,
  quickAction: z.discriminatedUnion("kind", [quickNoteActionSchema, quickAutomationActionSchema]),
});
export const AssistantRequestValidationSchema = z.union([
  z.discriminatedUnion("op", [
    AssistantVoiceContextOpenSchema,
    AssistantVoiceContextGetSchema,
    AssistantVoiceContextInvalidateSchema,
    AssistantVoiceRuntimeRegisterSchema,
    AssistantOwnerQuestionAskSchema,
    AssistantOwnerQuestionPresentSchema,
    AssistantOwnerQuestionGetSchema,
    AssistantOwnerQuestionAnswerSchema,
    AssistantOwnerQuestionSnoozeSchema,
    AssistantOwnerQuestionCancelSchema,
    z.strictObject({ op: z.literal("projects.list") }),
    z.strictObject({ op: z.literal("snapshot"), limit }),
    z.strictObject({ op: z.literal("profile.get") }),
    ...AssistantModelPoolOps,
    ...AssistantRoomSettingsOps,
    ...AssistantReminderOps,
    z.strictObject({ op: z.literal("narration.pending"), threadId: id, generation: id }),
    z.strictObject({ op: z.literal("narration.claim"), threadId: id, eventId: id, generation: id }),
    z.strictObject({
      op: z.literal("narration.settle"),
      threadId: id,
      eventId: id,
      generation: id,
      state: z.enum(["delivered", "unknown"]),
    }),
    z.strictObject({
      op: z.literal("profile.update"),
      expectedVersion: version,
      patch: AssistantProfilePatchSchema,
    }),
    z.strictObject({
      op: z.literal("memory.save"),
      id: id.optional(),
      expectedVersion: version.optional(),
      kind: z.enum(["rule", "profile", "fact"]),
      text: text(4000),
      scope: z.enum(["all", "voice", "sessions"]),
      source: z.enum(["typed", "spoken", "learned"]),
      quote: z.string().max(4000).optional(),
      active: z.boolean().optional(),
      forbiddenTerms: z.array(text(80)).max(30).optional(),
    }),
    z.strictObject({
      op: z.literal("memory.search"),
      query: z.string().max(200).optional(),
      scope: z.enum(["all", "voice", "sessions"]).optional(),
      limit,
    }),
    z.strictObject({ op: z.literal("memory.delete"), id, expectedVersion: version }),
    z.strictObject({ op: z.literal("threads.open"), projectId: id.optional() }),
    z
      .strictObject({
        op: z.literal("threads.messages"),
        threadId: id,
        limit,
        before: z.number().int().nonnegative().optional(),
        beforeId: id.optional(),
      })
      .refine((input) => !input.beforeId || input.before !== undefined, {
        message: "A history cursor ID requires its timestamp.",
      }),
    z.strictObject({ op: z.literal("threads.clear"), threadId: id, expectedVersion: version }),
    z.strictObject({ op: z.literal("conversations.retention"), days: retentionDays }),
    z.strictObject({
      op: z.literal("voice.language.record"),
      language: z.enum(["tr-TR", "en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "zh-CN", "ja-JP"]),
      requestId: id,
      observedAt: version,
    }),
    z.strictObject({
      op: z.literal("conversations.search"),
      query: text(200),
      threadId: id.optional(),
      limit,
    }),
    z.strictObject({
      op: z.literal("threads.append"),
      threadId: id,
      role: z.enum(["user", "assistant"]),
      via: z.enum(["voice", "text"]),
      text: text(16000),
      causalContextId: id.optional(),
      sessionId: id.optional(),
      jobIds: z.array(id).max(20).optional(),
      idempotencyKey: id,
    }),
    z.strictObject({ op: z.literal("messages.linkJob"), id, jobId: id, jobKey: id }),
    z.strictObject({ op: z.literal("threads.sendIdentity") }),
    z.strictObject({
      op: z.literal("threads.send"),
      threadId: id,
      via: z.enum(["voice", "text"]),
      text: text(16000),
      sessionId: id.optional(),
      idempotencyKey: id,
      expectedHostInstance: id.optional(),
    }),
    z.strictObject({
      op: z.literal("threads.sendStatus"),
      threadId: id,
      text: text(16000),
      sessionId: id.optional(),
      idempotencyKey: id,
      expectedHostInstance: id,
    }),
    z.strictObject({
      op: z.literal("threads.summary"),
      threadId: id,
      expectedVersion: version,
      summary: z.string().max(6000),
    }),
    z.strictObject({ op: z.literal("threads.summary.refresh"), threadId: id, requestId: id }),
    z.strictObject({ op: z.literal("messages.delete"), id, expectedVersion: version }),
    z.strictObject({
      op: z.literal("jobs.create"),
      kind: z.literal("project").optional(),
      title: text(300),
      request: text(16000),
      projectId: id,
      projectIds: z.array(id).min(1).max(20).optional(),
      idempotencyKey: id,
      after: id.optional(),
    }),
    z
      .strictObject({
        op: z.literal("jobs.control"),
        id,
        expectedVersion: version,
        action: z.enum(["pause", "resume", "stop", "delete"]),
        deleteTasks: z.boolean().optional(),
        taskDeleteToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .superRefine((value, ctx) => {
        if (
          (value.action !== "delete" &&
            (value.deleteTasks !== undefined || value.taskDeleteToken !== undefined)) ||
          (value.deleteTasks === true && !value.taskDeleteToken) ||
          (value.deleteTasks !== true && value.taskDeleteToken !== undefined)
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Task deletion requires an exact reviewed delete scope and is only available for Delete.",
          });
      }),
    z.strictObject({ op: z.literal("jobs.deleteReview"), id, expectedVersion: version }),
    z.strictObject({ op: z.literal("jobs.get"), id }),
    z.strictObject({ op: z.literal("jobs.activity"), id, limit: version.max(200).optional() }),
    z.strictObject({
      op: z.literal("jobs.priority"),
      id,
      expectedVersion: version,
      priority: z.enum(["low", "normal", "high"]),
    }),
    z.strictObject({ op: z.literal("jobs.deleteAbort"), id, expectedVersion: version }),
    z.strictObject({
      op: z.literal("jobs.replan"),
      id,
      expectedVersion: version,
      feedback: text(3000),
    }),
    z
      .strictObject({
        op: z.literal("sessions.detach"),
        sessionId: id,
        jobId: id.optional(),
        supervisionId: id.optional(),
        expectedVersion: version,
      })
      .refine((input) => !!input.jobId !== !!input.supervisionId, {
        message: "Choose exactly one supervision source.",
      }),
    z.strictObject({
      op: z.literal("sessions.nudge"),
      jobId: id,
      sessionId: id,
      requestId: id,
      text: text(300),
      reason: z.enum(["nudge", "answer", "steer"]),
    }),
    z.strictObject({
      op: z.literal("sessions.answer"),
      jobId: id,
      sessionId: id,
      requestId: id,
      questionToken: z.string().regex(/^[a-f0-9]{64}$/),
      answers: z.record(id, z.array(id).max(10)).refine((value) => Object.keys(value).length <= 5),
      custom: z
        .record(id, text(1000))
        .refine((value) => Object.keys(value).length <= 5)
        .optional(),
    }),
    z.strictObject({ op: z.literal("manual.list") }),
    z.strictObject({ op: z.literal("observation.delivery.list"), projectId: id }),
    z.strictObject({
      op: z.literal("observation.delivery.refresh"),
      projectId: id,
      notificationId: id,
    }),
    z.strictObject({
      op: z.literal("manual.policy"),
      expectedVersion: version,
      enabled: z.boolean(),
      projectIds: z.array(id).max(100),
    }),
    z.strictObject({
      op: z.literal("manual.enroll"),
      sessionId: id,
      sourceToken: text(64),
      expectedVersion: version,
    }),
    z.strictObject({ op: z.literal("manual.revoke"), id, expectedVersion: version }),
    z.strictObject({
      op: z.literal("manual.nudge"),
      supervisionId: id,
      sessionId: id,
      requestId: id,
      text: text(300),
      reason: z.enum(["nudge", "answer", "steer"]),
    }),
    z.strictObject({ op: z.literal("activity.clear"), jobId: id.optional() }),
    z.strictObject({
      op: z.literal("presence.set"),
      state: z.enum(["present", "idle", "away", "dnd"]),
    }),
    z.strictObject({ op: z.literal("notes.get"), id }),
    z.strictObject({
      op: z.literal("notes.save"),
      id: id.optional(),
      title: text(300),
      body: z.string().max(100000),
      expectedUpdatedAt: z.number().int().nonnegative().optional(),
    }),
    z.strictObject({
      op: z.literal("notes.delete"),
      id,
      expectedUpdatedAt: z.number().int().nonnegative(),
    }),
    z.strictObject({ op: z.literal("trash.restore"), id }),
    z.strictObject({ op: z.literal("trash.purge"), id }),
    z.strictObject({ op: z.literal("pauseAll") }),
    z.strictObject({ op: z.literal("resumeAll") }),
    z.strictObject({ op: z.literal("briefing.dismiss"), id }),
    z.strictObject({ op: z.literal("briefing.daily"), day: z.string().min(10).max(10) }),
    z.strictObject({
      op: z.literal("briefing.schedule"),
      enabled: z.boolean(),
      time: z.string().min(5).max(5),
    }),
    z.strictObject({ op: z.literal("notifications.ack"), id }),
    z.strictObject({ op: z.literal("tick") }),
    z.strictObject({ op: z.literal("chief.retry") }),
  ]),
  quickJobCreateSchema,
]);
export type AssistantRequest = z.infer<typeof AssistantRequestValidationSchema>;
export type AssistantResponse = {
  sendIdentity?: { instanceId: string };
  narrationEvents?: {
    eventId: string;
    kind: "progress" | "completed" | "question" | "reminder";
    text: string;
    createdAt: number;
  }[];
  narrationClaimed?: boolean;
  sendReceipt?: { status: "settled" | "unknown" | "refused" | "notSent" };
  observationDeliveries?: {
    notificationId: string;
    projectId: string;
    state: "pending" | "unknown" | "accepted" | "suppressed";
  }[];
  voiceContext?: AssistantVoiceContext;
  ownerQuestion?: AssistantOwnerQuestion | null;
  ownerQuestionReceipt?: AssistantOwnerQuestionReceipt;
  snapshot?: AssistantSnapshot;
  manual?: {
    policy: ManualSupervisionPolicy;
    grants: ManualSupervisionGrant[];
    candidates: ManualSessionCandidate[];
  };
  profile?: AssistantProfile;
  modelPool?: z.infer<typeof AssistantModelPoolResponseSchema>;
  assistantFolders?: z.infer<typeof AssistantFoldersResponseSchema>;
  alwaysOn?: z.infer<typeof AssistantAlwaysOnSchema>;
  reminders?: z.infer<typeof AssistantRemindersResponseSchema>;
  memory?: AssistantMemory;
  entries?: AssistantMemory[];
  thread?: AssistantThread;
  messages?: AssistantMessage[];
  message?: AssistantMessage;
  job?: AssistantJob;
  jobActivity?: AssistantActivity[];
  note?: AssistantNote | null;
  projects?: { id: string; path: string; name: string }[];
  ok?: boolean;
  trashId?: string;
  deleteReview?: AssistantJobDeleteReview;
};
const metadata = { id, version, createdAt: version, updatedAt: version };
const deleteReviewSchema = z.strictObject({
  jobId: id,
  jobVersion: version,
  sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  goalId: id,
  projectIds: z.array(id).min(1).max(20),
  tasks: z
    .array(
      z.strictObject({
        id,
        title: z.string().max(300),
        projectId: id,
        status: z.string().max(40),
        updatedAt: version,
      }),
    )
    .max(1000),
});
const profileSchema = AssistantProfilePatchSchema.required().extend({
  voiceNarration: z.boolean().optional(),
  addressFrequency: AssistantProfilePatchSchema.shape.addressFrequency,
  tone: AssistantProfilePatchSchema.shape.tone,
  allowProfanity: AssistantProfilePatchSchema.shape.allowProfanity,
  persona: AssistantProfilePatchSchema.shape.persona,
  confirmJobs: AssistantProfilePatchSchema.shape.confirmJobs,
  version,
  updatedAt: version,
  dailyTokenBudget: z.number().int().min(0).max(1_000_000_000),
});
const memorySchema = z.strictObject({
  ...metadata,
  kind: z.enum(["rule", "profile", "fact"]),
  text: text(4000),
  scope: z.enum(["all", "voice", "sessions"]),
  source: z.enum(["typed", "spoken", "learned"]),
  quote: z.string().max(4000),
  active: z.boolean(),
  forbiddenTerms: z.array(text(80)).max(30),
});
const projectJobSchema = z
  .strictObject({
    ...metadata,
    priority: z.enum(["low", "normal", "high"]).optional(),
    detachedSessionIds: z.array(id).max(1000).optional(),
    kind: z.literal("project").optional(),
    title: text(300),
    request: text(16000),
    projectId: id,
    projectIds: z.array(id).min(1).max(20).optional(),
    status: z.enum([
      "queued",
      "planning",
      "running",
      "stalled",
      "waiting",
      "done",
      "failed",
      "paused",
      "cancelled",
    ]),
    goalId: id.optional(),
    awaitingOwnerRestart: z.boolean().optional(),
    pendingTaskDeletion: z.boolean().optional(),
    taskIds: z.array(id).max(1000),
    sessionIds: z.array(id).max(1000),
    progress: z.strictObject({ done: version, total: version }),
    summary: z.string().max(4000),
    tokens: version,
    tokensComplete: z.boolean().optional(),
    idempotencyKey: id,
    dispatchState: z.enum(["pending", "submitted", "unknown"]),
  })
  .refine(
    (job) =>
      !job.detachedSessionIds || job.detachedSessionIds.every((id) => job.sessionIds.includes(id)),
  );
const quickJobSchema = z.strictObject({
  ...metadata,
  kind: z.literal("quick"),
  title: text(300),
  request: text(16000),
  projectId: z.null(),
  projectIds: z.array(id).max(0),
  status: z.enum(["queued", "running", "waiting", "done", "failed", "paused", "cancelled"]),
  taskIds: z.array(id).max(0),
  sessionIds: z.array(id).max(0),
  progress: z.strictObject({ done: version, total: version }),
  summary: z.string().max(4000),
  tokens: z.literal(0),
  tokensComplete: z.boolean().optional(),
  idempotencyKey: id,
  dispatchState: z.enum(["pending", "submitted", "unknown"]),
  quickAction: quickNoteActionSchema,
  quickResult: z.strictObject({ noteId: id }).optional(),
});
const quickAutomationJobSchema = z
  .strictObject({
    ...metadata,
    kind: z.literal("quick"),
    title: text(300),
    request: text(16000),
    projectId: id,
    projectIds: z.array(id).min(1).max(1),
    status: z.enum(["queued", "running", "waiting", "done", "failed", "paused", "cancelled"]),
    taskIds: z.array(id).max(0),
    sessionIds: z.array(id).max(0),
    progress: z.strictObject({ done: version, total: version }),
    summary: z.string().max(4000),
    tokens: z.literal(0),
    tokensComplete: z.boolean().optional(),
    idempotencyKey: id,
    dispatchState: z.enum(["pending", "submitted", "unknown"]),
    quickAction: quickAutomationActionSchema,
    quickResult: z.strictObject({ automationId: id }).optional(),
    quickIntent: z.strictObject({ automationId: id }).optional(),
  })
  .refine(
    (job) => job.projectId === job.quickAction.projectId && job.projectIds[0] === job.projectId,
  );
const jobSchema = z.union([projectJobSchema, quickJobSchema, quickAutomationJobSchema]);
const threadSchema = z.strictObject({
  ...metadata,
  projectId: id.optional(),
  summary: z.string().max(6000),
  summaryProof: AssistantThreadSummaryProofSchema.optional(),
  summaryState: AssistantThreadSummaryStateSchema.optional(),
});
const messageSchema = z.strictObject({
  ...metadata,
  projectIds: z.array(id).max(1000).optional(),
  visibilityProjectIds: z.array(id).max(1000).optional(),
  unverifiedToolContext: z.literal(true).optional(),
  toolActions: z
    .array(
      z.strictObject({
        id,
        family: text(80),
        action: text(120),
        status: z.enum(["completed", "unknown"]),
        createdAt: version,
      }),
    )
    .max(20)
    .optional(),
  ownerQuestionId: id.optional(),
  ownerQuestionRequestId: id.optional(),
  ownerQuestionAction: z.enum(["answer", "snooze"]).optional(),
  threadId: id,
  role: z.enum(["user", "assistant"]),
  via: z.enum(["text", "voice"]),
  text: text(16000),
  sessionId: id.optional(),
  jobIds: z.array(id).max(20),
});
const activitySchema = z.strictObject({
  ...metadata,
  kind: text(100),
  summary: z.string().max(4000),
  ownerQuestionId: id.optional(),
  jobId: id.optional(),
  supervisionId: id.optional(),
  sessionId: id.optional(),
  tokens: version.optional(),
});
const noteSchema = z.strictObject({
  id,
  title: z.string().max(300),
  body: z.string().max(100000),
  tags: z.array(z.string().max(100)).max(100),
  updatedAt: version,
  createdAt: version,
});
export const AssistantSnapshotSchema = z.strictObject({
  keepAwake: z
    .strictObject({
      supported: z.boolean(),
      requested: z.boolean(),
      active: z.boolean(),
      error: z.string().optional(),
    })
    .optional(),
  workHoursActive: z.boolean().optional(),
  ownerQuestions: z.array(AssistantOwnerQuestionSchema).max(40).optional(),
  profile: profileSchema,
  jobs: z.array(jobSchema).max(100),
  memory: z.array(memorySchema).max(100),
  threads: z.array(threadSchema).max(100),
  activity: z.array(activitySchema).max(100),
  notes: z.array(noteSchema).max(100),
  trash: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(["jobs", "memory", "activity", "messages", "notetrash"]),
        projectId: id.nullable().optional(),
        projectIds: z.array(id).max(1000).optional(),
        title: z.string().max(300),
        deletedAt: version,
        expiresAt: version,
        deletedTaskCount: z.number().int().min(0).max(1000).optional(),
      }),
    )
    .max(100),
  presence: z.strictObject({
    state: z.enum(["present", "idle", "away", "dnd"]),
    since: version,
    updatedAt: version,
  }),
  automaticPresence: z
    .strictObject({
      state: z.enum(["present", "idle", "away", "locked"]),
      since: version,
      updatedAt: version,
      supported: z.boolean(),
      idleMs: version.optional(),
    })
    .optional(),
  effectivePresence: z.enum(["present", "idle", "away", "dnd"]).optional(),
  chiefReview: z.strictObject({ blocked: z.boolean(), message: z.string().max(1000) }).optional(),
  manualPolicy: manualPolicySchema.optional(),
  manualGrants: z.array(manualGrantSchema).max(100).optional(),
  briefingSchedule: z.strictObject({ enabled: z.boolean(), time: z.string().max(5) }).optional(),
  notifications: z
    .array(
      z.strictObject({
        id,
        kind: AssistantNotificationKindSchema,
        title: z.string().max(200),
        body: z.string().max(2000),
        createdAt: version,
        jobId: id.optional(),
        taskId: id.optional(),
        taskCreatedAt: version.optional(),
        projectId: id.optional(),
        projectIds: z.array(id).max(1000).optional(),
        eligible: z.boolean(),
        deferredReason: z.enum(["quiet", "away", "idle", "dnd", "unknown", "settings"]).nullable(),
      }),
    )
    .max(100)
    .optional(),
  usage: z.strictObject({
    cacheUsage: z
      .strictObject({
        scope: z.literal("worker-turns"),
        measuredTurns: version,
        totalTurns: version,
        percentageTurns: version,
        cacheReadTokens: version.optional(),
        cacheWriteTokens: version.optional(),
        cacheHitPercent: z.number().min(0).max(100).optional(),
        complete: z.boolean(),
      })
      .optional(),
    day: text(20),
    chiefTokens: version,
    workerTokens: version,
    total: version,
    mode: z.enum(["run", "report", "paused"]),
    estimated: z.boolean(),
    workerUsageIncomplete: z.boolean().optional(),
    observedWorkerTokens: version.optional(),
    reservedWorkerTokens: version.optional(),
  }),
  paused: z.boolean(),
  lastHeartbeatAt: version.nullable(),
  conversationRetentionDays: retentionDays.optional(),
  lastSpokenLanguage: z.string().nullable().optional(),
  briefing: z
    .strictObject({
      id,
      text: z.string().max(6000),
      createdAt: version,
      projectIds: z.array(id).max(1000).optional(),
      voiceReceipt: z
        .strictObject({
          reason: z.literal("return"),
          returnAt: version,
          meaningful: z.boolean(),
          important: z.boolean(),
        })
        .optional(),
    })
    .nullable(),
  notesError: z.string().max(2000).optional(),
  jobHolds: z.record(id, AssistantJobHoldReasonSchema).optional(),
  capabilities: z.strictObject({
    jobs: z.boolean(),
    chief: z.boolean(),
    notes: z.boolean(),
    quickNotes: z.boolean().optional(),
    quickAutomations: z.boolean().optional(),
    observationTasks: z.boolean().optional(),
    conversations: z.boolean(),
  }),
});
export const AssistantResponseValidationSchema = z.strictObject({
  sendIdentity: z.strictObject({ instanceId: id }).optional(),
  narrationEvents: z
    .array(
      z.strictObject({
        eventId: id,
        kind: z.enum(["progress", "completed", "question", "reminder"]),
        text: z.string().max(8000),
        createdAt: z.number(),
      }),
    )
    .max(20)
    .optional(),
  narrationClaimed: z.boolean().optional(),
  sendReceipt: z
    .strictObject({ status: z.enum(["settled", "unknown", "refused", "notSent"]) })
    .optional(),
  observationDeliveries: z
    .array(
      z.strictObject({
        notificationId: id,
        projectId: id,
        state: z.enum(["pending", "unknown", "accepted", "suppressed"]),
      }),
    )
    .max(100)
    .optional(),
  voiceContext: AssistantVoiceContextSchema.optional(),
  ownerQuestion: AssistantOwnerQuestionSchema.nullable().optional(),
  ownerQuestionReceipt: AssistantOwnerQuestionReceiptSchema.optional(),
  snapshot: AssistantSnapshotSchema.optional(),
  manual: z
    .strictObject({
      policy: manualPolicySchema,
      grants: z.array(manualGrantSchema).max(100),
      candidates: z.array(manualCandidateSchema).max(100),
    })
    .optional(),
  profile: profileSchema.optional(),
  modelPool: AssistantModelPoolResponseSchema.optional(),
  assistantFolders: AssistantFoldersResponseSchema.optional(),
  alwaysOn: AssistantAlwaysOnSchema.optional(),
  reminders: AssistantRemindersResponseSchema.optional(),
  memory: memorySchema.optional(),
  entries: z.array(memorySchema).max(100).optional(),
  thread: threadSchema.optional(),
  messages: z.array(messageSchema).max(100).optional(),
  message: messageSchema.optional(),
  job: jobSchema.optional(),
  jobActivity: z.array(activitySchema).max(200).optional(),
  note: noteSchema.nullable().optional(),
  projects: z
    .array(z.strictObject({ id, path: z.string().max(4096), name: z.string().max(300) }))
    .max(1000)
    .optional(),
  ok: z.boolean().optional(),
  trashId: id.optional(),
  deleteReview: deleteReviewSchema.optional(),
});
/** Canonical wire export currently represents string constraints only through
 * its shared identifier patterns. Keep exact domain bounds in the validation
 * schemas above; omit non-representable lengths, regex/custom predicates only
 * from this structural projection. Strict domain validation still runs first.
 * No checks in the central exporter or in the service admission are relaxed. */
function assistantWireSchema<T extends z.ZodType>(schema: T): T {
  const definition = schema._zod.def as unknown as Record<string, unknown>;
  if (definition.type === "nonoptional") {
    const inner = definition.innerType as z.ZodType;
    const innerDefinition = inner._zod.def as unknown as Record<string, unknown>;
    return assistantWireSchema(
      (innerDefinition.type === "optional" ? innerDefinition.innerType : inner) as z.ZodType,
    ) as T;
  }
  const next = { ...definition };
  if (Array.isArray(definition.checks))
    next.checks = (
      definition.checks as { _zod: { def: { check: string; format?: string } } }[]
    ).filter(
      (check) =>
        check._zod.def.check !== "custom" &&
        !(
          definition.type === "string" &&
          (["min_length", "max_length"].includes(check._zod.def.check) ||
            (check._zod.def.check === "string_format" && check._zod.def.format === "regex"))
        ),
    );
  if (definition.type === "object")
    next.shape = Object.fromEntries(
      Object.entries(definition.shape as Record<string, z.ZodType>).map(([key, value]) => [
        key,
        assistantWireSchema(value),
      ]),
    );
  if (definition.type === "union")
    next.options = (definition.options as z.ZodType[]).map((option) => assistantWireSchema(option));
  for (const key of ["element", "innerType", "keyType", "valueType"])
    if (definition[key] && typeof definition[key] === "object" && "_zod" in definition[key])
      next[key] = assistantWireSchema(definition[key] as z.ZodType);
  return schema.clone(next as never) as T;
}
export const AssistantRequestSchema = assistantWireSchema(AssistantRequestValidationSchema);
export const AssistantResponseSchema = assistantWireSchema(AssistantResponseValidationSchema);
