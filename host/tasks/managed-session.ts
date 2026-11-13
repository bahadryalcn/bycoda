import type { CommandReceipt } from "../../src/features/connections/model/protocol";
import { hostQuestionToken } from "../sessions/question-source";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { type SessionMessageAuthor } from "../../src/features/sessions/model/session";
import { taskContract } from "./task-handoff";
import type { HostEngine } from "../engine";
import { buildDeterministicHandoff } from "../../src/features/sessions/model/handoff";
import { sessionRunState } from "../sessions/sessionRuns";
import type { TaskContext } from "./context";
import {
  assistantSessionWorkTarget,
  enrollAssistantSteerUsage,
  runAssistantSessionWork,
} from "../work/assistant-session-work";
export async function managedSessionCommand(
  context: TaskContext,
  input: {
    jobId: string;
    sessionId: string;
    source: {
      projectId: string;
      executionCwd: string;
      authorityGeneration?: number;
      runId?: string;
    };
    requestId?: string;
    author?: SessionMessageAuthor;
    questionToken?: string;
    signal: AbortSignal;
    recheck: () => Promise<void>;
  },
  command: unknown,
): Promise<CommandReceipt> {
  // A committed steer temporarily owns one draft while provider delivery is
  // pending. Capture its Host-stamped operation, never a general draft bypass.
  const author = input.author ? structuredClone(input.author) : undefined;
  const ownCommand =
    command && typeof command === "object" && !Array.isArray(command)
      ? (command as { type?: unknown; commandId?: unknown; sessionId?: unknown })
      : undefined;
  const ownSteerId =
    ownCommand?.type === "steer" &&
    ownCommand.sessionId === input.sessionId &&
    input.requestId &&
    author?.kind === "assistant" &&
    author.jobId === input.jobId &&
    author.operationId === input.requestId &&
    ownCommand.commandId ===
      `assistant-message-${createHash("sha256").update(input.requestId).digest("hex")}`
      ? ownCommand.commandId
      : undefined;
  await context.ready;
  if (!context.admitCommand || !input.source.runId)
    throw new Error("Guarded worker commands require the original engine run.");
  const matches = (await context.list(input.source.projectId, false)).filter(
    (task) =>
      task.goalId === `assistant-${input.jobId}` &&
      task.sessionId === input.sessionId &&
      task.runId === input.source.runId,
  );
  if (matches.length !== 1)
    throw new Error(
      "Supervisor writes support only the job's current worker. Planner repair uses goal replanning; independent review remains with its review owner.",
    );
  let task = matches[0],
    expected = await context.taskValue(task.id);
  const answering =
    !!input.questionToken &&
    !!command &&
    typeof command === "object" &&
    (command as { type?: string }).type === "answer";
  if (input.questionToken && !answering)
    throw new Error("A question scope only permits the canonical answer command.");
  if (context.continuingSessions.has(task.id))
    throw new Error("Worker maintenance is already pending.");
  context.continuingSessions.add(task.id);
  const check = async (stage: {
    phase: "command" | "provider";
    sessionId: string;
    runId?: string;
  }) => {
    input.signal.throwIfAborted();
    await input.recheck();
    if (
      stage.sessionId !== input.sessionId ||
      context.closing ||
      task.status !== "running" ||
      context.pausedGoals.has(task.goalId!) ||
      task.crewRunId ||
      task.crewDefinitionId ||
      task.error ||
      (!answering && task.needsInput) ||
      JSON.stringify(await context.unchangedTask(task.id, expected)) !== JSON.stringify(task)
    )
      throw new Error("The managed worker was stopped, paused or changed before dispatch.");
    if (
      task.maxRunMinutes > 0 &&
      (
        await sessionRunState(
          context.store,
          { ...task, startedAt: task.startedAt ?? task.createdAt },
          task.maxRunMinutes,
          context.now(),
        )
      ).state === "overLimit"
    )
      throw new Error("The original managed worker reached its time limit.");
    const budget = await context.budgetReason(task, stage.phase === "command");
    if (budget) throw new Error(budget);
    const current = await context.store.session(input.sessionId),
      session = current.session;
    const cwd = task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd;
    if (
      current.projectId !== input.source.projectId ||
      (session.worktreeCwd ?? session.cwd) !== input.source.executionCwd ||
      cwd !== input.source.executionCwd ||
      current.authorityGeneration !== input.source.authorityGeneration ||
      current.runId !== (stage.phase === "command" ? input.source.runId : stage.runId) ||
      current.runId !== task.runId ||
      session.harness !== task.harness ||
      session.model !== task.model ||
      session.runtimeMode !== task.runtimeMode ||
      (session.providerAccountId ?? "default") !== (task.providerAccountId ?? "default") ||
      JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings) ||
      (answering
        ? hostQuestionToken(current) !== input.questionToken
        : !!session.pendingQuestion) ||
      session.pendingSwitch ||
      session.blocks.some((block) => !!block.approval && !block.approval.decided) ||
      !!session.queuedMessages?.length ||
      session.blocks.some(
        (block) =>
          !!block.draft &&
          !(
            stage.phase === "provider" &&
            ownSteerId &&
            block.id === ownSteerId &&
            block.role === "user" &&
            (block.followUpDelivery === "pending" || block.followUpDelivery === "uncertain") &&
            isDeepStrictEqual(block.author, author)
          ),
      )
    )
      throw new Error("The managed worker's original source or pending owner input changed.");
    input.signal.throwIfAborted();
  };
  try {
    const dispatch = () =>
      context.admitCommand!(
        {
          check,
          onAccepted: async (receipt) => {
            if (!receipt.runId) return;
            input.signal.throwIfAborted();
            await input.recheck();
            await context.unchangedTask(task.id, expected);
            task = await context.write({ ...task, runId: receipt.runId, updatedAt: context.now() });
            expected = await context.taskValue(task.id);
          },
        },
        () => context.engine.command(command),
      );
    const current = await context.store.session(input.sessionId);
    const typed = command as { type: string; commandId: string };
    if (["steer", "answer"].includes(typed.type)) {
      await enrollAssistantSteerUsage(context.store, current, input.jobId);
      return await dispatch();
    }
    return await runAssistantSessionWork(context.store, context.engine as HostEngine, {
      source: { kind: "assistant", id: `job:${input.jobId}`, occurrence: typed.commandId },
      projectId: task.projectId,
      target: assistantSessionWorkTarget(current, typed.commandId),
      commandId: typed.commandId,
      promptHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
      signal: input.signal,
      budgetScope: { taskId: task.id, ...(task.goalId ? { goalId: task.goalId } : {}) },
      admitted: async () => {
        input.signal.throwIfAborted();
        await input.recheck();
      },
      run: () =>
        input.author
          ? (context.engine as HostEngine).withMessageAuthor(input.author, dispatch)
          : dispatch(),
    });
  } finally {
    context.continuingSessions.delete(task.id);
  }
}

