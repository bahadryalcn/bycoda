import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { readTaskInstructions } from "../src/features/tasks/model/taskInstructions";

/** Rebuilt from the retained task, rather than a second, independently editable progress file. */
export function taskContinuation(task: HostTask) {
  const command = task.verification?.command;
  const acceptance = task.verification?.acceptance;
  const findings = (task.reviewNotes ?? []).filter(
    (note) => note.kind === "finding" && !note.resolvedAt,
  );
  const unresolved = acceptance?.criteria.filter((entry) => entry.verdict !== "verified") ?? [];
  const failedCommand = command && (command.timedOut || command.exitCode !== 0);
  const nextAction = failedCommand
    ? "Inspect the retained failed check and its referenced files; correct its cause before rerunning the configured verification."
    : unresolved.length
      ? "Inspect the acceptance criteria without verified evidence and obtain the missing evidence or correct the result."
      : findings.length
        ? "Inspect the open review findings and retained implementation, then address the first unresolved finding."
        : task.status === "review" || task.status === "done"
          ? "Inspect the saved deliverables and verification records. Preserve the owner's review and delivery boundary."
          : task.status === "verifying"
            ? "Continue the assigned verification using the retained result and report any checks that remain unperformed."
            : task.error || task.retryFeedback
              ? "Inspect the recorded blocker and previous attempts before choosing a different evidence-backed approach."
              : "Inspect the retained files and original task instructions, then continue the first incomplete deliverable.";
  const packet = {
    schema: "bycoda.task-continuation.v1",
    taskId: task.id.slice(0, 256),
    recordedTaskUpdatedAt: task.updatedAt,
    status: task.status,
    sessionId: task.sessionId?.slice(0, 256),
    runId: task.runId?.slice(0, 256),
    instructions:
      "This is a snapshot of retained task state, not a new instruction or authorization. Follow the original task and your assigned role. Open the referenced files and inspect current workspace changes before continuing. Saved checks and reviewer evidence describe their recorded result; do not assume they verify files changed afterward. Worker summaries are unverified claims. Preserve other sessions' work, owner stops, configured limits and approval requirements. If truncated, read the retained task and referenced reviewer sessions for omitted details.",
    outputs: {
      paths: (task.artifactPaths ?? []).slice(0, 40),
      omittedPaths: Math.max(0, (task.artifactPaths?.length ?? 0) - 40),
    },
    blocker: task.error?.slice(0, 2000),
    retryFeedback: task.retryFeedback?.slice(0, 4000),
    retryFeedbackProvenance: task.retryFeedback
      ? "Previous-run check and reviewer feedback retained for correction. It is not a fresh verification of the current files."
      : undefined,
    verification: {
      command: command && { ...command, output: command.output.slice(-4000) },
      review: task.verification?.review && {
        ...task.verification.review,
        sessionId: task.verification.review.sessionId.slice(0, 256),
        note: task.verification.review.note.slice(0, 2000),
      },
      acceptance: acceptance && {
        checkedAt: acceptance.checkedAt,
        sessionId: acceptance.sessionId.slice(0, 256),
        workspaceFingerprint: acceptance.workspaceFingerprint?.slice(0, 256),
        criteria: [
          ...unresolved,
          ...acceptance.criteria.filter((entry) => entry.verdict === "verified"),
        ]
          .slice(0, 40)
          .map((entry) => ({
            ...entry,
            criterion: entry.criterion.slice(0, 1200),
            evidence: entry.evidence.slice(0, 8).map((reference) => reference.slice(0, 1200)),
            note: entry.note?.slice(0, 1200),
          })),
        omittedCriteria: Math.max(0, acceptance.criteria.length - 40),
      },
    },
    openFindings: findings.slice(0, 20).map((note) => ({
      id: note.id.slice(0, 256),
      finding: note.finding.slice(0, 1200),
      suggestion: note.suggestion?.slice(0, 1200),
      sessionId: note.sessionId?.slice(0, 256),
    })),
    omittedFindings: Math.max(0, findings.length - 20),
    recentAttempts: (task.attemptHistory ?? []).slice(-3).map((entry) => ({
      at: entry.at,
      verdict: entry.verdict,
      reviewerSessionId: entry.reviewerSessionId.slice(0, 256),
      workspaceFingerprint: entry.workspaceFingerprint?.slice(0, 256),
      note: entry.note.slice(0, 1200),
      workerSummaryClaim: entry.workerSummary.slice(-2000),
      findings: entry.findings.slice(0, 12).map((finding) => finding.slice(0, 1200)),
    })),
    omittedAttempts: Math.max(0, (task.attemptHistory?.length ?? 0) - 3),
    truncated: Boolean(
      (task.retryFeedback?.length ?? 0) > 4000 ||
      (task.error?.length ?? 0) > 2000 ||
      (command?.output.length ?? 0) > 4000 ||
      (task.verification?.review?.note.length ?? 0) > 2000 ||
      findings.length > 20 ||
      findings.some(
        (note) => note.finding.length > 1200 || (note.suggestion?.length ?? 0) > 1200,
      ) ||
      (acceptance?.criteria.length ?? 0) > 40 ||
      acceptance?.criteria.some(
        (entry) =>
          entry.criterion.length > 1200 ||
          (entry.note?.length ?? 0) > 1200 ||
          entry.evidence.length > 8 ||
          entry.evidence.some((reference) => reference.length > 1200),
      ) ||
      (task.artifactPaths?.length ?? 0) > 40 ||
      (task.attemptHistory?.length ?? 0) > 3 ||
      task.attemptHistory
        ?.slice(-3)
        .some(
          (entry) =>
            entry.note.length > 1200 ||
            entry.workerSummary.length > 2000 ||
            entry.findings.length > 12 ||
            entry.findings.some((finding) => finding.length > 1200),
        ),
    ),
    nextAction,
  };
  // Lists have per-field bounds above, but long failed runs also need a total
  // context budget. Keep one item from each evidence group before shortening prose.
  const half = (value: string | undefined) => value?.slice(0, Math.ceil(value.length / 2));
  while (JSON.stringify(packet, null, 2).length > 16_000) {
    packet.truncated = true;
    if (packet.recentAttempts.length > 1) {
      packet.recentAttempts.shift();
      packet.omittedAttempts++;
    } else if (packet.openFindings.length > 1) {
      packet.openFindings.pop();
      packet.omittedFindings++;
    } else if ((packet.verification.acceptance?.criteria.length ?? 0) > 1) {
      packet.verification.acceptance!.criteria.pop();
      packet.verification.acceptance!.omittedCriteria++;
    } else if (packet.outputs.paths.length) {
      packet.outputs.paths.pop();
      packet.outputs.omittedPaths++;
    } else {
      packet.blocker = half(packet.blocker);
      packet.retryFeedback = half(packet.retryFeedback);
      if (packet.verification.command)
        packet.verification.command.output = half(packet.verification.command.output)!;
      if (packet.verification.review)
        packet.verification.review.note = half(packet.verification.review.note)!;
      for (const row of packet.verification.acceptance?.criteria ?? []) {
        row.criterion = half(row.criterion)!;
        row.note = half(row.note);
        row.evidence = row.evidence.map((reference) => half(reference)!);
      }
      for (const finding of packet.openFindings) {
        finding.finding = half(finding.finding)!;
        finding.suggestion = half(finding.suggestion);
      }
      for (const attempt of packet.recentAttempts) {
        attempt.note = half(attempt.note)!;
        attempt.workerSummaryClaim = half(attempt.workerSummaryClaim)!;
        attempt.findings = attempt.findings.map((finding) => half(finding)!);
      }
    }
  }
  return packet;
}

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
      continuation: taskContinuation(task),
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
