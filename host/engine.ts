import { EngineOperations } from "./engine-operations";
import { createHash, randomUUID } from "node:crypto";
import { parseProviderAccountId } from "../src/features/providers/model/providerAccountId";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, dirname, join } from "node:path";
import { HostCheckpoints } from "./checkpoints";
import type { TurnGitHistory } from "./workspace-service-contracts";
import type { ConversationRewindAdapter } from "./session-rewind";
import { durableWrite, refComponent } from "./turn-git-history";
import { previewContextualSession } from "./contextual-session";
import {
  composeNoteContext,
  noteContextMeta,
  readNoteContext,
} from "../src/features/notes/noteContext";
import { isEditTool } from "../src/integrations/harness/core/preview";
import { homedir } from "node:os";
import { HandoffHistoryStore } from "./handoff-history";
import { buildBudgetedHandoff, handoffHistory } from "../src/features/sessions/model/handoffBudget";
import { renameHostWorktreeBranch, resolveHostWorktree } from "./git-worktrees";
import {
  applyHarnessEvent,
  promoteLastAssistantToPlan,
  stopStreaming,
} from "../src/integrations/harness/core/apply";
import {
  approvedPlanForMessage,
  buildPlanPrompt,
  isBuildablePlan,
  planTurnPrompt,
} from "../src/features/sessions/model/plan";
import { changedBlocks, type BlockChanges } from "../src/features/sessions/model/blockChanges";
import { modelBelongsToHarness, resolveModel } from "../src/features/sessions/model/models";
import {
  appendReadyHandoff,
  buildDeterministicHandoff,
  consumeHandoff,
  pendingHandoff,
  planComposerSwitch,
} from "../src/features/sessions/model/handoff";
import { isVisionImage } from "../src/features/sessions/model/attachments";
import { isSessionErrorBlock } from "../src/features/sessions/model/sessionIssue";
import { adoptedTranscriptLead } from "../src/features/connections/model/adoptedSessions";
import { transcriptDigests } from "../src/features/sync/model/conversationDigest";
import { LeaseHeldError } from "../src/features/sync/model/runLease";
import {
  atHead,
  chooseBase,
  headOfDigests,
  reconcile,
  type Reconciled,
} from "../src/features/sync/model/conversationHead";
import type {
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
} from "../src/integrations/harness/core/types";
import {
  HARNESS_LABEL,
  RUNTIME_MODES,
  canReplaceSessionTitle,
  formatSessionTitle,
  titleFromPrompt,
  type Session,
  type SecondOpinionMeta,
} from "../src/features/sessions/model/session";
import { namedWorktreeBranch } from "../src/features/source-control/model/worktrees";
import {
  isRemoteProvider,
  type HostCommand,
  type HostSession,
  type CommandReceipt,
  type RemoteProvider,
  type ContextualSessionInput,
} from "../src/features/connections/model/protocol";
import type { HostProvider } from "./providers";
import { HostStore } from "./store";
import { parseRemoteAttachments, resolveAttachments } from "./attachments";
import { runHostShell } from "./shell";
import { isTaskWorktreeRemoving } from "./task-worktree-cleanup";
import { prepareHostSkillPrompt } from "./prompt-skills";
import {
  forgetRuntimeHint,
  harnessRuntimeHints,
  markRuntimeHintDelivered,
  pendingRuntimeHint,
  turnCarriesRuntimeHint,
  withRuntimeHint,
} from "../src/integrations/harness/core/runtimeGuidance";
import {
  canRewindConversation,
  markConversationTurnStopped,
  buildConversationReplay,
  conversationReplayPrompt,
  rewindConversationBeforeMessage,
} from "../src/features/sessions/model/conversationRewind";
import { conversationRewindStrategy } from "../src/features/sessions/model/conversationRewindStrategy";
import {
  canClearConversation,
  clearConversation,
} from "../src/features/sessions/model/clearConversation";
import { isClearSessionCommand } from "../src/features/sessions/model/newSessionCommand";
import {
  SHELL_COMMAND_LIMIT,
  finishShellBlock,
  interruptShellBlock,
  pendingShellRuns,
  shellBlock,
  withShellContext,
  type ShellResult,
} from "../src/features/sessions/model/shellRun";

// Streamed output is written in batches. Anything a user may need to act on
// (approvals, questions, errors, completion) is written immediately.
const FLUSH_MS = 120;
function assertModelProvider(harness: RemoteProvider, model: string): void {
  if (!modelBelongsToHarness(harness, model))
    throw new Error(
      `Model "${model}" does not belong to provider "${harness}". Select a matching provider and model.`,
    );
}
const BATCHED = new Set<string>([
  "message.delta",
  "reasoning.delta",
  "tool.updated",
  "agent.step",
  "status",
]);

