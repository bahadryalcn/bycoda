import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { readTaskInstructions } from "../src/features/tasks/model/taskInstructions";

export function taskContract(task: HostTask): string {
  return JSON.stringify(
    {
      schema: "bycoda.task-contract.v1",
      task: {
        id: task.id,
        title: task.title,
        instructions: readTaskInstructions(task.prompt) ?? { objective: task.prompt },
      },
      workspace: { path: task.worktreeCwd, branch: task.branch, baseCommit: task.baseCommit },
      // Planned prompts may name a model the owner later changed. The host's
      // assignment is authoritative, so such text must never stall a run.
      runtime: {
        harness: task.harness,
        model: task.model,
        instructions:
          "The host already assigned this run's agent, model and settings. Model or provider requirements in the task instructions are satisfied by this assignment: never stop, ask to switch models, or fail a review over them. Sub-agent restrictions still apply.",
      },
      integration: task.mergeRepair && {
        ...task.mergeRepair,
        ...(task.mergeRepair.replayCommit
          ? {
              instructions:
                "The task was replayed onto a newer base commit in a new checkout. Regenerate records derived from source, such as inventories, file lists, line references, hashes and snapshots, against this checkout; the original snapshot is provenance only.",
            }
          : {}),
      },
      verification: { command: task.verifyCommand, reviewRequired: task.review !== false },
      ...(task.continueUntilDone
        ? {
            execution: {
              continueUntilDone: true,
              instructions:
                "Continue until the task is complete. Resolve routine implementation choices autonomously, preserve completed work and use a different approach when needed. Ask only for a concrete missing resource, access or owner decision. An explicit owner stop and the configured run limit still apply.",
            },
          }
        : {}),
    },
    null,
    2,
  );
}

export function blockedHandoff(task: HostTask): string {
  return [
    "You are the independent recovery agent taking over a BLOCKED task. Inspect the retained work and diagnose why earlier attempts failed before editing. Complete the original task using a different, evidence-backed approach; do not repeat unsuccessful attempts. Work alone in the assigned checkout, preserve completed work, and do not spawn another recovery agent.",
    "Investigate whether a claimed external blocker has a valid local solution or available alternative. Never weaken acceptance criteria, invent evidence, bypass checks, obtain credentials, or claim unavailable device tests passed. If genuinely impossible with current access, stop and ask one specific question naming the missing resource and the exact next action. Do not ask the owner to restate the task or monitor progress.",
    "The original checks and an independent review still decide completion. Return a concise handoff: root cause, changes, evidence, remaining blockers and (only if necessary) one concrete owner request.",
    JSON.stringify(
      {
        schema: "bycoda.blocked-handoff.v1",
        blocker: task.blockedTakeover?.blocker,
        previousSessionId: task.blockedTakeover?.previousSessionId,
        attempts: (task.attemptHistory ?? []).slice(-3).map((entry) => ({
          verdict: entry.verdict,
          note: entry.note,
          workerSummary: entry.workerSummary.slice(-2000),
          findings: entry.findings.slice(0, 12).map((finding) => finding.slice(0, 1200)),
        })),
        openFindings: (task.reviewNotes ?? [])
          .filter((note) => note.kind === "finding" && !note.resolvedAt)
          .slice(0, 20)
          .map((note) => ({
            finding: note.finding.slice(0, 1200),
            suggestion: note.suggestion?.slice(0, 1200),
            category: note.category,
          })),
      },
      null,
      2,
    ),
  ].join("\n\n");
}
