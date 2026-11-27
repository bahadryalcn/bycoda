import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import {
  crewIncompatibility,
  type ResolvedExecutor,
} from "../../src/shared/model/host-contracts/work-executor";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import type { DecisionRequest, DecisionResult } from "../decision-models/decision-types";

/** A crew the Host could run this work with, as the chooser sees it. */
export type CrewChoice = { id: string; name: string; summary: string };

/** The decision gate and the crew list this choice needs; both optional on a Host without them. */
export type ExecutorChoiceDeps = {
  crews?: (projectId: string) => Promise<CrewChoice[]>;
  decisions?: { decide(request: DecisionRequest): Promise<DecisionResult> };
};

/** A single agent is the answer whenever the gate is unsure. */
const AGENT_KEY = "agent";
const REQUEST_LIMIT = 4000;

/**
 * Who runs this task: the executor the owner picked, or for `auto` the Host's choice. Eligible
 * crews are the project's crews that fit the task's own options; none means one agent. Otherwise
 * one `choice` question goes to the decision gate, and anything but a confident crew answer is
 * one agent. The reason is recorded in `resolved`; nothing is retried or guessed.
 */
export async function chooseExecutor(
  deps: ExecutorChoiceDeps,
  task: Pick<
    HostTask,
    | "executor"
    | "resolved"
    | "projectId"
    | "request"
    | "prompt"
    | "isolate"
    | "workspace"
    | "review"
    | "autoMerge"
    | "continueUntilDone"
    | "modelChoice"
    | "crewRunId"
  >,
): Promise<{ executor: ResolvedExecutor; reason?: string }> {
  const { executor } = task;
  if (executor?.kind === "crew") return { executor };
  if (executor?.kind !== "auto") return { executor: { kind: "agent" } };
  // The choice is made once; a restart or retry keeps it.
  if (task.resolved) return { executor: task.resolved.executor, reason: task.resolved.reason };
  if (task.crewRunId) return { executor: { kind: "agent" } };
  if (!deps.crews) return { executor: { kind: "agent" }, reason: "Crews are unavailable here." };
  const conflict = crewIncompatibility(task);
  if (conflict)
    return {
      executor: { kind: "agent" },
      reason: `No crew fits: ${conflict.field}. ${conflict.reason}`,
    };
  const crews = (await deps.crews(task.projectId).catch(() => [])).filter(
    (crew) => crew.id !== AGENT_KEY,
  );
  if (!crews.length)
    return { executor: { kind: "agent" }, reason: "No crew is available in this project." };
  if (!deps.decisions)
    return { executor: { kind: "agent" }, reason: "No decision model is set up; one agent runs." };
  const result = await deps.decisions
    .decide({
      taskType: "generic",
      // The request is the owner's own text: with local-only personal data on, only local sources read it.
      personalData: true,
      state: { request: truncateGraphemes(task.request ?? task.prompt, REQUEST_LIMIT) },
      questions: {
        executor: {
          type: "choice",
          instructions:
            "Who should do this work? Choose a crew only when the request clearly needs several specialists; otherwise choose agent. Answer with exactly one key.",
          criteria: {
            [AGENT_KEY]: "One agent does the work alone.",
            ...Object.fromEntries(
              crews.map((crew) => [
                crew.id,
                truncateGraphemes(`${crew.name}: ${crew.summary}`, 240),
              ]),
            ),
          },
        },
      },
      timeoutMs: 15_000,
    })
    .catch(() => undefined);
  const answer = result?.answers.executor;
  if (!answer || "error" in answer)
    return {
      executor: { kind: "agent" },
      reason: `One agent runs: the decision model gave no confident answer${answer ? ` (${answer.error})` : ""}.`,
    };
  const crew = crews.find((entry) => entry.id === answer.value);
  if (!crew)
    return { executor: { kind: "agent" }, reason: "One agent runs: the decision model chose it." };
  return {
    executor: { kind: "crew", crewDefinitionId: crew.id },
    reason: `Chose crew ${crew.name} (confidence ${Math.round(answer.confidence * 100)}%).`,
  };
}