export async function continueManagedSession(
  context: TaskContext,
  input: Omit<
    Parameters<HostEngine["continueSessionHistory"]>[0],
    "brief" | "requestId" | "admitted" | "onAccepted"
  > & {
    jobId: string;
    requestId: string;
    guard: () => Promise<void>;
  },
): Promise<CommandReceipt> {
  await context.ready;
  input.signal.throwIfAborted();
  if (!input.source.runId)
    throw new Error("The managed worker's original run identity is missing.");
  if (!context.continueHistory) throw new Error("Worker history continuation is unavailable.");
  const matches = (await context.list(input.source.projectId, false)).filter(
    (task) =>
      task.goalId === `assistant-${input.jobId}` &&
      task.sessionId === input.sessionId &&
      task.runId === input.source.runId,
  );
  if (matches.length !== 1)
    throw new Error("The original managed worker attempt is no longer owned by this job.");
  let task = matches[0];
  if (context.continuingSessions.has(task.id))
    throw new Error("Worker history continuation is already pending.");
  context.continuingSessions.add(task.id);
  try {
    let expected = await context.taskValue(task.id);
    let original = JSON.stringify(task);
    const admitted = async () => {
      input.signal.throwIfAborted();
      await input.guard();
      if (
        context.closing ||
        task.status !== "running" ||
        context.pausedGoals.has(task.goalId!) ||
        task.crewRunId ||
        task.crewDefinitionId ||
        task.error ||
        task.needsInput ||
        JSON.stringify(await context.unchangedTask(task.id, expected)) !== original
      )
        throw new Error("The managed worker was stopped, paused or changed before continuation.");
      if (
        task.maxRunMinutes > 0 &&
        (
          await sessionRunState(
            context.store,
            { ...task, startedAt: task.startedAt ?? task.createdAt },
            task.maxRunMinutes,
            context.now(),
          )
        ).state === "overLimit"
      )
        throw new Error("The original managed worker reached its time limit.");
      const budget = await context.budgetReason(task, true);
      if (budget) throw new Error(budget);
      const current = await context.store.session(input.sessionId);
      const session = current.session;
      const cwd = task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd;
      if (
        current.projectId !== task.projectId ||
        (session.worktreeCwd ?? session.cwd) !== cwd ||
        cwd !== input.source.executionCwd ||
        session.harness !== task.harness ||
        session.model !== task.model ||
        (session.providerAccountId ?? "default") !== (task.providerAccountId ?? "default") ||
        session.runtimeMode !== task.runtimeMode ||
        JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings)
      )
        throw new Error("The managed worker's original model or execution folder changed.");
    };
    await admitted();
    if (task.preflightRequirements?.length) {
      const report = await context.preflightAt(task, input.source.executionCwd);
      if (report.items.some((item) => item.required && item.state !== "ready"))
        throw new Error("The managed worker's required resources are no longer ready.");
    }
    await admitted();
    const session = (await context.store.session(input.sessionId)).session;
    const requestId = `assistant-history-${createHash("sha256").update(input.requestId).digest("hex")}`;
    const continueHistory = () =>
      context.continueHistory!({
        ...input,
        requestId,
        admitted,
        brief: [taskContract(task), buildDeterministicHandoff(session)].join("\n\n"),
        onAccepted: async (receipt) => {
          // This callback shares the engine's critical send transaction. A crash
          // cannot commit a new run while the task still follows the old one.
          await admitted();
          if (!receipt.runId)
            throw new Error("Worker continuation returned no original run receipt.");
          task = await context.write({
            ...task,
            runId: receipt.runId,
            updatedAt: context.now(),
            needsInput: undefined,
          });
          expected = await context.taskValue(task.id);
          original = JSON.stringify(task);
        },
      });
    const current = await context.store.session(input.sessionId);
    return await runAssistantSessionWork(context.store, context.engine as HostEngine, {
      source: { kind: "assistant", id: `job:${input.jobId}`, occurrence: requestId },
      projectId: task.projectId,
      target: assistantSessionWorkTarget(current, requestId),
      commandId: requestId,
      promptHash: createHash("sha256")
        .update(JSON.stringify({ text: input.text, source: input.source }))
        .digest("hex"),
      signal: input.signal,
      budgetScope: { taskId: task.id, ...(task.goalId ? { goalId: task.goalId } : {}) },
      admitted,
      run: continueHistory,
    });
  } finally {
    context.continuingSessions.delete(task.id);
  }
}
