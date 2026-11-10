import type { HostStore } from "../../store";
import type { HostEngine } from "../../engine";
import type { HostAssistant } from "../service";
import type { HostTasks } from "../../tasks/tasks";
import { HostAssistantSessions, type AssistantSessionPorts } from "./assistant-sessions";
import { sessionRunState } from "../../sessions/sessionRuns";
import { createHash } from "node:crypto";
import type { HostAssistantManualSessions } from "./assistant-manual-sessions";
import { buildDeterministicHandoff } from "../../../src/features/sessions/model/handoff";
import { assistantJobSessionBelongs } from "../work/assistant-job-scope";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import { HostAssistantWorkerRecovery } from "../work/assistant-worker-recovery";
import { validateAssistantQuestionReply } from "../core/assistant-questions";

/** Immutable-source checks stay at the actual engine effect, after all awaits. */
export function assistantSessionRuntime(
  store: HostStore,
  engine: HostEngine,
  assistant: HostAssistant,
  tasks?: HostTasks,
  manual?: HostAssistantManualSessions,
) {
  const recovery = tasks
    ? new HostAssistantWorkerRecovery(store, tasks, {
        allowed: (id) => assistant.workerRecoveryAllowed(id),
        reserve: (input) => assistant.reserveSessionTokens(input),
        onState: (record) => assistant.recordWorkerRecovery(record),
      })
    : undefined;
  const sameSource = async (
    id: string,
    source: {
      projectId: string;
      executionCwd: string;
      authorityGeneration?: number;
      runId?: string;
    },
  ) => {
    const current = await store.session(id);
    if (
      current.projectId !== source.projectId ||
      (current.session.worktreeCwd ?? current.session.cwd) !== source.executionCwd ||
      current.authorityGeneration !== source.authorityGeneration ||
      current.runId !== source.runId
    )
      throw new Error("The managed session execution identity changed.");
    return current;
  };
  const manualCommand = async (
    input:
      | Parameters<NonNullable<AssistantSessionPorts["send"]>>[0]
      | Parameters<NonNullable<AssistantSessionPorts["compact"]>>[0],
    command: unknown,
  ) => {
    if (input.scope !== "manual" || !manual)
      throw new Error("Explicit manual supervision is unavailable.");
    return engine.withCommandAdmission(
      {
        check: async (stage) => {
          input.signal.throwIfAborted();
          await input.recheck();
          const current = await store.session(input.sessionId);
          if (
            stage.sessionId !== input.sessionId ||
            current.projectId !== input.source.projectId ||
            (current.session.worktreeCwd ?? current.session.cwd) !== input.source.executionCwd ||
            current.authorityGeneration !== input.source.authorityGeneration ||
            current.runId !== (stage.phase === "command" ? input.source.runId : stage.runId)
          )
            throw new Error("The enrolled manual turn changed before dispatch.");
          const ownAuthor = "author" in input ? input.author : undefined;
          if (
            current.session.pendingQuestion ||
            current.session.pendingSwitch ||
            current.session.queuedMessages?.length ||
            current.session.blocks.some(
              (block) =>
                (block.approval && !block.approval.decided) ||
                (block.draft &&
                  !(
                    ownAuthor &&
                    block.author?.kind === "assistant-manual" &&
                    block.author.operationId === ownAuthor.operationId
                  )),
            )
          )
            throw new Error(
              "Preserve the owner's pending question, approval, queue or draft before supervision.",
            );
          await manual.resolveStatus(input.supervisionId, input.sessionId, input.grantVersion);
          input.signal.throwIfAborted();
        },
      },
      () => engine.command(command),
    );
  };
  return new HostAssistantSessions(store, {
    ready: recovery?.ready,
    ...(recovery
      ? {
          recoverWorker: (
            input: Parameters<NonNullable<AssistantSessionPorts["recoverWorker"]>>[0],
          ) => recovery.recover(input),
        }
      : {}),
    onManualLimit: (id, sessionId) => assistant.recordManualLimit(id, sessionId),
    ...(tasks ? { onReceiptChanged: () => tasks.assistantFollowupsChanged() } : {}),
    onReceiptNotificationError: (error) =>
      console.warn(
        "Assistant receipt metadata notification failed:",
        error instanceof Error ? error.message : String(error),
      ),
    allowed: () => assistant.supervisionAllowed(true),
    nudgeLimit: () => assistant.nudgeLimit(),
    questionsAllowed: () => assistant.routineQuestionsAllowed(),
    onAnswerSubmitted: (input) => assistant.recordSessionAnswer(input),
    ...(manual
      ? {
          resolveManual: (supervisionId: string, sessionId: string, expectedVersion?: number) =>
            manual.resolveStatus(supervisionId, sessionId, expectedVersion),
        }
      : {}),
    validateWrite: async (scope, sessionId) => {
      if (scope.scope === "manual") {
        if (!manual) throw new Error("Manual supervision is unavailable.");
        await manual.resolveStatus(scope.supervisionId, sessionId, scope.grantVersion);
        return;
      }
      if (!tasks) throw new Error("Canonical worker supervision is unavailable.");
      const row = await store.db
          .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
          .get(scope.jobId),
        record = await store.session(sessionId);
      if (
        !row ||
        !(await assistantJobSessionBelongs(
          store,
          JSON.parse(row.value) as AssistantJob,
          sessionId,
          record.projectId,
        ))
      )
        throw new Error("The worker's canonical goal/task/project relationship changed.");
      const workers = (await tasks.list()).filter(
        (task) =>
          task.goalId === `assistant-${scope.jobId}` &&
          task.sessionId === sessionId &&
          task.status === "running",
      );
      if (workers.length !== 1)
        throw new Error(
          "Supervisor writes support only the job's current worker. Planner repair uses goal replanning; independent review remains with its review owner.",
        );
    },
    reserveTokens: (input) => assistant.reserveSessionTokens(input),
    answerQuestion: async (input) => {
      if (!tasks || input.scope !== "job" || !input.source.runId)
        throw new Error("Routine answers require the exact current task worker.");
      input.signal.throwIfAborted();
      await input.recheck();
      const current = await sameSource(input.sessionId, input.source),
        reply = validateAssistantQuestionReply(current, input),
        question = current.session.pendingQuestion!;
      const commandId = `assistant-answer-${createHash("sha256").update(input.requestId).digest("hex")}`;
      await engine.withMessageAuthor(input.author, () =>
        tasks.managedSessionCommand(
          { ...input, questionToken: input.questionToken },
          {
            type: "answer",
            commandId,
            sessionId: input.sessionId,
            runId: input.source.runId,
            requestId: question.requestId,
            reply,
            authorityGeneration: input.source.authorityGeneration,
          },
        ),
      );
      return engine.questionAnswerDelivery(
        input.sessionId,
        input.source.runId,
        input.author.operationId!,
        input.signal,
      );
    },
    ...(tasks || manual
      ? {
          handoff: async (input: Parameters<NonNullable<AssistantSessionPorts["handoff"]>>[0]) => {
            input.signal.throwIfAborted();
            await input.recheck();
            await sameSource(input.sessionId, input.source);
            let receipt;
            if (input.scope === "manual") {
              if (!manual) throw new Error("Manual supervision is unavailable.");
              const record = await store.session(input.sessionId),
                requestId = `assistant-manual-history-${createHash("sha256").update(input.requestId).digest("hex")}`;
              const admitted = async () => {
                input.signal.throwIfAborted();
                await input.recheck();
                await manual.resolveStatus(
                  input.supervisionId,
                  input.sessionId,
                  input.grantVersion,
                );
                input.signal.throwIfAborted();
              };
              receipt = await engine.continueSessionHistory({
                ...input,
                requestId,
                brief: JSON.stringify({
                  kind: "bycoda.manual-continuation.v1",
                  supervisionId: input.supervisionId,
                  ownerSessionId: input.sessionId,
                  retained: buildDeterministicHandoff(record.session),
                }).slice(0, 32000),
                admitted,
                onAccepted: async () => {
                  await admitted();
                },
              });
            } else {
              if (!tasks) throw new Error("Canonical worker continuation is unavailable.");
              receipt = await tasks.continueManagedSession({ ...input, guard: input.recheck });
            }
            return {
              delivery: await engine.commandDelivery(
                input.sessionId,
                receipt.runId,
                `${receipt.commandId}-send`,
                false,
                input.signal,
              ),
            };
          },
        }
      : {}),
    compact: async (input) => {
      input.signal.throwIfAborted();
      const current = await sameSource(input.sessionId, input.source);
      if (current.status === "running")
        throw new Error("Wait for the managed session to be idle before compaction.");
      const commandId = `assistant-compact-${createHash("sha256").update(input.requestId).digest("hex")}`;
      const command = {
        type: "compact",
        commandId,
        sessionId: input.sessionId,
        authorityGeneration: input.source.authorityGeneration,
      };
      const receipt = await engine.withMessageAuthor(input.author, () =>
        input.scope === "manual"
          ? manualCommand(input, command)
          : tasks
            ? tasks.managedSessionCommand(input, command)
            : Promise.resolve(undefined),
      );
      if (!receipt) throw new Error("Canonical worker maintenance is unavailable.");
      if (!receipt.runId) throw new Error("Compaction did not return its original run identity.");
      await engine.waitForRun(input.sessionId, receipt.runId);
      input.signal.throwIfAborted();
      const settled = await store.session(input.sessionId);
      const outcome = await sessionRunState(
        store,
        { sessionId: input.sessionId, runId: receipt.runId, startedAt: current.updatedAt },
        0,
        Date.now(),
      );
      return {
        completed:
          settled.runId === receipt.runId &&
          settled.status === "idle" &&
          outcome.state === "finished" &&
          outcome.status === "succeeded",
      };
    },
    send: async (input) => {
      input.signal.throwIfAborted();
      const current = await sameSource(input.sessionId, input.source);
      const commandId = `assistant-message-${createHash("sha256").update(input.requestId).digest("hex")}`;
      const command =
        current.status === "running"
          ? {
              type: "steer",
              commandId,
              sessionId: input.sessionId,
              runId: input.source.runId!,
              text: input.text,
              authorityGeneration: input.source.authorityGeneration,
            }
          : {
              type: "send",
              commandId,
              sessionId: input.sessionId,
              text: input.text,
              authorityGeneration: input.source.authorityGeneration,
            };
      const receipt = await engine.withMessageAuthor(input.author, () =>
        input.scope === "manual"
          ? manualCommand(input, command)
          : tasks
            ? tasks.managedSessionCommand(input, command)
            : Promise.reject(new Error("Canonical worker supervision is unavailable.")),
      );
      return {
        delivery: await engine.commandDelivery(
          input.sessionId,
          current.status === "running" ? current.runId : receipt.runId,
          commandId,
          current.status === "running",
          input.signal,
        ),
      };
    },
  });
}