const text = (value: unknown, label: string, max = 128): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${label}`);
  return value;
};

function modelSettings(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model settings");
  const entries = Object.entries(value);
  if (
    entries.length > 20 ||
    entries.some(
      ([key, setting]) =>
        !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ||
        typeof setting !== "string" ||
        setting.length > 128 ||
        setting.includes("\0"),
    )
  )
    throw new Error("Invalid model settings");
  return Object.fromEntries(entries) as Record<string, string>;
}

function contextualInput(v: Record<string, unknown>): ContextualSessionInput {
  if (
    !isRemoteProvider(v.harness) ||
    !["handoff", "secondOpinion"].includes(String(v.mode)) ||
    !Number.isSafeInteger(v.expectedRevision) ||
    Number(v.expectedRevision) < 0
  )
    throw new Error("Invalid contextual session request");
  if (
    v.providerAccountId !== undefined ||
    (v.account !== undefined && v.account !== "host-default")
  )
    throw new Error("Only the host default account is supported for contextual sessions");
  return {
    sessionId: text(v.sessionId, "source session ID"),
    sourceBlockId: text(v.sourceBlockId, "source reply ID"),
    expectedRevision: Number(v.expectedRevision),
    mode: v.mode as ContextualSessionInput["mode"],
    harness: v.harness,
    model: text(v.model, "model", 200),
    modelSettings: modelSettings(v.modelSettings),
  };
}

function secondOpinionMeta(value: unknown): SecondOpinionMeta | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid second opinion metadata");
  const row = value as Record<string, unknown>;
  if (
    !isRemoteProvider(row.from) ||
    !isRemoteProvider(row.to) ||
    (row.kind !== undefined && row.kind !== "handoff") ||
    (row.request !== undefined && (typeof row.request !== "string" || row.request.length > 240)) ||
    (row.files !== undefined &&
      (!Number.isSafeInteger(row.files) || Number(row.files) < 0 || Number(row.files) > 40))
  )
    throw new Error("Invalid second opinion metadata");
  return {
    from: row.from,
    to: row.to,
    ...(row.request ? { request: row.request as string } : {}),
    ...(row.files !== undefined ? { files: Number(row.files) } : {}),
    ...(row.kind ? { kind: "handoff" as const } : {}),
  };
}

export function parseCommand(input: unknown): HostCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid command");
  const v = input as Record<string, unknown>;
  const commandId = text(v.commandId, "command ID");
  if (
    v.noteCard !== undefined &&
    (v.type !== "send" ||
      v.queued !== undefined ||
      typeof v.text !== "string" ||
      /^\s*\/(?:clear|compact|new|plan)(?:\s|$)/i.test(v.text))
  )
    throw new Error("Send note context as a new regular message");
  if (v.type === "create") {
    if (
      v.workspaceMode !== undefined &&
      v.workspaceMode !== "current" &&
      v.workspaceMode !== "worktree"
    )
      throw new Error("Invalid workspace mode");
    if (!isRemoteProvider(v.harness) || !RUNTIME_MODES.includes(v.runtimeMode as never))
      throw new Error("Invalid provider or permission mode");
    if (
      v.autoWorktreeBranch !== undefined &&
      (v.worktreeCwd === undefined ||
        typeof v.autoWorktreeBranch !== "string" ||
        !/^mc\/[a-z0-9]{8}$/.test(v.autoWorktreeBranch))
    )
      throw new Error("Invalid automatically created worktree branch");
    return {
      type: "create",
      commandId,
      projectId: text(v.projectId, "project ID"),
      ...(v.sessionId !== undefined ? { sessionId: text(v.sessionId, "session ID", 128) } : {}),
      ...(v.workspaceId !== undefined ? { workspaceId: text(v.workspaceId, "workspace ID") } : {}),
      ...(v.workspaceMode !== undefined
        ? { workspaceMode: v.workspaceMode as "current" | "worktree" }
        : {}),
      ...(v.worktreeCwd !== undefined
        ? { worktreeCwd: text(v.worktreeCwd, "working copy", 4096) }
        : {}),
      ...(v.autoWorktreeBranch !== undefined
        ? { autoWorktreeBranch: v.autoWorktreeBranch as string }
        : {}),
      harness: v.harness,
      ...(v.providerAccountId === undefined
        ? {}
        : { providerAccountId: parseProviderAccountId(v.providerAccountId, v.harness) }),
      model: text(v.model, "model", 200),
      ...(v.modelSettings !== undefined ? { modelSettings: modelSettings(v.modelSettings) } : {}),
      runtimeMode: v.runtimeMode as Session["runtimeMode"],
    };
  }
  const sessionId = text(v.sessionId, "session ID");
  if (v.type === "contextual")
    return {
      type: "contextual",
      commandId,
      ...contextualInput(v),
      previewDigest: text(v.previewDigest, "reviewed context digest", 64),
    };
  if (v.type === "configure") {
    if (v.harness !== undefined && !isRemoteProvider(v.harness))
      throw new Error("Invalid provider");
    if (!RUNTIME_MODES.includes(v.runtimeMode as never)) throw new Error("Invalid permission mode");
    return {
      type: "configure",
      commandId,
      sessionId,
      ...(v.harness !== undefined ? { harness: v.harness as RemoteProvider } : {}),
      model: text(v.model, "model", 200),
      modelSettings: modelSettings(v.modelSettings),
      runtimeMode: v.runtimeMode as Session["runtimeMode"],
    };
  }
  if (v.resumeAtReset !== undefined && typeof v.resumeAtReset !== "boolean")
    throw new Error("Invalid resume at reset setting");
  const resumeAtReset =
    (v.type === "send" || v.type === "compact") && typeof v.resumeAtReset === "boolean"
      ? { resumeAtReset: v.resumeAtReset }
      : {};
  if (v.type === "compact") return { type: "compact", commandId, sessionId, ...resumeAtReset };
  if (v.type === "usageLimit") {
    if (!["arm", "disarm", "dismiss"].includes(String(v.action)))
      throw new Error("Invalid usage limit action");
    return {
      type: "usageLimit",
      commandId,
      sessionId,
      action: v.action as "arm" | "disarm" | "dismiss",
    };
  }
  if (v.type === "send" || v.type === "draft" || v.type === "steer") {
    if (
      v.noteCard !== undefined &&
      (v.type !== "send" ||
        (v.intent && v.intent !== "default") ||
        v.planBlockId ||
        v.draftBlockId ||
        v.secondOpinion)
    )
      throw new Error("Send note context as a new regular message");
    const noteCard = v.noteCard === undefined ? undefined : readNoteContext(v.noteCard);
    const attachments = parseRemoteAttachments(v.attachments);
    if (
      typeof v.text !== "string" ||
      v.text.length > 256_000 ||
      v.text.includes("\0") ||
      (!v.text.trim() &&
        !noteCard &&
        attachments.length === 0 &&
        !(v.type === "send" && v.draftBlockId !== undefined))
    )
      throw new Error("Invalid prompt");
    if (
      v.type === "send" &&
      v.intent !== undefined &&
      !["default", "plan", "build"].includes(String(v.intent))
    )
      throw new Error("Invalid turn intent");
    if (v.planBlockId !== undefined && (v.type !== "send" || v.intent !== "build"))
      throw new Error("Invalid plan build");
    if (
      v.expectedPlanText !== undefined &&
      (v.type !== "send" ||
        v.intent !== "build" ||
        !v.planBlockId ||
        typeof v.expectedPlanText !== "string" ||
        v.expectedPlanText.length > 256_000 ||
        v.expectedPlanText.includes("\0") ||
        v.draftBlockId !== undefined ||
        attachments.length > 0)
    )
      throw new Error("Invalid reviewed plan");
    if (v.type === "steer")
      return {
        type: "steer",
        commandId,
        sessionId,
        runId: text(v.runId, "run ID"),
        text: v.text,
        ...(attachments.length ? { attachments } : {}),
      };
    return {
      type: v.type,
      commandId,
      sessionId,
      ...resumeAtReset,
      text: v.text,
      ...(attachments.length ? { attachments } : {}),
      ...(v.type === "send" && v.intent
        ? { intent: v.intent as "default" | "plan" | "build" }
        : {}),
      ...(v.type === "send" && v.draftBlockId !== undefined
        ? { draftBlockId: text(v.draftBlockId, "draft block ID") }
        : {}),
      ...(v.type === "send" && v.planBlockId !== undefined
        ? { planBlockId: text(v.planBlockId, "plan block ID") }
        : {}),
      ...(v.type === "send" && v.expectedPlanText !== undefined
        ? { expectedPlanText: v.expectedPlanText as string }
        : {}),
      ...(v.type === "send" && v.secondOpinion !== undefined
        ? { secondOpinion: secondOpinionMeta(v.secondOpinion) }
        : {}),
      ...(v.type === "send" && noteCard ? { noteCard } : {}),
    };
  }
  if (v.type === "removeDraft")
    return {
      type: "removeDraft",
      commandId,
      sessionId,
      draftBlockId: text(v.draftBlockId, "draft block ID"),
    };
  if (v.type === "rewind") {
    if (
      v.expectedRevision !== undefined &&
      (!Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0)
    )
      throw new Error("Invalid expected session revision");
    return {
      type: "rewind",
      commandId,
      sessionId,
      blockId: text(v.blockId, "message block ID"),
      ...(v.expectedRevision === undefined ? {} : { expectedRevision: Number(v.expectedRevision) }),
    };
  }
  if (v.type === "shell")
    return {
      type: "shell",
      commandId,
      sessionId,
      line: text(v.line, "shell command", SHELL_COMMAND_LIMIT),
    };
  const runId = text(v.runId, "run ID");
  if (v.type === "stopItem")
    return {
      type: "stopItem",
      commandId,
      sessionId,
      runId,
      blockId: text(v.blockId, "agent block ID"),
      callId: text(v.callId, "agent call ID"),
    };
  if (v.type === "cancel") return { type: "cancel", commandId, sessionId, runId };
  if (!Number.isSafeInteger(v.requestId) || Number(v.requestId) < 0)
    throw new Error("Invalid request ID");
  const requestId = Number(v.requestId);
  if (v.type === "approve" && (v.decision === "allow" || v.decision === "deny"))
    return {
      type: "approve",
      commandId,
      sessionId,
      runId,
      requestId,
      decision: v.decision,
    };
  if (v.type === "answer") {
    const reply = v.reply as { kind?: string; answers?: unknown; custom?: unknown } | undefined;
    if (reply?.kind === "skipped")
      return {
        type: "answer",
        commandId,
        sessionId,
        runId,
        requestId,
        reply: { kind: "skipped" },
      };
    if (
      reply?.kind === "answered" &&
      reply.answers &&
      typeof reply.answers === "object" &&
      !Array.isArray(reply.answers)
    ) {
      const entries = Object.entries(reply.answers);
      if (
        entries.length > 50 ||
        entries.some(
          ([key, value]) =>
            key.length > 200 ||
            !Array.isArray(value) ||
            value.length > 50 ||
            value.some((x) => typeof x !== "string" || x.length > 10_000),
        )
      )
        throw new Error("Invalid question answers");
      if (
        reply.custom != null &&
        (typeof reply.custom !== "object" ||
          Array.isArray(reply.custom) ||
          Object.values(reply.custom).some((x) => typeof x !== "string" || x.length > 10_000))
      )
        throw new Error("Invalid custom answers");
      return {
        type: "answer",
        commandId,
        sessionId,
        runId,
        requestId,
        reply: {
          kind: "answered",
          answers: Object.fromEntries(entries),
          ...(reply.custom ? { custom: reply.custom as Record<string, string> } : {}),
        },
      };
    }
  }
  throw new Error("Unsupported command");
}

/** S1 supplies registry identity; S2 supplies capture and the durable recovery fence.
 * The resolver must reject unknown/broken managed ownership rather than return legacy.
 */
export interface ManagedTurnHistoryAdapter {
  history: TurnGitHistory;
  workspaceForSession(value: HostSession): Promise<{ workspaceId: string; path?: string } | null>;
  assertWritable(workspaceId: string): Promise<void>;
  prepareWorkspaceForCreate?(request: {
    projectId: string;
    sessionId: string;
    idempotencyKey: string;
    workspaceMode?: "current" | "worktree";
  }): Promise<{ workspaceId: string } | null>;
  workspaceForCreate?(request: {
    projectId: string;
    workspaceId: string;
    worktreeCwd?: string;
  }): Promise<{
    workspaceId: string;
    path: string;
    branchRef: string;
    revision: number;
    /** A session-owned workspace was prepared against this stable identity. */
    sessionId?: string;
  }>;
  /** The shared reservation gate holds this activity until the process settles. */
  startActivity?(value: HostSession, kind: "provider" | "shell"): Promise<() => Promise<void>>;
  /** A contextual handoff or second opinion is a separate scheduled writer. */
  prepareContextualWorkspace?(request: {
    source: HostSession;
    sessionId: string;
    idempotencyKey: string;
  }): Promise<{ workspaceId: string }>;
}

type ManagedTurnBoundary = {
  workspaceId: string;
  sessionId: string;
  userBlockId: string;
  runId: string;
};

export class HostEngine {
  private readonly operations = new EngineOperations();
  private switchingProjects = new Set<string>();
  private running = new Map<
    string,
    {
      runId: string;
      priorBlockIds: Set<string>;
      ready: Promise<void>;
      steers: Promise<void>;
      done: Promise<void>;
      cancelled: boolean;
      ending: boolean;
      persistenceFailed: boolean;
      resumeAtReset?: boolean;
      managedTurns: ManagedTurnBoundary[];
      managed: boolean;
      releaseActivity?: () => Promise<void>;
    }
  >();
  /** Running sessions, including streamed events not yet written to disk. */
  private live = new Map<
    string,
    {
      value: HostSession;
      events: HarnessEvent[];
      blockChanges?: Map<string, import("../src/features/sessions/model/session").Block | null>;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryWork = new Map<string, Promise<void>>();
  private closing = false;
  private closePromise?: Promise<void>;
  /** A turn ended and the session is idle again, and how it ended (the host drains its queue). */
  onSettled?: (
    sessionId: string,
    outcome: { cancelled?: boolean; error?: string; interrupted?: boolean; reason?: string },
  ) => void | Promise<void>;
  /** Conversations whose turn was found running at startup and settled as interrupted. */
  readonly recoveredInterrupted: string[] = [];
  /** A rewind, clear or branch switch ended: conversations waiting on it may go on. */
  onUnblocked?: () => void;
  /** Why a turn cannot start in this conversation right now, apart from one running in it. */
  async busyReason(sessionId: string): Promise<string | undefined> {
    await this.ready;
    if (this.closing) return "Host is stopping";
    if (this.rewinding.has(sessionId)) return "A conversation change is in progress";
    try {
      const value = await this.store.session(sessionId);
      await this.managedWorkspace(value);
      if (this.switchingProjects.has(value.projectId)) return "A branch switch is in progress";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return undefined;
  }
  private rewinding = new Set<string>();
  readonly checkpoints: HostCheckpoints;

  constructor(
    readonly store: HostStore,
    private readonly providers: Partial<Record<RemoteProvider, HostProvider>>,
    private readonly shell: (cwd: string, command: string) => Promise<ShellResult> = runHostShell,
    private managedTurns?: ManagedTurnHistoryAdapter,
  ) {
    const checkpointRoot = join(dirname(store.attachmentDir), "checkpoints");
    this.checkpoints = new HostCheckpoints(
      checkpointRoot,
      process.env.VITEST ? undefined : join(homedir(), ".bycoda-host", "checkpoint-active"),
    );
    this.ready = this.initialize();
  }

  readonly ready: Promise<void>;

  /** Server composition attaches the one shared service graph before accepting writes. */
  setManagedTurnHistoryAdapter(adapter: ManagedTurnHistoryAdapter): void {
    if (this.running.size || this.managedTurns)
      throw new Error("Managed execution services are already attached or running");
    this.managedTurns = adapter;
  }

  /** Run only after durable workspace recovery, before starting schedulers/transports. */
  async recoverManagedStartup(): Promise<void> {
    await this.ready;
    await this.initialize(true);
  }

  private async executionActivity(value: HostSession, kind: "provider" | "shell") {
    if (isTaskWorktreeRemoving(value.session.worktreeCwd ?? value.session.cwd))
      throw new Error("The task checkout is being removed; wait before starting work");
    await this.managedWorkspace(value);
    return this.managedTurns?.startActivity?.(value, kind);
  }

  private async managedWorkspace(value: HostSession) {
    const session = value.session as Session & {
      workspaceId?: string;
      managedWorkspaceId?: string;
    };
    const managedId = session.managedWorkspaceId ?? session.workspaceId;
    const workspace = await this.managedTurns?.workspaceForSession(value);
    if (managedId && workspace?.workspaceId !== managedId)
      throw new Error(
        "Managed workspace execution requires its authoritative turn-history adapter",
      );
    if (workspace) await this.managedTurns!.assertWritable(workspace.workspaceId);
    return workspace;
  }

  private async beginManagedTurn(value: HostSession, userBlockId: string) {
    const workspace = await this.managedWorkspace(value);
    if (!workspace) return undefined;
    const boundary = {
      workspaceId: workspace.workspaceId,
      sessionId: value.session.id,
      userBlockId,
      runId: value.runId!,
    };
    const record = await this.managedTurns!.history.begin({
      ...boundary,
      conversationRevision: value.revision,
    });
    if (record.before.status !== "complete")
      throw new Error(
        `Turn Git capture blocked: ${record.before.reason}. Retry after resolving it.`,
      );
    return boundary;
  }

  /** Local HostStore side of the same protocol used by the native receipt bridge.
   * Rescue files stay outside materialized workspaces; receipts do not expire with RPC receipts.
   */
  conversationRewindAdapter(
    rescueRoot = join(dirname(this.store.attachmentDir), "rewind-transcripts"),
  ): ConversationRewindAdapter {
    let schema: Promise<void> | undefined;
    const initialize = () =>
      (schema ??= this.store.db.scope(() =>
        this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_rewind_receipts (
        operation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        signature TEXT NOT NULL, revision INTEGER NOT NULL
      )`),
      ));
    const path = (operationId: string) => join(rescueRoot, `${refComponent(operationId)}.json`);
    const receipt = async (operationId: string) => {
      await initialize();
      const row = await this.store.db.scope(() =>
        this.store.db
          .prepare("SELECT revision FROM managed_rewind_receipts WHERE operation_id=?")
          .get(operationId),
      );
      return row ? { revision: Number(row.revision) } : null;
    };
    return {
      read: async (sessionId) => {
        await this.ready;
        await this.flush(sessionId);
        const value = await this.store.session(sessionId);
        return {
          revision: value.revision,
          userBlockIds: value.session.blocks
            .filter((block) => block.role === "user" && !block.draft && !block.internal)
            .map((block) => block.id),
        };
      },
      settle: async (sessionId) => {
        await this.ready;
        const initial = await this.store.session(sessionId);
        const active = this.running.get(sessionId);
        const provider = this.provider(initial.session.harness);
        if (active) {
          active.cancelled = true;
          await provider.cancel(sessionId);
          await provider.stop(sessionId);
          await active.done;
        } else {
          await provider.stop(sessionId);
        }
        await this.flush(sessionId);
        const latest = await this.store.session(sessionId);
        if (
          this.running.has(sessionId) ||
          latest.status === "running" ||
          latest.session.blocks.some((block) => block.shell?.running) ||
          (latest.session.backgroundTasks?.length ?? 0) > 0 ||
          (latest.session.backgroundAgents ?? 0) > 0 ||
          (latest.session.queuedMessages?.length ?? 0) > 0
        )
          throw new Error("Settle background writers, shells and queued messages before rewinding");
      },
      withSessionGate: async (sessionId, work) => {
        await this.ready;
        if (this.rewinding.has(sessionId))
          throw new Error("Another conversation change is in progress");
        this.rewinding.add(sessionId);
        try {
          await this.flush(sessionId);
          return await work();
        } finally {
          this.rewinding.delete(sessionId);
          this.onUnblocked?.();
        }
      },
      rescue: async (operationId, sessionId, expectedRevision) => {
        await this.ready;
        await this.flush(sessionId);
        const value = await this.store.session(sessionId);
        if (value.revision !== expectedRevision)
          throw new Error("The conversation changed before transcript rescue");
        const existing = await readFile(path(operationId), "utf8").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (existing) {
          const saved = JSON.parse(existing) as { operationId: string; value: HostSession };
          if (saved.operationId !== operationId || saved.value.session.id !== sessionId)
            throw new Error("Transcript rescue ownership mismatch");
          if (saved.value.revision !== expectedRevision)
            throw new Error("Transcript rescue revision does not match the operation");
          return operationId;
        }
        await durableWrite(path(operationId), JSON.stringify({ operationId, value }));
        return operationId;
      },
      restore: async (request) => {
        await this.ready;
        await initialize();
        const signature = createHash("sha256").update(JSON.stringify(request)).digest("hex");
        const rescued =
          request.direction === "undo"
            ? (JSON.parse(await readFile(path(request.transcriptRescueId ?? ""), "utf8")) as {
                operationId: string;
                value: HostSession;
              })
            : undefined;
        if (
          rescued &&
          (rescued.operationId !== request.transcriptRescueId ||
            rescued.value.session.id !== request.sessionId)
        )
          throw new Error("Transcript rescue ownership mismatch");
        const result = await this.store.transaction(async () => {
          const existing = await this.store.db
            .prepare(
              "SELECT session_id, signature, revision FROM managed_rewind_receipts WHERE operation_id=?",
            )
            .get(request.operationId);
          if (existing) {
            if (existing.session_id !== request.sessionId || existing.signature !== signature)
              throw new Error("Rewind operation ID was already used with a different payload");
            return { revision: Number(existing.revision) };
          }
          const latest = await this.store.session(request.sessionId);
          if (
            latest.revision !== request.expectedRevision ||
            latest.status === "running" ||
            this.running.has(request.sessionId)
          )
            throw new Error("The conversation changed; reconcile before rewinding");
          const session = rescued
            ? {
                ...latest.session,
                blocks: rescued.value.session.blocks,
                rewindHistory: rescued.value.session.rewindHistory,
                providerSessionId: undefined,
                pendingContextReplay:
                  buildConversationReplay(rescued.value.session.blocks) || undefined,
                context: undefined,
                usage: undefined,
                usageLimit: undefined,
                retryMessage: undefined,
                pendingQuestion: undefined,
                submittedQuestions: undefined,
                pendingSwitch: undefined,
                queueStatus: undefined,
                queuedMessages: rescued.value.session.queuedMessages,
                editingQueuedMessageId: undefined,
                backgroundTasks: undefined,
                backgroundAgents: undefined,
                runningModelTarget: undefined,
                busy: false,
              }
            : rewindConversationBeforeMessage(latest.session, request.userBlockId, Date.now(), {
                managedWorkspace: true,
                operationId: request.operationId,
              });
          if (session === latest.session)
            throw new Error("This conversation cannot be rewound at the selected message");
          const saved = await this.save(
            { ...latest, session, status: "idle", runId: undefined },
            {
              type: "conversation.gitRewound",
              operationId: request.operationId,
              direction: request.direction,
            },
          );
          await this.store.db
            .prepare(
              "INSERT INTO managed_rewind_receipts (operation_id, session_id, signature, revision) VALUES (?, ?, ?, ?)",
            )
            .run(request.operationId, request.sessionId, signature, saved.revision);
          return { revision: saved.revision };
        });
        forgetRuntimeHint(request.sessionId);
        const live = this.live.get(request.sessionId);
        if (live) live.value = await this.store.session(request.sessionId);
        return result;
      },
      receipt,
    };
  }

  private async initialize(managedOnly = false): Promise<void> {
    await this.store.ready;
    const store = this.store;
    // Provider dispatch is not transactional with SQLite. Never replay a send
    // automatically after a crash; its external effects may already exist.
    // Only sessions that need rewriting are parsed; the rest are bound from
    // mirror columns and their snapshot loads on first access.
    for (const state of await store.startupStates()) {
      if (!this.managedTurns && state.workspaceId) continue;
      if (managedOnly && !state.workspaceId) continue;
      const snapshot =
        this.managedTurns || state.running || state.shellRunning || !state.hasDesktop
          ? await store.session(state.id)
          : undefined;
      // The CLI creates the engine before the shared recovery graph. Never run legacy
      // recovery against a durable managed conversation in that interval.
      if (!this.managedTurns && snapshot?.session.workspaceId) continue;
      const managedValue = this.managedTurns ? snapshot : undefined;
      let managed:
        | Awaited<ReturnType<ManagedTurnHistoryAdapter["workspaceForSession"]>>
        | undefined;
      try {
        managed = managedValue
          ? await this.managedTurns!.workspaceForSession(managedValue)
          : undefined;
      } catch {
        // A retired directory or unresolved ownership remains readable and fenced.
        // Never rewrite its transcript or bind a provider to a legacy fallback cwd.
        // A later explicit operation reports the authoritative resolution failure.
        continue;
      }
      if (managedOnly && !managed) continue;
      if (managed) {
        try {
          await this.managedTurns!.assertWritable(managed.workspaceId);
        } catch {
          // Cross-store rewind recovery owns this transcript until reconciled.
          continue;
        }
      }
      if (state.hasDesktop && !state.shellRunning && !state.running) {
        if (state.providerSessionId && state.harness)
          this.provider(state.harness).bind(
            state.id,
            state.providerSessionId,
            managed?.path ?? state.cwd ?? "",
          );
        continue;
      }
      let value = managedValue ?? (await store.session(state.id));
      // Sessions started here before they were shared with this machine's
      // desktop app become shared too, so the app on this machine lists them.
      if (!value.desktop)
        value = await this.save(
          { ...value, desktop: { updatedAt: 0 } },
          {
            type: "desktopShared",
          },
        );
      // A `!command` cannot outlive the host process that started it.
      if (value.session.blocks.some((block) => block.shell?.running))
        value = await this.save(
          {
            ...value,
            session: {
              ...value.session,
              blocks: value.session.blocks.map((block) =>
                block.shell?.running
                  ? interruptShellBlock(block, "Host restarted before this command finished.")
                  : block,
              ),
            },
          },
          { type: "shell.interrupted" },
        );
      if (value.status === "running") {
        if (!managed) {
          void this.checkpoints
            .recover(value.session.id, value.session.cwd)
            .catch((error) => console.warn("Checkpoint recovery failed", error));
        } else {
          for (const record of await this.managedTurns!.history.list(
            managed.workspaceId,
            value.session.id,
          )) {
            if (!record.after && record.before.status === "complete")
              await this.managedTurns!.history.end({
                workspaceId: managed.workspaceId,
                sessionId: value.session.id,
                userBlockId: record.userBlockId,
                runId: record.runId,
              });
          }
        }
        await this.save(
          this.settled(
            value,
            "interrupted",
            "Host restarted. This turn was interrupted; inspect its work before continuing.",
            value.updatedAt,
          ),
          { type: "interrupted" },
        );
        this.recoveredInterrupted.push(value.session.id);
      }
      if (value.session.providerSessionId)
        this.provider(value.session.harness).bind(
          value.session.id,
          value.session.providerSessionId,
          value.session.cwd,
          value.session.providerAccountId,
        );
    }
  }

  async openProject(path: string) {
    await this.ready;
    if (!isAbsolute(path) || path.includes("\0"))
      throw new Error("Choose an absolute directory path on the host");
    const cwd = await realpath(path);
    if (!(await stat(cwd)).isDirectory()) throw new Error("Project path is not a directory");
    return await this.store.addProject(cwd, basename(cwd));
  }

  async withIdleProject<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    await this.ready;
    if (this.switchingProjects.has(projectId))
      throw new Error("A branch switch is already in progress");
    this.switchingProjects.add(projectId);
    try {
      if (await this.store.hasRunning(projectId))
        throw new Error("Wait for running host sessions before switching branches");
      await this.store.db.checkAuthorization();
      return await action();
    } finally {
      this.switchingProjects.delete(projectId);
      this.onUnblocked?.();
    }
  }

  private provider(id: string): HostProvider {
    const provider = this.providers[id as RemoteProvider];
    if (!provider) throw new Error(`${id} is not available on this host`);
    return provider;
  }

  supportsItemStop(harness: RemoteProvider): boolean {
    return typeof this.providers[harness]?.stopItem === "function";
  }

  async previewContextual(raw: Record<string, unknown>, source?: HostSession) {
    await this.ready;
    const input = contextualInput(raw);
    this.provider(input.harness);
    return previewContextualSession(source ?? (await this.store.session(input.sessionId)), input);
  }

  private async contextualCommand(
    command: Extract<HostCommand, { type: "contextual" }>,
    signature: string,
  ): Promise<CommandReceipt> {
    if (this.rewinding.has(command.sessionId) || this.running.has(command.sessionId))
      throw new Error("Wait for the source conversation to finish before transferring context");
    this.provider(command.harness);
    await this.flush(command.sessionId);
    const source = await this.store.session(command.sessionId);
    const preview = previewContextualSession(source, contextualInput(command), true);
    if (preview.digest !== command.previewDigest)
      throw new Error("The reviewed context changed. Review it again before continuing.");
    await this.managedWorkspace(source);
    const contextualWorkspace = this.managedTurns
      ? await this.managedTurns?.prepareContextualWorkspace?.({
          source,
          // Stable across a crash between workspace creation and transcript acceptance.
          sessionId: createHash("sha256")
            .update(`contextual-session:${command.commandId}`)
            .digest("hex")
            .slice(0, 32),
          idempotencyKey: `contextual:${command.commandId}:workspace`,
        })
      : undefined;
    if (this.managedTurns && !contextualWorkspace)
      throw new Error(
        "Prepare a separate managed workspace before starting this contextual session",
      );
    return await this.store.transaction(async () => {
      const created = await this.command({
        type: "create",
        commandId: `${command.commandId}:create`,
        projectId: source.projectId,
        ...(contextualWorkspace
          ? { workspaceId: contextualWorkspace.workspaceId }
          : { worktreeCwd: preview.cwd }),
        harness: command.harness,
        model: command.model,
        modelSettings: command.modelSettings,
        runtimeMode: source.session.runtimeMode,
      });
      const destination = await this.store.session(created.sessionId);
      const session =
        command.mode === "handoff"
          ? appendReadyHandoff(
              destination.session,
              preview.sourceProvider,
              command.harness,
              preview.contextText,
            )
          : destination.session;
      const prepared = await this.save(
        {
          ...destination,
          session: {
            ...session,
            title: formatSessionTitle(
              command.harness,
              command.mode === "handoff" ? "Handoff" : "Second opinion",
            ),
            ...(!contextualWorkspace && source.session.worktreeCwd
              ? { worktreeCwd: source.session.worktreeCwd }
              : {}),
            ...(!contextualWorkspace && source.session.branch
              ? { branch: source.session.branch }
              : {}),
          },
        },
        {
          type: "session.contextualOrigin",
          sourceSessionId: source.session.id,
          sourceBlockId: command.sourceBlockId,
          sourceRevision: command.expectedRevision,
          previewDigest: preview.digest,
          mode: command.mode,
        },
      );
      const result =
        command.mode === "secondOpinion"
          ? await this.command({
              type: "send",
              commandId: `${command.commandId}:send`,
              sessionId: created.sessionId,
              text: preview.contextText,
              secondOpinion: preview.secondOpinion,
            })
          : {
              commandId: command.commandId,
              sessionId: created.sessionId,
              revision: prepared.revision,
            };
      const receipt = { ...result, commandId: command.commandId };
      await this.store.recordReceipt(signature, receipt);
      return receipt;
    });
  }

  private async save(
    value: HostSession,
    event: unknown,
    deferred = false,
    blockChanges?: BlockChanges,
    journal = false,
  ): Promise<HostSession> {
    return await this.store.transaction(
      async () =>
        await this.store.save(
          { ...value, revision: value.revision + 1, updatedAt: Date.now() },
          event,
          {
            deferred,
            blockChanges,
            journal,
          },
        ),
    );
  }

  /** Takes over a session the desktop app created: same id, then host-owned. */
  async adoptSession(snapshot: HostSession): Promise<HostSession> {
    await this.ready;
    return this.store.db.scope(() =>
      this.operations.run(snapshot.session.id, async () => {
        const id = snapshot.session.id;
        if (this.rewinding.has(id)) throw new Error("A conversation change is in progress");
        const managed = await this.managedWorkspace(snapshot);
        if (managed?.path)
          snapshot = {
            ...snapshot,
            session: { ...snapshot.session, cwd: managed.path, worktreeCwd: managed.path },
          };
        if (snapshot.status === "running") throw new LeaseHeldError("desktop");
        const provider = this.provider(snapshot.session.harness);
        const saved = await this.store.transaction(async () => {
          try {
            return await this.store.session(id);
          } catch {
            // The desktop's bookkeeping about its own host copy stays on the desktop.
            const { adoptedBase: _base, ...session } = snapshot.session;
            const digests = transcriptDigests(session.blocks);
            return await this.store.save(
              {
                ...snapshot,
                session,
                status: "idle",
                desktop: {
                  updatedAt: snapshot.updatedAt,
                  revision: snapshot.revision,
                  // Both hold this transcript now.
                  ...(digests ? { base: headOfDigests(digests) } : {}),
                },
              },
              { type: "adopted" },
            );
          }
        });
        if (saved.session.providerSessionId)
          provider.bind(
            id,
            saved.session.providerSessionId,
            saved.session.cwd,
            saved.session.providerAccountId,
          );
        return saved;
      }),
    );
  }

  /**
   * Catches an adopted session up with turns the desktop app ran since: both
   * resume the same provider conversation. A newer desktop copy replaces the
   * host transcript only when it still contains the host's turns or the host
   * has not changed since it last matched; otherwise the host keeps its turns
   * and the desktop reports the divergence. Leaves a session alone while
   * either side is running a turn.
   */
  /** Whether `refreshFromDesktop` would leave `id` alone right now, checked
   * before the desktop transcript is read. */
  desktopRefreshBlocked(id: string): boolean {
    return this.rewinding.has(id) || this.live.has(id);
  }

  async refreshFromDesktop(snapshot: HostSession): Promise<HostSession | undefined> {
    await this.ready;
    return this.store.db.scope(() =>
      this.operations.run(snapshot.session.id, async () => {
        const id = snapshot.session.id;
        if (this.rewinding.has(id)) return undefined;
        if (snapshot.status === "running" || this.live.has(id)) return undefined;
        const current = await this.store.session(id);
        await this.managedWorkspace(current);
        if (!current.desktop || current.status === "running") return undefined;
        if (snapshot.updatedAt <= current.desktop.updatedAt) return undefined;
        const { session } = snapshot;
        // A copy the desktop saved before this host's latest change, e.g. while
        // the host was still running the turn, holds nothing newer; replacing the
        // transcript with it would drop the turn's output.
        const stale = snapshot.updatedAt <= current.updatedAt;
        // This revision is host-owned. Desktop snapshot revisions are timestamps,
        // not host sequence numbers, so even equal revisions cannot prove equality.
        const synced = current.desktop.revision === current.revision;
        const sameBlocks = () => {
          const incoming = session.blocks;
          const existing = current.session.blocks;
          if (incoming.length !== existing.length) return false;
          const tail = incoming.at(-1);
          const previousTail = existing.at(-1);
          if (
            tail?.id !== previousTail?.id ||
            tail?.role !== previousTail?.role ||
            tail?.text !== previousTail?.text ||
            tail?.streaming !== previousTail?.streaming
          )
            return false;
          // Matching tail metadata (or revisions) says nothing about earlier edits,
          // tool payloads or attachments. Retain the structural fallback for them.
          return JSON.stringify(incoming) === JSON.stringify(existing);
        };
        const same =
          stale ||
          (session.title === current.session.title &&
            session.harness === current.session.harness &&
            session.providerSessionId === current.session.providerSessionId &&
            session.providerAccountId === current.session.providerAccountId &&
            session.model === current.session.model &&
            JSON.stringify(session.modelSettings ?? {}) ===
              JSON.stringify(current.session.modelSettings ?? {}) &&
            session.runtimeMode === current.session.runtimeMode &&
            session.pendingContextReplay === current.session.pendingContextReplay &&
            JSON.stringify(session.pendingSwitch) ===
              JSON.stringify(current.session.pendingSwitch) &&
            sameBlocks());
        // A remote turn or failure recorded here may be absent from a desktop copy
        // saved before it mirrored them. Newer is not enough to replace them; only
        // a failure notice the desktop never saw and has continued past is
        // superseded rather than lost.
        const seen = new Set(session.blocks.map((block) => block.id));
        const unseenFailures = new Set(
          current.session.blocks.filter(
            (block) => isSessionErrorBlock(block) && !seen.has(block.id),
          ),
        );
        // Which side changed since both last held the same transcript, from the
        // digests of the full blocks. Unreadable content falls back to comparing it.
        const mine = transcriptDigests(session.blocks);
        const held = transcriptDigests(current.session.blocks);
        const keptBlocks = current.session.blocks.filter((block) => !unseenFailures.has(block));
        // The desktop names the host transcript it last agreed on (and, when the user
        // kept its version of a divergence, the one it replaced); the host remembers
        // the same. A host that has not moved since one of them has nothing to add.
        // Before the host recorded one, an unchanged revision says the same.
        const base = held
          ? (chooseBase(held, session.adoptedBase, current.desktop.base) ??
            (synced ? headOfDigests(held) : undefined))
          : undefined;
        const hostUnchanged = !!held && !!base && atHead(held, base);
        let verdict: Reconciled | undefined;
        if (mine && held) {
          const compared =
            hostUnchanged || unseenFailures.size === 0 ? held : transcriptDigests(keptBlocks);
          verdict = compared ? reconcile(mine, compared, base) : undefined;
          // The host's own failure notice, which the desktop has not seen, is host content.
          if (verdict === "equal" && compared !== held) verdict = "hostAhead";
        }
        // Content the digests cannot judge, or tell apart (a turn sealed at quit), is
        // compared block by block as before.
        const compare = !same && !synced && (verdict === undefined || verdict === "conflict");
        const lead = compare
          ? adoptedTranscriptLead(session, { ...current.session, blocks: keptBlocks })
          : undefined;
        const accepted =
          !same &&
          (verdict === undefined || verdict === "conflict"
            ? synced || lead === "local" || (lead === "same" && unseenFailures.size === 0)
            : verdict === "localAhead" || (verdict === "equal" && unseenFailures.size === 0));
        if (!same && !accepted) {
          const behind = verdict === undefined || verdict === "conflict" ? lead : verdict;
          console.warn(
            `Kept host transcript for session ${id}: the desktop copy ${behind ? "is behind it" : "diverged"}`,
          );
        }
        const agreed =
          (accepted || verdict === "equal") && mine ? headOfDigests(mine) : current.desktop.base;
        if (accepted) assertModelProvider(session.harness, session.model);
        const saved = await this.save(
          {
            ...current,
            ...(!accepted
              ? {}
              : {
                  status: "idle" as const,
                  session: {
                    ...current.session,
                    title: session.title,
                    harness: session.harness,
                    model: session.model,
                    modelSettings: session.modelSettings,
                    runtimeMode: session.runtimeMode,
                    blocks: session.blocks,
                    providerSessionId: session.providerSessionId,
                    providerAccountId: session.providerAccountId,
                    pendingSwitch: session.pendingSwitch,
                    pendingContextReplay: session.pendingContextReplay,
                    ...(session.harness !== current.session.harness ||
                    session.model !== current.session.model
                      ? { context: session.context, usageLimit: undefined }
                      : {}),
                  },
                }),
            desktop: {
              updatedAt: snapshot.updatedAt,
              // Matching again only when both transcripts are now the same one.
              revision:
                accepted || synced || (same && !stale)
                  ? current.revision + 1
                  : current.desktop.revision,
              // Where both last agreed: the desktop's transcript once taken, or the
              // host's own when the desktop holds the same one.
              ...(agreed ? { base: agreed } : {}),
            },
          },
          { type: accepted ? "desktopRefreshed" : same ? "desktopSeen" : "desktopDiverged" },
        );
        if (accepted) {
          // A desktop provider switch must move its resume identity with its
          // adapter. Otherwise the next mirror sees a third, mixed identity.
          if (
            current.session.harness !== saved.session.harness ||
            current.session.providerSessionId !== saved.session.providerSessionId ||
            current.session.providerAccountId !== saved.session.providerAccountId
          )
            await this.provider(current.session.harness).stop(id);
          if (saved.session.providerSessionId)
            this.provider(saved.session.harness).bind(
              id,
              saved.session.providerSessionId,
              saved.session.cwd,
              saved.session.providerAccountId,
            );
        }
        return saved;
      }),
    );
  }

  async updateSession(id: string, patch: Parameters<HostStore["updateSession"]>[1]) {
    await this.ready;
    return this.store.db.scope(() =>
      this.operations.run(id, async () => {
        if (this.rewinding.has(id)) throw new Error("A conversation change is in progress");
        await this.managedWorkspace(await this.store.session(id));
        await this.flush(id);
        const summary = await this.store.updateSession(id, patch);
        const live = this.live.get(id);
        if (live) live.value = await this.store.session(id);
        return summary;
      }),
    );
  }

  private async flush(id: string): Promise<void> {
    return this.store.db.scope(() =>
      this.operations.run(id, async () => {
        const live = this.live.get(id);
        if (!live) return;
        clearTimeout(live.timer);
        live.timer = undefined;
        if (!live.events.length) return;
        const events = live.events;
        const deferred = events.every((event) => BATCHED.has(event.type));
        // Only batched streaming deltas may wait for the store checkpoint; a batch
        // holding anything else (tool start, approval, question, ...) is written now.
        live.value = await this.save(
          live.value,
          { type: "events", events },
          deferred,
          live.blockChanges,
          !deferred,
        );
        live.events = [];
        live.blockChanges = new Map();
      }),
    );
  }

  private async scheduledFlush(id: string, provider: HostProvider): Promise<void> {
    try {
      await this.flush(id);
    } catch (error) {
      const active = this.running.get(id);
      if (active) active.persistenceFailed = true;
      console.error(
        "Session persistence failed; stopping its provider:",
        error instanceof Error ? error.message : "unknown error",
      );
      void provider.stop(id);
    }
  }

  private retrySettlement(id: string, runId: string, provider: HostProvider): void {
    if (
      this.closing ||
      this.retryTimers.has(id) ||
      this.recoveryWork.has(id) ||
      this.store.db.restartRequired
    )
      return;
    const timer = this.store.db.outsideScope(() =>
      setTimeout(() => {
        this.retryTimers.delete(id);
        if (this.closing) return;
        let retry = false;
        const work = (async () => {
          try {
            await provider.stop(id);
            const before = await this.store.session(id);
            if (this.running.get(id)?.runId !== runId || before.runId !== runId) return;
            await this.checkpoints
              .finish(id, before.session.cwd, runId)
              .catch((error) => console.warn("Workspace checkpoint failed", error));
            await this.store.db.scope(() =>
              this.operations.run(id, async () => {
                if (this.running.get(id)?.runId !== runId) return;
                await this.flush(id);
                const latest = await this.store.session(id);
                if (latest.runId !== runId) return;
                if (latest.status === "running") {
                  await this.save(
                    this.settled(
                      latest,
                      "interrupted",
                      "Session storage failed during this turn. Inspect its work before continuing.",
                      latest.updatedAt,
                    ),
                    { type: "interrupted", reason: "persistence failure" },
                  );
                }
                const active = this.running.get(id);
                await active?.releaseActivity?.();
                if (active) active.releaseActivity = undefined;
                await this.onSettled?.(id, {
                  interrupted: true,
                  reason:
                    "Session storage failed during this turn. Inspect its work before continuing.",
                });
                const persisted = await this.store.session(id);
                if (persisted.session.providerSessionId)
                  provider.bind(
                    id,
                    persisted.session.providerSessionId,
                    persisted.session.cwd,
                    persisted.session.providerAccountId,
                  );
                this.live.delete(id);
                this.running.delete(id);
              }),
            );
          } catch (error) {
            console.error(
              "Retrying session persistence:",
              error instanceof Error ? error.message : "unknown error",
            );
            retry = !this.store.db.restartRequired;
          }
        })();
        this.recoveryWork.set(id, work);
        void work.finally(() => {
          if (this.recoveryWork.get(id) === work) this.recoveryWork.delete(id);
          if (retry) this.retrySettlement(id, runId, provider);
        });
      }, 1_000),
    );
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  private async prepareCreation(command: Extract<HostCommand, { type: "create" }>) {
    if (command.workspaceId) return { workspaceId: command.workspaceId };
    // Adapter-less engines are legacy embeddings. Production attaches the managed
    // runtime before accepting transports; configured managed engines fail closed.
    if (!this.managedTurns || command.workspaceMode === "current") return undefined;
    const project = await this.store.project(command.projectId);
    // An explicitly selected existing legacy worktree retains its identity without
    // being silently adopted into automatic lifecycle management.
    if (
      command.worktreeCwd &&
      command.workspaceMode !== "worktree" &&
      resolveHostWorktree(project.cwd, command.worktreeCwd) !== project.cwd
    )
      return undefined;
    const prepared = await this.managedTurns.prepareWorkspaceForCreate?.({
      projectId: command.projectId,
      sessionId:
        command.sessionId ??
        createHash("sha256").update(`host-session:${command.commandId}`).digest("hex").slice(0, 32),
      idempotencyKey: `host-session:${command.commandId}:workspace`,
      workspaceMode: command.workspaceMode,
    });
    // Only an authoritative current policy result may skip managed preparation.
    if (prepared === null) return undefined;
    if (!prepared)
      throw new Error("Managed session creation requires workspace preparation; update this Host");
    return prepared;
  }

  async command(raw: unknown): Promise<CommandReceipt> {
    await this.ready;
    return this.store.db.scope(() =>
      this.operations.run(
        typeof raw === "object" && raw !== null && "sessionId" in raw
          ? String(raw.sessionId)
          : `create:${typeof raw === "object" && raw !== null && "commandId" in raw ? raw.commandId : randomUUID()}`,
        async () => {
          if (
            raw &&
            typeof raw === "object" &&
            (raw as Record<string, unknown>).type === "create" &&
            (raw as Record<string, unknown>).firstTurn !== undefined
          ) {
            const input = raw as Record<string, unknown>;
            const create = parseCommand({ ...input, firstTurn: undefined });
            if (create.type !== "create") throw new Error("Invalid session creation");
            const first = parseCommand({ ...(input.firstTurn as object), sessionId: "pending" });
            if (first.type !== "send" && first.type !== "draft")
              throw new Error("Invalid first turn");
            const signature = createHash("sha256")
              .update(JSON.stringify({ create, first }))
              .digest("hex");
            const previous = await this.store.receipt(create.commandId, signature);
            if (previous) return previous;
            const prepared = await this.prepareCreation(create);
            return await this.store.transaction(async () => {
              const created = await this.command({
                ...create,
                ...(prepared ? { workspaceId: prepared.workspaceId, worktreeCwd: undefined } : {}),
                commandId: `${create.commandId}:create`,
              });
              const sent = await this.command({ ...first, sessionId: created.sessionId });
              const receipt = { ...sent, commandId: create.commandId };
              await this.store.recordReceipt(signature, receipt);
              return receipt;
            });
          }
          if (this.closing) throw new Error("Host is stopping");
          const command = parseCommand(raw);
          if (command.type === "rewind")
            throw new Error("Rewind commands must use the asynchronous rewind handler");
          const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
          const previous = await this.store.receipt(command.commandId, signature);
          if (previous) return previous;
          if (command.type === "contextual")
            return await this.contextualCommand(command, signature);
          const prepared =
            command.type === "create" ? await this.prepareCreation(command) : undefined;
          if (command.type !== "create" && this.rewinding.has(command.sessionId))
            throw new Error("A conversation change is in progress");
          // Commands apply to the latest state, including batched stream output.
          if (command.type !== "create") await this.flush(command.sessionId);
          if (command.type !== "create" && command.type !== "cancel" && command.type !== "stopItem")
            await this.managedWorkspace(await this.store.session(command.sessionId));
          let effect: ((saved: HostSession) => void) | undefined;
          const { receipt, saved } = await this.store.transaction(async () => {
            let value: HostSession;
            if (command.type === "create") {
              assertModelProvider(command.harness, command.model);
              const project = await this.store.project(command.projectId);
              if (this.switchingProjects.has(project.id))
                throw new Error("Wait for the branch switch to finish");
              this.provider(command.harness);
              const workspaceId = prepared?.workspaceId ?? command.workspaceId;
              const managed = workspaceId
                ? await this.managedTurns?.workspaceForCreate?.({
                    projectId: project.id,
                    workspaceId,
                    worktreeCwd: command.workspaceId ? command.worktreeCwd : undefined,
                  })
                : undefined;
              if (workspaceId && managed?.workspaceId !== workspaceId)
                throw new Error(
                  "Managed session creation requires authoritative workspace ownership",
                );
              if (managed) await this.managedTurns!.assertWritable(managed.workspaceId);
              if (
                command.sessionId &&
                managed?.sessionId &&
                command.sessionId !== managed.sessionId
              )
                throw new Error("Requested session identity does not own this workspace");
              const cwd = managed?.path ?? resolveHostWorktree(project.cwd, command.worktreeCwd);
              const sessionId = managed?.sessionId ?? command.sessionId ?? randomUUID();
              if (await this.store.sessionAuthority(sessionId))
                throw new Error(
                  "This managed workspace already has its session; resume it instead",
                );
              const now = Date.now();
              value = {
                projectId: project.id,
                autoWorktreeBranch: managed ? undefined : command.autoWorktreeBranch,
                // Shared with this machine's desktop app from the start: it lists
                // the session in its project, and turns it runs come back here.
                desktop: { updatedAt: 0 },
                revision: 0,
                status: "idle",
                createdAt: now,
                updatedAt: now,
                session: {
                  id: sessionId,
                  cwd,
                  ...(!managed ? { workspaceMode: "current" as const } : {}),
                  ...(managed
                    ? {
                        workspaceId: managed.workspaceId,
                        workspaceRevision: managed.revision,
                        worktreeCwd: managed.path,
                        branch: managed.branchRef.replace(/^refs\/heads\//, ""),
                      }
                    : {}),
                  harness: command.harness,
                  ...(command.providerAccountId === undefined
                    ? {}
                    : { providerAccountId: command.providerAccountId }),
                  model: command.model,
                  runtimeMode: command.runtimeMode,
                  modelSettings: command.modelSettings ?? {},
                  title: "New remote session",
                  ...(!managed && command.autoWorktreeBranch
                    ? { branch: command.autoWorktreeBranch, worktreeCwd: cwd }
                    : {}),
                  blocks: [],
                },
              };
            } else {
              value = await this.store.session(command.sessionId);
              if (
                (command.type === "send" || command.type === "steer" || command.type === "draft") &&
                command.attachments?.some(
                  (file) =>
                    file.browserAnnotation &&
                    (file.browserAnnotation.projectId !== value.projectId ||
                      file.browserAnnotation.sessionId !== value.session.id),
                )
              )
                throw new Error("Browser selection belongs to another project or conversation");
              if (
                (command.type === "send" || command.type === "compact") &&
                this.switchingProjects.has(value.projectId)
              )
                throw new Error("Wait for the branch switch to finish");
              const provider = this.provider(value.session.harness);
              if (command.type === "configure") {
                if (value.status === "running")
                  throw new Error("Wait for the current turn before changing settings");
                const harness = command.harness ?? value.session.harness;
                assertModelProvider(harness, command.model);
                this.provider(harness);
                const plan = planComposerSwitch(value.session, harness);
                const changedHarness = value.session.harness !== harness;
                value = {
                  ...value,
                  session: {
                    ...value.session,
                    harness,
                    model: command.model,
                    modelSettings: command.modelSettings,
                    runtimeMode: command.runtimeMode,
                    ...(changedHarness
                      ? {
                          providerSessionId: undefined,
                          providerAccountId: undefined,
                          context: undefined,
                          usageLimit: undefined,
                        }
                      : {}),
                    ...(plan.kind === "arm" ? { pendingSwitch: plan.pending } : {}),
                    ...(plan.kind === "empty" ? { pendingSwitch: undefined } : {}),
                    ...(plan.kind === "revert"
                      ? {
                          pendingSwitch: undefined,
                          providerSessionId: plan.restoreProviderSessionId,
                          providerAccountId: plan.restoreProviderAccountId,
                        }
                      : {}),
                  },
                };
                if (plan.kind === "revert" && plan.restoreProviderSessionId) {
                  effect = (saved) =>
                    this.provider(saved.session.harness).bind(
                      saved.session.id,
                      plan.restoreProviderSessionId!,
                      saved.session.cwd,
                      saved.session.providerAccountId,
                    );
                }
              } else if (command.type === "draft") {
                if (value.status === "running" || value.session.blocks.some((block) => block.draft))
                  throw new Error("This session cannot save another draft right now");
                const attachments = resolveAttachments(this.store, command.attachments ?? []);
                value = {
                  ...value,
                  session: {
                    ...value.session,
                    title: value.session.blocks.length
                      ? value.session.title
                      : titleFromPrompt(command.text, value.session.harness, attachments),
                    blocks: [
                      ...value.session.blocks,
                      {
                        id: command.commandId,
                        role: "user",
                        text: command.text,
                        ...(attachments.length ? { attachments } : {}),
                        draft: true,
                      },
                    ],
                  },
                };
              } else if (command.type === "usageLimit") {
                const limit = value.session.usageLimit;
                if (limit) {
                  const { usageLimit: _dismissed, ...rest } = value.session;
                  value = {
                    ...value,
                    session:
                      command.action === "dismiss"
                        ? rest
                        : {
                            ...value.session,
                            usageLimit: {
                              ...limit,
                              resumeAtReset: command.action === "arm",
                            },
                          },
                  };
                }
              } else if (command.type === "removeDraft") {
                const draft = value.session.blocks.find(
                  (block) => block.id === command.draftBlockId && block.draft,
                );
                if (!draft) throw new Error("Draft not found");
                if (
                  draft.followUpDelivery === "pending" ||
                  (value.status === "running" && draft.followUpDelivery)
                )
                  throw new Error("Follow-up delivery is still active");
                value = {
                  ...value,
                  session: {
                    ...value.session,
                    blocks: value.session.blocks.filter((block) => block.id !== draft.id),
                  },
                };
              } else if (command.type === "shell") {
                // No model turn: the block is the whole effect, so it is allowed
                // while a turn runs.
                value = {
                  ...value,
                  session: {
                    ...value.session,
                    blocks: [...value.session.blocks, shellBlock(command.commandId, command.line)],
                  },
                };
                effect = (saved) =>
                  this.runShell(
                    saved.session.id,
                    command.commandId,
                    saved.session.cwd,
                    command.line,
                  );
              } else if (command.type === "send" || command.type === "compact") {
                // Legacy storage may contain a mixed provider/model identity.
                // Refuse it before consuming handoff/replay or dispatching a turn.
                assertModelProvider(value.session.harness, value.session.model);
                if (value.status === "running") throw new Error("This session is already running");
                if (command.type === "compact" && !provider.compact)
                  throw new Error("Context compaction is unavailable for this provider");
                const draft =
                  command.type === "send" && command.draftBlockId
                    ? value.session.blocks.find(
                        (block) => block.id === command.draftBlockId && block.draft,
                      )
                    : undefined;
                if (command.type === "send" && command.draftBlockId && !draft)
                  throw new Error("Draft not found");
                const plan =
                  command.type === "send" && command.planBlockId
                    ? value.session.blocks.find(
                        (block) => block.id === command.planBlockId && block.role === "plan",
                      )
                    : command.type === "send" &&
                        (command.intent ?? "default") === "default" &&
                        !command.draftBlockId &&
                        !command.attachments?.length
                      ? approvedPlanForMessage(value.session, command.text)
                      : undefined;
                const turnIntent = plan
                  ? "build"
                  : command.type === "send"
                    ? command.intent
                    : undefined;
                if (
                  command.type === "send" &&
                  (command.planBlockId || command.intent === "build") &&
                  (!plan || !isBuildablePlan(plan))
                )
                  throw new Error("Plan is not ready to build");
                if (
                  command.type === "send" &&
                  command.expectedPlanText !== undefined &&
                  plan?.text !== command.expectedPlanText
                )
                  throw new Error(
                    "The reviewed plan changed. Review the current plan before building.",
                  );
                const approvedPlanText =
                  plan && command.type === "send" && command.expectedPlanText !== undefined
                    ? command.text
                    : plan?.text;
                const attachments =
                  command.type === "send"
                    ? (draft?.attachments ??
                      resolveAttachments(this.store, command.attachments ?? []))
                    : [];
                if (
                  attachments.some(
                    (file) =>
                      file.browserAnnotation &&
                      (file.browserAnnotation.projectId !== value.projectId ||
                        file.browserAnnotation.sessionId !== value.session.id),
                  )
                )
                  throw new Error("Browser selection belongs to another project or conversation");
                if (
                  command.type === "send" &&
                  command.secondOpinion &&
                  command.secondOpinion.to !== value.session.harness
                )
                  throw new Error("The second opinion target does not match this conversation");
                // Read before the turn's own block lands after them.
                let handoffText: string | undefined;
                let handoffFrom: RemoteProvider | undefined;
                const rewindReplay =
                  command.type === "send" ? conversationReplayPrompt(value.session) : "";
                if (command.type === "send" && value.session.pendingSwitch) {
                  const from = value.session.pendingSwitch.from;
                  const brief = buildDeterministicHandoff(value.session, command.text);
                  value = {
                    ...value,
                    session: appendReadyHandoff(
                      { ...value.session, pendingSwitch: undefined },
                      from,
                      value.session.harness,
                      brief,
                    ),
                  };
                }
                if (command.type === "send") {
                  const handoff = pendingHandoff(value.session);
                  handoffText = handoff?.text;
                  handoffFrom = handoff?.from as RemoteProvider | undefined;
                  if (handoffText) {
                    const archive = new HandoffHistoryStore(
                      dirname(this.store.attachmentDir),
                    ).saveSync(handoffHistory(value.session));
                    handoffText = buildBudgetedHandoff(value.session, {
                      contextWindow: resolveModel(value.session.harness, value.session.model)
                        .contextWindow,
                      request: command.text,
                      brief: handoffText,
                      historyPath: archive.path,
                    }).text;
                    value = { ...value, session: consumeHandoff(value.session) };
                  }
                }
                const shellRuns =
                  command.type === "send" ? pendingShellRuns(value.session.blocks) : [];
                const runId = randomUUID();
                const firstTurn =
                  command.type === "send" && !value.session.blocks.some((block) => !block.draft);
                const placeholderTitle =
                  value.session.title === "New remote session" ||
                  canReplaceSessionTitle(
                    value.session.title,
                    value.session.harness,
                    HARNESS_LABEL[value.session.harness],
                  );
                const model = resolveModel(value.session.harness, value.session.model);
                // A new turn answers the last usage limit, so its notice (and any
                // armed resume) must not outlive it.
                const { usageLimit: _answered, ...current } = value.session;
                value = {
                  ...value,
                  status: "running",
                  runId,
                  session: {
                    ...current,
                    busy: true,
                    pendingQuestion: undefined,
                    submittedQuestions: undefined,
                    title:
                      firstTurn && placeholderTitle
                        ? titleFromPrompt(command.text, value.session.harness, attachments)
                        : value.session.title,
                    blocks: [
                      ...value.session.blocks
                        .filter(
                          (block) =>
                            !block.draft || (!!block.followUpDelivery && block.id !== draft?.id),
                        )
                        .map((block) =>
                          block === plan
                            ? {
                                ...block,
                                text: approvedPlanText ?? block.text,
                                plan: {
                                  ...(block.plan ?? { status: "ready" as const }),
                                  status: "building" as const,
                                  approvedText: approvedPlanText ?? block.text,
                                  ...(approvedPlanText !== block.text
                                    ? {
                                        originalText: block.plan?.originalText ?? block.text,
                                        edited: true,
                                      }
                                    : {}),
                                },
                              }
                            : block,
                        ),
                      {
                        id: command.commandId,
                        role: "user",
                        text: command.type === "compact" ? "/compact" : command.text,
                        ...(command.type === "send" && command.secondOpinion
                          ? { secondOpinion: command.secondOpinion }
                          : {}),
                        ...(command.type === "send" && command.noteCard
                          ? { noteCard: noteContextMeta(command.noteCard) }
                          : {}),
                        ...(attachments.length ? { attachments } : {}),
                        startedAt: Date.now(),
                        turnModel: {
                          harness: value.session.harness,
                          id: value.session.model,
                          name:
                            model.id === value.session.model
                              ? model.name
                              : value.session.model.replace(/^[^:]+:/, ""),
                        },
                      },
                    ],
                  },
                };
                effect = (saved) => {
                  const turnText =
                    command.type === "send"
                      ? plan
                        ? buildPlanPrompt(approvedPlanText ?? plan.text)
                        : turnIntent === "plan"
                          ? planTurnPrompt(command.text)
                          : command.noteCard
                            ? composeNoteContext(command.noteCard, command.text)
                            : command.text
                      : "";
                  const handoffBlock = handoffText
                    ? `<previous_agent_context>\n${handoffText}\n</previous_agent_context>\n\n`
                    : "";
                  // Codex parses /goal only as the first token; context travels separately.
                  const codexGoal =
                    command.type === "send" &&
                    saved.session.harness === "codex" &&
                    /^\s*\/goal(?=\s|$)/.test(command.text);
                  this.run(
                    saved,
                    command.type === "compact"
                      ? null
                      : codexGoal
                        ? command.text
                        : withShellContext(shellRuns, `${handoffBlock}${turnText}`),
                    turnIntent,
                    attachments,
                    command.resumeAtReset,
                    handoffText ? handoffFrom : undefined,
                    rewindReplay,
                    codexGoal
                      ? withShellContext(
                          shellRuns,
                          `${handoffBlock}${command.type === "send" && command.noteCard ? composeNoteContext(command.noteCard, "") : ""}`,
                        ).trim()
                      : "",
                    command.commandId,
                  );
                  if (firstTurn && command.type === "send") {
                    this.generateFirstTurnNames(saved, command.text, placeholderTitle);
                  }
                };
              } else {
                if (value.runId !== command.runId || value.status !== "running")
                  throw new Error("This request belongs to a finished or replaced turn");
                if (command.type === "cancel") {
                  effect = () => {
                    const active = this.running.get(command.sessionId);
                    if (active) active.cancelled = true;
                    void provider
                      .cancel(command.sessionId)
                      .catch(() => provider.stop(command.sessionId));
                  };
                } else if (command.type === "stopItem") {
                  const active = this.running.get(command.sessionId);
                  if (!provider.stopItem)
                    throw new Error("This provider cannot stop an individual task");
                  if (
                    !active ||
                    active.runId !== command.runId ||
                    active.cancelled ||
                    active.ending
                  )
                    throw new Error("Only an active host-owned turn can stop an individual task");
                  const block = value.session.blocks.find((entry) => entry.id === command.blockId);
                  if (
                    !block?.agentRun ||
                    block.agentRun.endedAt !== undefined ||
                    block.tool?.callId !== command.callId ||
                    active.priorBlockIds.has(block.id) ||
                    value.session.blocks.filter((entry) => entry.tool?.callId === command.callId)
                      .length !== 1 ||
                    !["running", "in_progress", "pending"].includes(block.tool.status ?? "") ||
                    (block.approval && !block.approval.decided)
                  )
                    throw new Error("This subagent changed or is no longer running");
                  effect = () => {
                    void active.ready
                      .then(async () => {
                        if (
                          this.running.get(command.sessionId) !== active ||
                          active.cancelled ||
                          active.ending
                        )
                          return;
                        await this.flush(command.sessionId);
                        const current = await this.store.session(command.sessionId);
                        const target = current.session.blocks.find(
                          (entry) => entry.id === command.blockId,
                        );
                        if (
                          current.runId !== command.runId ||
                          target?.tool?.callId !== command.callId ||
                          !target.agentRun ||
                          target.agentRun.endedAt !== undefined ||
                          !["running", "in_progress", "pending"].includes(target.tool.status ?? "")
                        )
                          return;
                        await provider.stopItem!(command.sessionId, command.callId);
                      })
                      .catch((reason) => {
                        if (this.running.get(command.sessionId) === active)
                          this.event(command.sessionId, command.runId, {
                            type: "status",
                            text: `Could not confirm the subagent stop request. Inspect its current status before taking further action: ${String(reason)}`,
                          });
                      });
                  };
                } else if (command.type === "steer") {
                  assertModelProvider(value.session.harness, value.session.model);
                  const active = this.running.get(command.sessionId);
                  if (!provider.steer) throw new Error("This provider cannot steer an active turn");
                  if (!active || active.cancelled || active.ending)
                    throw new Error("This turn was stopped");
                  const attachments = resolveAttachments(this.store, command.attachments ?? []);
                  value = {
                    ...value,
                    session: {
                      ...value.session,
                      blocks: [
                        ...value.session.blocks,
                        {
                          id: command.commandId,
                          role: "user",
                          text: command.text,
                          attachments,
                          draft: true,
                          followUpDelivery: "pending",
                        },
                      ],
                    },
                  };
                  effect = () => {
                    let attempted = false;
                    active.steers = active.steers
                      .then(async () => {
                        await active.ready;
                        if (
                          active.cancelled ||
                          active.ending ||
                          this.running.get(command.sessionId) !== active
                        )
                          return;
                        const files = await Promise.all(
                          attachments.map(async (file) =>
                            isVisionImage(file.mimeType) &&
                            file.path &&
                            file.size <= 20 * 1024 * 1024
                              ? { ...file, data: (await readFile(file.path)).toString("base64") }
                              : file,
                          ),
                        );
                        const prompt = await prepareHostSkillPrompt(
                          command.text,
                          value.session.cwd,
                          undefined,
                          value.session.id,
                        );
                        if (
                          active.cancelled ||
                          active.ending ||
                          this.running.get(command.sessionId) !== active
                        )
                          return;
                        const managedBoundary = await this.beginManagedTurn(
                          await this.store.session(command.sessionId),
                          command.commandId,
                        );
                        if (managedBoundary) active.managedTurns.push(managedBoundary);
                        attempted = true;
                        await this.followUpDelivery(
                          command.sessionId,
                          command.runId,
                          command.commandId,
                          "uncertain",
                        );
                        await provider.steer!({
                          sessionId: command.sessionId,
                          cwd: value.session.cwd,
                          model: value.session.model,
                          modelSettings: value.session.modelSettings,
                          text: prompt,
                          attachments: files,
                        });
                        // Cancellation can resolve a provider's steer without submitting it.
                        // A retired owner therefore cannot establish successful delivery.
                        if (
                          !active.cancelled &&
                          !active.ending &&
                          this.running.get(command.sessionId) === active
                        )
                          await this.followUpDelivery(
                            command.sessionId,
                            command.runId,
                            command.commandId,
                          );
                      })
                      .catch(async (reason) => {
                        if (this.running.get(command.sessionId) === active) {
                          await this.followUpDelivery(
                            command.sessionId,
                            command.runId,
                            command.commandId,
                            attempted ? "uncertain" : "undelivered",
                          );
                          this.event(command.sessionId, command.runId, {
                            type: "status",
                            text: `Could not confirm delivery of the follow-up. It is saved as a draft; inspect the provider's work before retrying: ${String(reason)}`,
                          });
                        }
                      });
                  };
                } else if (command.type === "approve") {
                  const pending = value.session.blocks.some(
                    (block) =>
                      block.approval?.requestId === command.requestId && !block.approval.decided,
                  );
                  if (!pending) throw new Error("Approval is already resolved");
                  value = {
                    ...value,
                    session: applyHarnessEvent(value.session, {
                      type: "approval.resolved",
                      requestId: command.requestId,
                      decision: command.decision,
                    }),
                  };
                  effect = () =>
                    provider.approve(command.sessionId, command.requestId, command.decision);
                } else {
                  if (value.session.pendingQuestion?.requestId !== command.requestId)
                    throw new Error("Question is already resolved");
                  if (
                    ["sending", "queued", "unknown"].includes(
                      value.session.pendingQuestion.delivery ?? "",
                    )
                  )
                    throw new Error("Question answer is already pending delivery");
                  value = {
                    ...value,
                    session: applyHarnessEvent(value.session, {
                      type: "question.updated",
                      requestId: command.requestId,
                      delivery: "sending",
                    }),
                  };
                  effect = () => {
                    try {
                      provider.answer(command.sessionId, command.requestId, command.reply);
                    } catch {
                      this.event(command.sessionId, command.runId, {
                        type: "question.updated",
                        requestId: command.requestId,
                        delivery: "unknown",
                        error:
                          "Answer delivery could not be confirmed. Check the connection before continuing.",
                      });
                    }
                  };
                }
              }
            }
            const saved = await this.store.save(
              {
                ...value,
                revision: value.revision + 1,
                // Creation already initialized both timestamps from the same clock read.
                updatedAt: command.type === "create" ? value.updatedAt : Date.now(),
              },
              { type: "command", command },
            );
            const result = {
              commandId: command.commandId,
              sessionId: saved.session.id,
              revision: saved.revision,
              ...((command.type === "send" || command.type === "compact") && saved.runId
                ? { runId: saved.runId }
                : {}),
            };
            await this.store.recordReceipt(signature, result);
            return { receipt: result, saved };
          });
          const live = this.live.get(saved.session.id);
          if (live) live.value = saved;
          // A receipt means durable host acceptance, not provider completion.
          if (effect) this.store.afterCommit(() => effect!(saved));
          return receipt;
        },
      ),
    );
  }

  /** /clear uses the existing send transport but never dispatches a model turn. */
  async clearConversation(raw: unknown): Promise<CommandReceipt> {
    await this.ready;
    if (this.closing) throw new Error("Host is stopping");
    const command = parseCommand(raw);
    if (
      command.type !== "send" ||
      !isClearSessionCommand(command.text) ||
      command.attachments?.length
    )
      throw new Error("Invalid clear command");
    const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = await this.store.receipt(command.commandId, signature);
    if (previous) return previous;
    if (this.rewinding.has(command.sessionId))
      throw new Error("A conversation change is in progress");
    this.rewinding.add(command.sessionId);
    try {
      await this.flush(command.sessionId);
      const initial = await this.store.session(command.sessionId);
      await this.managedWorkspace(initial);
      if (
        initial.status === "running" ||
        this.running.has(command.sessionId) ||
        !canClearConversation(initial.session)
      )
        throw new Error(
          "Stop the current turn and resolve pending messages before clearing the conversation",
        );
      await this.provider(initial.session.harness).stop(command.sessionId);
      if (
        initial.session.pendingSwitch &&
        initial.session.pendingSwitch.from !== initial.session.harness
      )
        await this.provider(initial.session.pendingSwitch.from).stop(command.sessionId);
      return await this.store.transaction(async () => {
        const latest = await this.store.session(command.sessionId);
        if (latest.revision !== initial.revision)
          throw new Error("The conversation changed while clearing");
        const saved = await this.save(
          { ...latest, session: clearConversation(latest.session), status: "idle" },
          { type: "conversation.cleared", commandId: command.commandId },
        );
        const live = this.live.get(command.sessionId);
        if (live) live.value = saved;
        const receipt = {
          commandId: command.commandId,
          sessionId: command.sessionId,
          revision: saved.revision,
        };
        await this.store.recordReceipt(signature, receipt);
        return receipt;
      });
    } finally {
      this.rewinding.delete(command.sessionId);
      this.onUnblocked?.();
    }
  }

  /** Stop the provider binding before atomically committing a rewind. */
  async rewind(raw: unknown): Promise<CommandReceipt> {
    await this.ready;
    if (this.closing) throw new Error("Host is stopping");
    const command = parseCommand(raw);
    if (command.type !== "rewind") throw new Error("Invalid rewind command");
    const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = await this.store.receipt(command.commandId, signature);
    if (previous) return previous;
    if (this.rewinding.has(command.sessionId))
      throw new Error("Another conversation change is in progress");
    this.rewinding.add(command.sessionId);
    let nativeRewindApplied = false;
    let nativeProvider: HostProvider | undefined;
    try {
      await this.flush(command.sessionId);
      const initial = await this.store.session(command.sessionId);
      if (await this.managedWorkspace(initial))
        throw new Error(
          "Managed workspaces require sessions.rewind.plan/apply; preview the Git rewind first",
        );
      if (command.expectedRevision !== undefined && initial.revision !== command.expectedRevision)
        throw new Error("The conversation changed; refresh before rewinding");
      if (initial.status === "running" || this.running.has(command.sessionId))
        throw new Error("Stop the current turn before rewinding the conversation");
      if (!canRewindConversation(initial.session, command.blockId))
        throw new Error("This conversation cannot be rewound at the selected message");
      const revision = initial.revision;
      const provider = this.provider(initial.session.harness);
      nativeProvider = provider;
      const strategy = conversationRewindStrategy(
        initial.session,
        command.blockId,
        !!provider.rewind && !!initial.session.providerSessionId,
      );
      let nativeProviderSessionId: string | undefined;
      // The removed turns may have carried the runtime hint; resend it next turn.
      forgetRuntimeHint(command.sessionId);
      if (strategy.preserveProviderBinding && provider.rewind) {
        await provider.rewind({
          sessionId: command.sessionId,
          cwd: initial.session.cwd ?? "",
          model: initial.session.model,
          modelSettings: initial.session.modelSettings,
          providerAccountId: initial.session.providerAccountId,
          runtimeMode: initial.session.runtimeMode,
          providerTurnId: strategy.providerTurnId,
          // Native providers can emit a new binding (Pi/OMP fork to a child).
          // Capture that id while keeping all transcript events out of the host
          // until the archive and block removal commit together.
          onEvent: (event) => {
            if (event.type === "session.providerBound")
              nativeProviderSessionId = event.providerSessionId;
          },
        });
        nativeRewindApplied = true;
      } else {
        // Fresh-session replay prevents all providers from reusing the old id.
        await provider.stop(command.sessionId);
      }
      const current = await this.store.session(command.sessionId);
      if (
        current.revision !== revision ||
        current.status === "running" ||
        this.running.has(command.sessionId)
      )
        throw new Error("The conversation changed while rewind was preparing");
      if (!canRewindConversation(current.session, command.blockId))
        throw new Error("This conversation cannot be rewound at the selected message");
      const rewound = rewindConversationBeforeMessage(
        current.session,
        strategy.blockId,
        Date.now(),
        { preserveProviderBinding: strategy.preserveProviderBinding },
      );
      if (rewound === current.session) throw new Error("This conversation cannot be rewound");
      if (strategy.preserveProviderBinding && nativeProviderSessionId)
        rewound.providerSessionId = nativeProviderSessionId;
      const { receipt, saved } = await this.store.transaction(async () => {
        const latest = await this.store.session(command.sessionId);
        if (latest.revision !== revision || latest.status === "running")
          throw new Error("The conversation changed while rewind was preparing");
        const value = await this.store.save(
          { ...latest, session: rewound, revision: latest.revision + 1, updatedAt: Date.now() },
          { type: "conversation.rewound", commandId: command.commandId, blockId: command.blockId },
        );
        const receipt = {
          commandId: command.commandId,
          sessionId: value.session.id,
          revision: value.revision,
        };
        await this.store.recordReceipt(signature, receipt);
        return { receipt, saved: value };
      });
      const live = this.live.get(saved.session.id);
      if (live) live.value = saved;
      return receipt;
    } catch (error) {
      // If the provider mutated successfully but the durable transcript commit
      // failed, invalidate the now-stale native binding and replay the intact
      // visible transcript on the next send. Never archive/remove messages here.
      if (nativeRewindApplied && nativeProvider) {
        try {
          await nativeProvider.stop(command.sessionId);
        } catch {
          // The fresh-session binding is still cleared durably below.
        }
        try {
          await this.store.db.scope(() =>
            this.operations.run(command.sessionId, async () => {
              const latest = await this.store.session(command.sessionId);
              const replay = buildConversationReplay(latest.session.blocks);
              const saved = await this.save(
                {
                  ...latest,
                  session: {
                    ...latest.session,
                    providerSessionId: undefined,
                    pendingContextReplay: replay || undefined,
                  },
                },
                { type: "conversation.rewindRecovery", commandId: command.commandId },
              );
              const live = this.live.get(command.sessionId);
              if (live) live.value = saved;
            }),
          );
        } catch {
          // Keep the original rewind error; no transcript mutation was committed.
        }
      }
      throw error;
    } finally {
      this.rewinding.delete(command.sessionId);
      this.onUnblocked?.();
    }
  }

  private async followUpDelivery(
    id: string,
    runId: string,
    blockId: string,
    outcome?: "undelivered" | "uncertain",
  ): Promise<void> {
    return this.store.db.scope(() =>
      this.operations.run(id, async () => {
        await this.flush(id);
        const current = await this.store.session(id);
        if (current.runId !== runId) return;
        const block = current.session.blocks.find((entry) => entry.id === blockId);
        if (!block?.followUpDelivery) return;
        const saved = await this.save(
          {
            ...current,
            session: {
              ...current.session,
              blocks: current.session.blocks.map((entry) =>
                entry.id !== blockId
                  ? entry
                  : {
                      ...entry,
                      draft: outcome ? true : undefined,
                      followUpDelivery: outcome,
                    },
              ),
            },
          },
          { type: "followUp.delivery", blockId, outcome: outcome ?? "delivered" },
        );
        const live = this.live.get(id);
        if (live) live.value = saved;
      }),
    );
  }

  private runShell(id: string, blockId: string, cwd: string, command: string): void {
    void (async (): Promise<ShellResult> => {
      let release: (() => Promise<void>) | undefined;
      try {
        const value = await this.store.session(id);
        release = await this.executionActivity(value, "shell");
        // Resolve once more at admission; never execute a renderer-supplied cwd.
        return await this.shell(value.session.worktreeCwd ?? value.session.cwd ?? cwd, command);
      } catch (error) {
        return {
          output: error instanceof Error ? error.message : String(error),
          exitCode: null,
          timedOut: false,
        };
      } finally {
        await release?.();
      }
    })()
      .then((result) => {
        if (this.closing) return;
        return this.store.db.scope(() =>
          this.operations.run(id, async () => {
            if (this.closing) return;
            await this.flush(id);
            const current = await this.store.session(id);
            const saved = await this.save(
              {
                ...current,
                session: {
                  ...current.session,
                  blocks: current.session.blocks.map((block) =>
                    block.id === blockId ? finishShellBlock(block, result) : block,
                  ),
                },
              },
              { type: "shell.finished", blockId },
            );
            const live = this.live.get(id);
            if (live) live.value = saved;
          }),
        );
      })
      // The conversation may have been deleted while the command ran.
      .catch((error) => console.debug("[bycoda] remote shell command", error));
  }

  private generateFirstTurnNames(
    value: HostSession,
    message: string,
    generateTitle: boolean,
  ): void {
    const provider = this.provider(value.session.harness);
    const { id, cwd, harness, title } = value.session;
    if (generateTitle && provider.generateTitle) {
      void (async () => {
        const release = await this.executionActivity(value, "provider");
        try {
          const workspace = await this.managedWorkspace(value);
          return await provider.generateTitle!({
            sessionId: id,
            cwd: workspace?.path ?? cwd,
            message,
          });
        } finally {
          await release?.();
        }
      })()
        .then((generated) => {
          if (this.closing || !generated) return;
          return this.store.db.scope(() =>
            this.operations.run(id, async () => {
              if (this.closing) return;
              if (this.rewinding.has(id)) return;
              await this.flush(id);
              const current = await this.store.session(id);
              await this.managedWorkspace(current);
              if (current.session.title !== title) return;
              const saved = await this.save(
                {
                  ...current,
                  session: {
                    ...current.session,
                    title: formatSessionTitle(harness, generated.title),
                  },
                },
                { type: "session.generatedTitle" },
              );
              const live = this.live.get(id);
              if (live) live.value = saved;
            }),
          );
        })
        .catch((error) => console.debug("[bycoda] remote session title", error));
    }
    const temporary = value.autoWorktreeBranch;
    if (temporary && !value.session.workspaceId && provider.generateBranchName) {
      void provider
        .generateBranchName(cwd, message)
        .then(async (fragment) => {
          const branch = fragment ? namedWorktreeBranch(fragment) : null;
          if (this.closing || !branch) return;
          // A title/branch request may finish after the conversation was deleted.
          const currentBeforeRename = await this.store.session(id);
          if (this.closing || currentBeforeRename.autoWorktreeBranch !== temporary) return;
          // Managed branch identity is fixed by the registry, never renamed by a title hint.
          if (await this.managedWorkspace(currentBeforeRename)) return;
          const project = await this.store.project(value.projectId);
          if (this.closing) return;
          await renameHostWorktreeBranch(
            project.cwd,
            cwd,
            temporary,
            branch,
            async () =>
              !this.closing && (await this.store.session(id)).autoWorktreeBranch === temporary,
          );
          if (this.closing) return;
          await this.store.db.scope(() =>
            this.operations.run(id, async () => {
              if (this.closing) return;
              await this.flush(id);
              const current = await this.store.session(id);
              if (current.autoWorktreeBranch !== temporary) return;
              const saved = await this.save(
                {
                  ...current,
                  autoWorktreeBranch: undefined,
                  session: { ...current.session, branch },
                },
                { type: "session.generatedBranch", branch },
              );
              const live = this.live.get(id);
              if (live) live.value = saved;
            }),
          );
        })
        .catch((error) => console.debug("[bycoda] remote worktree branch", error));
    }
  }

  private async consumeContextReplay(id: string, runId: string, replay: string): Promise<void> {
    return this.store.db.scope(() =>
      this.operations.run(id, async () => {
        const latest = await this.store.session(id);
        if (
          latest.runId !== runId ||
          latest.status !== "running" ||
          latest.session.pendingContextReplay !== replay
        )
          return;
        const saved = await this.save(
          { ...latest, session: { ...latest.session, pendingContextReplay: undefined } },
          { type: "conversation.replayAccepted", runId },
        );
        const live = this.live.get(id);
        if (live) live.value = saved;
      }),
    );
  }

  private run(
    value: HostSession,
    prompt: string | null,
    intent?: "default" | "plan" | "build",
    attachments: Session["blocks"][number]["attachments"] = [],
    resumeAtReset?: boolean,
    resetConversationFrom?: RemoteProvider,
    rewindReplay = "",
    /** Shell/handoff context kept out of a leading Codex /goal command. */
    goalContext = "",
    userBlockId?: string,
  ): void {
    let session = value.session;
    const { runId } = value;
    const provider = this.provider(session.harness);
    let ready!: () => void;
    let replayConsumed = false;
    const acceptReplay = async () => {
      ready();
      if (!rewindReplay || replayConsumed) return;
      replayConsumed = true;
      await this.consumeContextReplay(session.id, runId!, rewindReplay);
    };
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const active = {
      runId: runId!,
      priorBlockIds: new Set(session.blocks.map((block) => block.id)),
      ready: readyPromise,
      steers: Promise.resolve(),
      done: Promise.resolve(),
      cancelled: false,
      ending: false,
      persistenceFailed: false,
      resumeAtReset,
      managedTurns: [] as ManagedTurnBoundary[],
      releaseActivity: undefined as (() => Promise<void>) | undefined,
      // Resolver failures are unknown ownership, never permission to use legacy restore.
      managed: !!this.managedTurns,
    };
    this.running.set(session.id, active);
    this.live.set(session.id, { value, events: [], blockChanges: new Map() });
    active.done = Promise.resolve()
      .then(async () => {
        let error: string | undefined;
        try {
          if (!this.closing && !active.cancelled) {
            active.releaseActivity = await this.executionActivity(value, "provider");
            const workspace = await this.managedWorkspace(value);
            active.managed = !!workspace;
            if (workspace?.path)
              session = { ...session, cwd: workspace.path, worktreeCwd: workspace.path };
            const managedBoundary = active.managed
              ? await this.beginManagedTurn(value, userBlockId!)
              : undefined;
            if (managedBoundary) active.managedTurns.push(managedBoundary);
            // A provider may still have the binding from an earlier stint in
            // this chat. A handoff starts a new conversation with its recap.
            if (resetConversationFrom) {
              forgetRuntimeHint(session.id);
              if (resetConversationFrom !== session.harness)
                await this.provider(resetConversationFrom).stop(session.id);
              await provider.stop(session.id);
            }
            if (this.closing || active.cancelled) throw new Error("Turn cancelled");
            if (!managedBoundary)
              await this.checkpoints.begin(session.id, session.cwd, runId!).catch((error) => {
                if (String(error).includes("checkpoint-coordination:")) throw error;
                console.warn("Workspace checkpoint failed", error);
              });
            if (this.closing || active.cancelled) throw new Error("Turn cancelled");
            // Startup binds from mirror columns without the account; a provider
            // thread lives in its account's profile, so resume it from there.
            if (!resetConversationFrom && session.providerAccountId && session.providerSessionId)
              provider.bind(
                session.id,
                session.providerSessionId,
                session.cwd,
                session.providerAccountId,
              );
            const input: HarnessSessionInput = {
              sessionId: session.id,
              cwd: session.cwd,
              model: session.model,
              modelSettings: session.modelSettings,
              providerAccountId: session.providerAccountId,
              runtimeMode: session.runtimeMode,
              intent,
              onEvent: (event) => {
                const accepted =
                  event.type === "turn.started" ||
                  event.type === "message.delta" ||
                  event.type === "reasoning.delta" ||
                  event.type === "tool.started";
                this.event(session.id, runId!, event, accepted ? acceptReplay : undefined);
              },
            };
            if (prompt === null) {
              if (active.managedTurns[0])
                await this.managedTurns!.assertWritable(active.managedTurns[0].workspaceId);
              await provider.compact!(input);
              forgetRuntimeHint(session.id);
            } else {
              const preparedPrompt =
                /(^|\s)[/$][A-Za-z0-9][A-Za-z0-9_.:-]*(?=\s|$)/.test(prompt) &&
                !(session.harness === "codex" && /^\s*\/goal(?:\s|$)/.test(prompt))
                  ? await prepareHostSkillPrompt(prompt, session.cwd, undefined, session.id)
                  : prompt;
              if (this.closing || active.cancelled) throw new Error("Turn cancelled");
              const thread = {
                harness: session.harness,
                providerAccountId: session.providerAccountId,
              };
              const hint = pendingRuntimeHint(
                session.id,
                thread,
                await harnessRuntimeHints(session.id),
              );
              const codex = session.harness === "codex";
              // Codex parses /goal only as the first token; carry replayed
              // context as runtime instructions instead of prefixing it.
              const codexGoal = codex && /^\s*\/goal(?=\s|$)/.test(preparedPrompt);
              const body = codexGoal
                ? preparedPrompt
                : [rewindReplay, preparedPrompt].filter(Boolean).join("\n\n");
              const text = codex ? body : withRuntimeHint(session.harness, body, hint);
              const deliversHint = turnCarriesRuntimeHint(session.harness, body, text, hint);
              const runtimeInstructions = [
                hint,
                codexGoal ? goalContext : "",
                codexGoal ? rewindReplay : "",
              ]
                .filter(Boolean)
                .join("\n\n");
              const markHint = () => {
                if (deliversHint) markRuntimeHintDelivered(session.id, thread, hint);
              };
              const providerInput: SendTurnInput = {
                ...input,
                onAccepted: () => {
                  markHint();
                  this.queueEvent(session.id, acceptReplay);
                },
                text,
                ...(codex && runtimeInstructions ? { runtimeInstructions } : {}),
                // Async so a 20 MB image does not stall every other RPC.
                attachments:
                  attachments &&
                  (await Promise.all(
                    attachments.map(async (file) =>
                      isVisionImage(file.mimeType) && file.path && file.size <= 20 * 1024 * 1024
                        ? {
                            ...file,
                            data: (await readFile(file.path)).toString("base64"),
                          }
                        : file,
                    ),
                  )),
              };
              if (this.closing || active.cancelled) throw new Error("Turn cancelled");
              if (active.managedTurns[0])
                await this.managedTurns!.assertWritable(active.managedTurns[0].workspaceId);
              await provider.send(providerInput);
              markHint();
              active.ending = true;
              await this.store.db.scope(() => this.operations.run(session.id, acceptReplay));
            }
          }
        } catch (reason) {
          error = reason instanceof Error ? reason.message : String(reason);
        }
        active.ending = true;
        ready();
        // Keep the session running until the old process has stopped. Otherwise
        // a follow-up can race cleanup and have its newly spawned child killed.
        await provider.stop(session.id);
        // Retire outstanding delivery work before exposing an idle session.
        await active.steers;
        if (active.managed) {
          // Keep each accepted boundary independently; compaction never prunes this map.
          for (const boundary of active.managedTurns) {
            try {
              const record = await this.managedTurns!.history.end(boundary);
              if (record.after?.status !== "complete")
                throw new Error(
                  `Turn Git capture blocked: ${record.after?.status === "blocked" ? record.after.reason : "missing after capture"}`,
                );
            } catch (reason) {
              error = reason instanceof Error ? reason.message : String(reason);
            }
          }
        } else {
          await this.checkpoints
            .finish(session.id, session.cwd, runId!)
            .catch((reason) => console.warn("Workspace checkpoint failed", reason));
        }
        await this.store.db.scope(() =>
          this.operations.enqueue(session.id, async () => {
            await this.flush(session.id);
            this.live.delete(session.id);
            const latest = await this.store.session(session.id);
            if (latest.runId === runId) {
              const message = this.closing
                ? "Host stopped. This turn was interrupted."
                : active.persistenceFailed
                  ? "Session storage failed during this turn. Inspect its work before continuing."
                  : active.cancelled
                    ? "Stopped by you."
                    : error;
              const finalized =
                intent === "plan" && !message
                  ? {
                      ...latest,
                      session: promoteLastAssistantToPlan(
                        stopStreaming(latest.session),
                        `plan:${runId}`,
                      ),
                    }
                  : latest;
              const settled = this.settled(
                finalized,
                this.closing || active.persistenceFailed ? "interrupted" : "idle",
                message,
                Date.now(),
                active.cancelled || this.closing ? "interrupt" : "error",
              );
              await this.save(
                active.cancelled
                  ? { ...settled, session: markConversationTurnStopped(settled.session) }
                  : settled,
                { type: "settled", error, cancelled: active.cancelled },
              );
            }
            await active.releaseActivity?.();
            active.releaseActivity = undefined;
            await this.onSettled?.(session.id, {
              ...(active.cancelled ? { cancelled: true } : {}),
              ...(this.closing || active.persistenceFailed
                ? {
                    interrupted: true,
                    reason: this.closing
                      ? "Host stopped. This turn was interrupted."
                      : "Session storage failed during this turn. Inspect its work before continuing.",
                  }
                : {}),
              ...(!active.cancelled && !this.closing && error ? { error } : {}),
            });
            // stop/forget releases callbacks and native resources; bind only retained
            // provider conversation identity for an explicit future follow-up.
            const persisted = (await this.store.session(session.id)).session;
            if (persisted.providerSessionId)
              provider.bind(
                session.id,
                persisted.providerSessionId,
                persisted.cwd,
                persisted.providerAccountId,
              );
            this.running.delete(session.id);
          }),
        );
      })
      .catch((error) => {
        clearTimeout(this.live.get(session.id)?.timer);
        console.error(
          "Session persistence failed; stopping its provider:",
          error instanceof Error ? error.message : "unknown error",
        );
        void provider.stop(session.id);
        this.retrySettlement(session.id, runId!, provider);
      });
  }

  private queueEvent(id: string, work: () => Promise<void>): void {
    void this.store.db
      .scope(() => this.operations.enqueue(id, work))
      .catch((error) => {
        const active = this.running.get(id);
        if (active) active.persistenceFailed = true;
        console.error("Session event persistence failed:", error);
        const harness = this.live.get(id)?.value.session.harness;
        if (harness) void this.provider(harness).stop(id);
      });
  }

  private event(
    id: string,
    runId: string,
    event: HarnessEvent,
    before?: () => Promise<void>,
  ): void {
    this.queueEvent(id, async () => {
      if (before) await before();
      await this.applyEvent(id, runId, event);
    });
  }

  private async applyEvent(id: string, runId: string, event: HarnessEvent): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.value.runId !== runId || live.value.status !== "running") return;
    if (
      event.type === "tool.updated" &&
      (event.status === "completed" || event.status === "success") &&
      isEditTool(event.kind, event.title, event.preview)
    ) {
      const paths = [...(event.paths ?? []), ...(event.preview?.path ? [event.preview.path] : [])];
      if (paths.length)
        void this.checkpoints
          .claim(id, live.value.session.cwd, runId, paths)
          .catch((error) => console.warn("Checkpoint tool attribution failed", error));
    }
    // The host cannot read the desktop's settings; the turn carried them.
    const session = applyHarnessEvent(live.value.session, event, {
      resumeAtReset: this.running.get(id)?.resumeAtReset ?? false,
    });
    if (session === live.value.session) return;
    if (live.blockChanges) {
      const changed = changedBlocks(live.value.session.blocks, session.blocks);
      if (changed === undefined) live.blockChanges = undefined;
      else for (const [blockId, block] of changed) live.blockChanges.set(blockId, block);
    }
    live.value = { ...live.value, session };
    live.events.push(event);
    if (!BATCHED.has(event.type)) await this.flush(id);
    else
      live.timer ??= this.store.db.outsideScope(() =>
        setTimeout(
          async () => await this.scheduledFlush(id, this.provider(session.harness)),
          FLUSH_MS,
        ),
      );
  }

  private settled(
    value: HostSession,
    status: "idle" | "interrupted",
    message?: string,
    endedAt = Date.now(),
    notice: "error" | "interrupt" = "interrupt",
  ): HostSession {
    const stopped = stopStreaming(value.session, endedAt, notice === "error" && !!message);
    const session = {
      ...stopped,
      blocks: stopped.blocks.map((block) =>
        block.followUpDelivery === "pending"
          ? { ...block, draft: true, followUpDelivery: "undelivered" as const }
          : block.role === "plan" && block.plan?.status === "building"
            ? {
                ...block,
                plan: {
                  ...block.plan,
                  status: status === "idle" && !message ? ("built" as const) : ("ready" as const),
                },
              }
            : block,
      ),
    };
    if (message)
      session.blocks.push({
        id: randomUUID(),
        role: "system",
        notice,
        text: message,
        streaming: false,
      });
    return { ...value, status, session };
  }

  /** Wait only for the owned turn, including provider and checkpoint cleanup. */
  async waitForRun(sessionId: string, runId: string | undefined): Promise<void> {
    await this.ready;
    const active = this.running.get(sessionId);
    if (!active) return;
    if (active.runId !== runId) throw new Error("The session has a different active turn.");
    await active.done;
    if (this.running.has(sessionId)) throw new Error("Session cleanup is still pending.");
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeOwned());
  }

  private async closeOwned(): Promise<void> {
    this.closing = true;
    await this.ready;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const failures: unknown[] = [];
    const join = async (work: Iterable<Promise<unknown>>) => {
      for (const result of await Promise.allSettled(work)) {
        if (result.status === "rejected") failures.push(result.reason);
      }
    };
    await join(
      [...this.running.keys()].map(async (id) =>
        this.provider((await this.store.session(id)).session.harness).stop(id),
      ),
    );
    await join([...this.running.values()].map((active) => active.done));
    await join(this.recoveryWork.values());
    await join([this.operations.drain()]);
    await join([this.store.flushAll()]);
    if (failures.length) throw new AggregateError(failures, "Host session shutdown failed.");
  }
}
