import { hasUnmergedBranch, type HostTask } from "../../src/features/tasks/model/hostTasks";
import { blockedHandoff, taskContract } from "./task-handoff";
import { readTaskInstructions } from "../../src/features/tasks/model/taskInstructions";
import { acceptanceReviewInstructions } from "../../src/features/tasks/model/taskAcceptance";
import { openReviewNotesPrompt } from "../../src/features/tasks/model/taskReviewNotes";
export function reviewPrompt(task: HostTask): string {
  const changes =
    hasUnmergedBranch(task) && task.baseCommit
      ? `the changes made since commit ${task.baseCommit} (\`git diff ${task.baseCommit}\`)`
      : "the uncommitted changes in this folder (`git status`, `git diff`)";
  return [
    "You are reviewing work another agent just finished. Only inspect: do not edit, create or delete files, and do not commit.",
    "This is an unattended task review. Review both correctness and repository standards yourself, in one agent; do not spawn subagents or invoke a multi-agent review workflow. The task below is the complete spec, so do not set up an issue tracker or ask for another spec.",
    "Read the changed files and only the relevant dependencies and guidance. Reuse evidence within this review. Run focused checks once; repeat only after a change, failure or unresolved concern. Check whether added gates break development workflows. Report incomplete acceptance checks explicitly; passing this task does not imply release or physical-device approval.",
    "",
    `Task: ${task.title}`,
    "",
    "What was asked:",
    taskContract(task),
    "",
    `Review ${changes} and judge whether they do what was asked.`,
    'FAIL only for: (1) a defect inside the requested scope that breaks or omits the asked behavior, (2) a regression introduced by this change, (3) a failed configured check, or (4) a violation of an explicit hard constraint (security, data loss, permission/approval gates, repository rules such as AGENTS.md). Explain an actionable fix for each. New edge cases outside the asked scope, pre-existing issues, style preferences and improvements are non-blocking: record them with kind "suggestion" and do not FAIL for them.',
    "A worker reporting an unavailable physical-device, release or external-service acceptance check is not by itself a code defect: inspect the implementation and available evidence. Fail for missing acceptance evidence only when the task explicitly requires that evidence; never claim an unperformed check passed.",
    ...((task.repairAttempts ?? 0) > 0
      ? [
          "This is a correction round. Focus on verifying that the earlier findings are fixed and that the correction introduced no regression. Raise a new required finding only for a severe in-scope defect; anything else is a suggestion.",
        ]
      : []),
    openReviewNotesPrompt(task.reviewNotes),
    acceptanceReviewInstructions(readTaskInstructions(task.prompt)?.acceptance ?? []),
    'Before the final verdict, include a fenced json block {"reviewNotes":[{"finding":"specific defect, with file/location when known","suggestion":"actionable correction","kind":"finding"}]}. Use one entry per distinct finding. Use kind "suggestion" for optional improvements, which must not cause FAIL. On PASS all earlier open findings must be verified fixed; only optional suggestions may remain. Do not invent notes when there are none.',
    "Reuse the wording of an earlier finding when the same defect remains, so its history is retained rather than creating a duplicate.",
    'In that same JSON block include "resolvedNoteIds":["earlier-note-id"] only for earlier findings you verified fixed against code and checks. Resolve verified fixes even when another finding keeps this review at FAIL. Never resolve an unavailable acceptance check or a worker claim without verification. Absence from the new findings does not automatically resolve an old note.',
    'For every required finding add category "code" (locally fixable deliverable) or "external" (only an explicitly required acceptance check needs unavailable device/access/user input), and an actionable suggestion. Use external only after checking that no local implementation or test fix can address that finding. An external finding must name the unavailable resource and the exact next check. Mixed reviews keep code defects as code; never hide missing functionality as external. Both categories still require FAIL; the host keeps correcting code findings and reports external checks to the owner after the task finishes.',
    "",
    "End your reply with exactly one final line, either",
    "VERDICT: PASS",
    "or",
    "VERDICT: FAIL - <one sentence saying why>",
  ].join("\n");
}

/** The task's prompt, led by where to work when the task has a worktree of
 * its own: an agent told to work in the project folder would otherwise edit
 * the main checkout, leaving the task's branch empty. */
/** Unattended workers decide within scope and report briefly; the owner reads
 * this after the task finishes instead of being interrupted while it runs. */
