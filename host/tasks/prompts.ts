import { hasUnmergedBranch, type HostTask } from "../../src/features/tasks/model/hostTasks";
import {
  blockedHandoff,
  latestAttemptSummary,
  reviewerContract,
  workerContract,
} from "./task-handoff";
import { readTaskInstructions } from "../../src/features/tasks/model/taskInstructions";
import { acceptanceReviewInstructions } from "../../src/features/tasks/model/taskAcceptance";
import { openReviewNotesPrompt } from "../../src/features/tasks/model/taskReviewNotes";

/** Total characters of earlier-attempt feedback (review notes plus check and
 * acceptance feedback) one worker prompt may carry. */
export const FEEDBACK_LIMIT = 12_000;
const RETRY_SHARE = 4_000;

/** The reviewer only needs to re-check what is still open, with the ids it may resolve. */
function openFindingsForReview(task: HostTask): string {
  const open = (task.reviewNotes ?? [])
    .filter((note) => note.kind === "finding" && note.resolvedAt === undefined)
    .slice(0, 20);
  if (!open.length) return "";
  return [
    "Earlier findings still open (verify each against the code):",
    ...open.map((note) => `- ${note.id}: ${note.finding.slice(0, 600)}`),
  ].join("\n");
}

export function reviewPrompt(task: HostTask): string {
  const changes =
    hasUnmergedBranch(task) && task.baseCommit
      ? `the changes made since commit ${task.baseCommit} (\`git diff ${task.baseCommit}\`)`
      : "the uncommitted changes in this folder (`git status`, `git diff`)";
  const acceptance = acceptanceReviewInstructions(
    readTaskInstructions(task.prompt)?.acceptance ?? [],
  );
  return [
    "You are reviewing work another agent just finished. Only inspect: do not edit, create or delete files, and do not commit. Review correctness and repository standards yourself in this one agent: no subagents, multi-agent workflow or issue tracker. The task below is the complete spec.",
    "Read the changed files and only the relevant dependencies and guidance. Run focused checks once; repeat only after a change, failure or unresolved concern. Report incomplete acceptance checks explicitly; PASS does not imply release or physical-device approval.",
    "What was asked:\n" + reviewerContract(task, { omitAcceptance: Boolean(acceptance) }),
    `Review ${changes} and judge whether they do what was asked.`,
    'FAIL only for: (1) a defect inside the requested scope that breaks or omits the asked behavior, (2) a regression introduced by this change, (3) a violation of an explicit hard constraint (security, data loss, permission/approval gates, repository rules such as AGENTS.md). A failed configured check is a reason to FAIL only when it establishes one of these defects or violates an explicit task requirement. Apply release-tier expectations only when the task explicitly requests a release; a title such as publishable alone does not request one. Give an actionable fix for each. Edge cases outside the scope, pre-existing issues, style preferences and improvements are suggestions (kind "suggestion"), never a reason to FAIL.',
    "An unavailable physical-device, release or external-service check is not by itself a code defect: inspect the implementation and available evidence, and fail for missing evidence only when the task explicitly requires it. Never claim an unperformed check passed.",
    ...((task.repairAttempts ?? 0) > 0
      ? [
          "This is a correction round: verify the earlier findings are fixed and the correction caused no regression. Raise a new required finding only for a severe in-scope defect.",
        ]
      : []),
    openFindingsForReview(task),
    acceptance,
    'Before the verdict, give one fenced json block: {"reviewNotes":[{"finding":"specific defect, with file/location","suggestion":"actionable correction","kind":"finding","category":"code"}],"resolvedNoteIds":["earlier-note-id"]}. One entry per distinct finding; reuse an earlier finding\'s wording when the defect remains. kind "suggestion" is for optional improvements. Every required finding needs category "code" (locally fixable) or "external" (only an explicitly required check needing unavailable device, access or user input; name the resource and the exact next check, and use it only when no local fix can address the finding). Both categories still FAIL; the host keeps correcting code findings. resolvedNoteIds lists only earlier findings you verified fixed against code and checks, even when the review still FAILs; absence from the new notes does not resolve a note. On PASS all earlier findings must be verified fixed. Add no notes when there are none.',
    "End your reply with exactly one final line, either\nVERDICT: PASS\nor\nVERDICT: FAIL - <one sentence saying why>",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Unattended workers decide within scope and report briefly; the owner reads
 * this after the task finishes instead of being interrupted while it runs. */
function workerGuidance(task: HostTask): string {
  return [
    "This task runs unattended and the owner is unavailable. Do not stop to ask questions: when something is ambiguous, choose the most reasonable option within the task scope, record the assumption and finish. Stop only when a permission, credential or destructive action you are not authorized to take is required. The host-assigned agent and model satisfy any model requirement in the task text.",
    ...(task.continueUntilDone
      ? [
          "Keep going until the task is complete; try a different approach when one fails. An explicit owner stop and the configured run limit still apply.",
        ]
      : []),
    "End with a short final summary of at most about 8 lines: what changed, checks run with their results, and anything the owner must know (assumptions, unavailable checks, remaining risks).",
  ].join("\n");
}

export function workerPrompt(
  task: HostTask,
  projectCwd: string,
  sharedEdits: string[] = [],
): string {
  // Leads the prompt so a first-run task contract stays the trailing JSON block.
  return `${workerGuidance(task)}\n\n${workerInstructions(task, projectCwd, sharedEdits)}`;
}

/** Where to work and what to leave behind; stated once per prompt. */
function checkoutRule(task: HostTask, projectCwd: string): string {
  if (task.isolate === false)
    return `Work directly in ${task.worktreeCwd ?? projectCwd}, the selected checkout shared with other sessions. Preserve their uncommitted work and change only your assigned scope. Do not create another worktree or switch branches. Leave changes uncommitted for the owner's review; do not stage, commit, merge or push.`;
  if (!task.worktreeCwd) return "";
  return `You are working in ${task.worktreeCwd}, a separate checkout of the project at ${projectCwd}${task.branch ? ` on the branch ${task.branch}` : ""}. Make every change in this folder. Commit scoped changes on this branch and finish with a clean source tree. Never merge into the integration checkout, push or create PRs. Do not edit, commit in or switch branches in ${projectCwd}: paths under it in the task below mean the same files under this folder.`;
}

/** Earlier-attempt feedback, each fact once: structured findings in the review
 * notes, check and acceptance results in the retry feedback. One total cap. */
function feedbackBlocks(task: HostTask): { notes: string; retry: string } {
  const retry = [task.retryFeedback, task.retryFeedback ? latestAttemptSummary(task) : ""]
    .filter(Boolean)
    .join("\n\n");
  const notes = openReviewNotesPrompt(
    task.reviewNotes,
    FEEDBACK_LIMIT - Math.min(retry.length, RETRY_SHARE),
  );
  return { notes, retry: retry.slice(0, FEEDBACK_LIMIT - notes.length) };
}

export function workerInstructions(
  task: HostTask,
  projectCwd: string,
  sharedEdits: string[] = [],
): string {
  const shared = sharedEdits.length
    ? `Files with uncommitted edits by other sessions in ${projectCwd} (information only; not part of your base and must not be copied): ${sharedEdits.join(", ")}. Avoid editing these unless the task requires it; then keep your change minimal and self-contained so both can be reconciled on delivery.`
    : "";
  const { notes, retry } = feedbackBlocks(task);
  const contract = workerContract(task);
  if (task.blockedTakeover)
    return [
      checkoutRule(task, projectCwd) ||
        `Work only in ${projectCwd}. Commit scoped changes and never merge, push or create PRs; the owner approves delivery separately.`,
      "Retain all existing work.",
      contract,
      blockedHandoff(task),
      notes,
      retry,
    ]
      .filter(Boolean)
      .join("\n\n");
  if (task.mergeRepair)
    return [
      `Continue the existing task in ${task.worktreeCwd} on ${task.branch}; do not edit or switch branches in ${projectCwd}.`,
      contract,
      task.mergeRepair.replayCommit
        ? `The delivery history was replaced. The host replayed only the recorded task changes onto base commit ${task.mergeRepair.baseHead} in this new checkout. Resolve integration defects${task.mergeRepair.conflicts.length ? ` and conflicts in: ${task.mergeRepair.conflicts.join(", ")}` : ""}, and regenerate source-derived records (inventories, file lists, line references, hashes, snapshots) against this checkout.`
        : `The host merged base commit ${task.mergeRepair.baseHead} into this checkout. Resolve only the integration defects and conflicts in: ${task.mergeRepair.conflicts.join(", ")}.`,
      "Keep both the completed task and the newer base-branch functionality. Inspect each conflict; never blindly choose ours/theirs, reset, rebase or discard work. Stage the resolved files and commit the integration result. Do not restart or broaden the task; the host reruns the checks and review before delivery.",
      notes,
      retry,
    ]
      .filter(Boolean)
      .join("\n\n");
  return [
    checkoutRule(task, projectCwd),
    shared,
    contract,
    notes,
    ...(retry
      ? [
          `The previous attempt did not pass verification. Continue from the existing work and fix the findings; check them against the source and the task, and do not bypass checks or broaden the task.\n\nPrevious verification feedback:\n${retry}`,
          "In your summary also say which findings remain and any unavailable resource with the concrete next action. If an earlier correction missed a finding, choose a different approach; do not repeat the previous completion claim or retry an unavailable physical acceptance test.",
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