const WORKER_COMPLETION_GUIDANCE = [
  "This task runs unattended and the owner is unavailable while it runs. Do not stop to ask questions: when something is ambiguous, choose the most reasonable option within the task scope, record the assumption, and finish the work. Stop only when a permission, credential or destructive action you are not authorized to take is required.",
  "End with a short final summary of at most about 8 lines: what changed, checks run with their results, and anything the owner must know (assumptions, unavailable checks, remaining risks).",
].join("\n");

export function workerPrompt(
  task: HostTask,
  projectCwd: string,
  sharedEdits: string[] = [],
): string {
  // Leads the prompt so a first-run task contract stays the trailing JSON block.
  return `${WORKER_COMPLETION_GUIDANCE}\n\n${workerInstructions(task, projectCwd, sharedEdits)}`;
}

export function workerInstructions(
  task: HostTask,
  projectCwd: string,
  sharedEdits: string[] = [],
): string {
  const shared = sharedEdits.length
    ? `Files with uncommitted edits by other sessions in ${projectCwd} (information only; they are not part of your base and must not be copied): ${sharedEdits.join(", ")}. Avoid editing these unless the task requires it; then keep your change minimal and self-contained so both can be reconciled on delivery.`
    : "";
  if (task.blockedTakeover)
    return [
      `Work only in ${task.worktreeCwd ?? projectCwd}${task.branch ? ` on ${task.branch}` : ""}. Commit scoped changes on your assigned branch and finish with a clean source tree. Never merge into the integration checkout, push or create PRs. The owner approves delivery separately; retain all existing work.`,
      taskContract(task),
      blockedHandoff(task),
      task.retryFeedback ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  if (task.mergeRepair)
    return [
      `Continue the existing task in ${task.worktreeCwd} on ${task.branch}. Do not edit or switch branches in ${projectCwd}.`,
      `Task: ${task.title}`,
      taskContract(task),
      task.mergeRepair.replayCommit
        ? `The delivery history was replaced. The host replayed only the recorded task changes onto base commit ${task.mergeRepair.baseHead} in this new checkout. The original result is retained. Resolve integration defects${task.mergeRepair.conflicts.length ? ` and conflicts in: ${task.mergeRepair.conflicts.join(", ")}` : ""}, and regenerate source-derived records against this checkout.`
        : `The host merged base commit ${task.mergeRepair.baseHead} into this task checkout. Resolve only the integration defects and conflicts in: ${task.mergeRepair.conflicts.join(", ")}.`,
      "Keep both the completed task and the newer base-branch functionality. Inspect each conflict; never blindly choose ours/theirs, reset, rebase, or discard work. Stage the resolved files and commit the integration result. Do not restart the task or broaden its scope. The host will rerun the configured checks and review before delivery.",
      openReviewNotesPrompt(task.reviewNotes),
      task.retryFeedback ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  const original =
    task.isolate === false
      ? `Work directly in ${task.worktreeCwd ?? projectCwd}, the selected checkout shared with other sessions. Preserve their uncommitted work and change only your assigned scope. Do not create another worktree or switch branches. Leave changes uncommitted for the owner's review; do not stage, commit, merge or push.\n\n${taskContract(task)}`
      : task.worktreeCwd
        ? [
            `You are working in ${task.worktreeCwd}, a separate checkout of the project at ${projectCwd}${task.branch ? ` on the branch ${task.branch}` : ""}. Make every change in this folder. Commit scoped changes on this branch and finish with a clean source tree. Never merge into the integration checkout, push or create PRs. Do not edit, commit in or switch branches in ${projectCwd}: paths under it in the task below mean the same files under this folder.`,
            ...(shared ? [shared] : []),
            "",
            taskContract(task),
          ].join("\n")
        : taskContract(task);
  const notes = openReviewNotesPrompt(task.reviewNotes);
  const prompt = notes ? `${original}\n\n${notes}` : original;
  if (!task.retryFeedback) return prompt;
  return [
    prompt,
    "",
    "The previous attempt did not pass verification. Continue from the existing work and fix the findings below before finishing. Check them against the source and the original task; do not bypass checks or broaden the task to make it pass.",
    "",
    "Previous verification feedback:",
    task.retryFeedback,
    "Briefly summarize the changes actually made, checks run with their results, which findings remain, and any unavailable resource plus the concrete next action. If an earlier correction did not address a finding, explain why and choose a different approach. Do not just repeat the previous completion claim or retry an unavailable physical acceptance test.",
  ].join("\n");
}
