import { hostQuestionToken } from "../../sessions/question-source";
import type { HostStore } from "../../store";
import type { HostSession } from "../../../src/features/connections/model/protocol";
import type { UserQuestion, UserQuestionReply } from "../../../src/features/sessions/model/userQuestion";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import { assistantJobSessionBelongs } from "../work/assistant-job-scope";
import { workerContextAction } from "../../../src/shared/model/assistantContext";

export type AssistantQuestionAnswer = {
  questionToken: string;
  answers: Record<string, string[]>;
  custom?: Record<string, string>;
};
export type AssistantQuestionStatus = {
  sessionId: string;
  questionId: string;
  questionToken?: string;
  questions?: UserQuestion[];
  questionOwnerRequired: boolean;
  questionOwnerReason?: string;
};

/** A conservative escalation filter, never a permission or semantic-safety grant. */
const ownerTopic =
  /(?:\b(?:approv\w*|permission\w*|authoriz\w*|privileg\w*|credential\w*|password\w*|secret\w*|token\w*|api[ -]?key|sudo|admin\w*|install\w*|uninstall\w*|delet\w*|remov\w*|publish\w*|deploy\w*|push\w*|merg\w*|send\w*|email\w*|payment\w*|purchas\w*|pay|buy|upload\w*|network\w*)\b|izin|onay|yetki|parola|şifre|kimlik bilg|gizli|yükle|kurulum|sil(?:me|mek|meli|insin|eyim|in|ebilir\w*)?\b|yayın|gönder|birleştir|ödeme|satın)/iu;
export const assistantQuestionToken = hostQuestionToken;
function questionReason(
  record: HostSession,
  enabled: boolean,
  inFlightToken?: string,
): string | undefined {
  const session = record.session,
    question = session.pendingQuestion;
  if (!enabled) return "Routine worker answers are disabled by the owner.";
  if (record.status !== "running" || !record.runId || !question?.occurrenceId)
    return "The question lacks a current Host-stamped occurrence.";
  if (session.blocks.some((block) => !!block.approval && !block.approval.decided))
    return "Actual permission and operation approvals always require the owner.";
  if (
    session.pendingSwitch ||
    session.queuedMessages?.length ||
    session.blocks.some((block) => !!block.draft)
  )
    return "Preserve the owner's pending switch, queue or draft.";
  if (
    ["sending", "queued", "unknown"].includes(question.delivery ?? "") &&
    !(question.delivery === "sending" && inFlightToken === assistantQuestionToken(record))
  )
    return "The question already has an unresolved answer delivery.";
  if (question.dismissAction !== "skip")
    return "This provider has not declared this clarification skippable.";
  if (
    question.questions.length < 1 ||
    question.questions.length > 5 ||
    question.questions.some(
      (item) =>
        !item.id ||
        item.id.length > 200 ||
        item.prompt.length > 1000 ||
        item.options.length > 10 ||
        item.options.some(
          (option) =>
            option.id.length > 200 ||
            option.label.length > 200 ||
            (option.description?.length ?? 0) > 300,
        ),
    )
  )
    return "This question exceeds the bounded routine-answer policy.";
  const source = JSON.stringify({ title: question.title, questions: question.questions });
  if (ownerTopic.test(source))
    return "This question concerns authority, publication, credentials, sending or destructive changes. Ask the owner.";
  return;
}
export async function readAssistantQuestionStatus(
  store: HostStore,
  record: HostSession,
  jobId?: string,
  enabled = false,
  inFlightToken?: string,
): Promise<AssistantQuestionStatus | undefined> {
  const question = record.session.pendingQuestion;
  if (!question) return;
  let reason = questionReason(record, enabled, inFlightToken);
  if (!reason) {
    const profile = await store.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get();
    if (
      workerContextAction(
        record.session.context?.used,
        record.session.context?.window,
        profile ? JSON.parse(profile.value) : {},
      ) !== "send"
    )
      reason =
        "This worker needs context maintenance before another answer. Preserve the pending question and ask the owner.";
  }
  if (!reason) {
    if (!jobId)
      reason = "Only a current worker of an assistant-owned job may receive routine answers.";
    else {
      const row = await store.db
          .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
          .get(jobId),
        tables = await store.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
          .get();
      if (!row || !tables) reason = "The canonical assistant job or task is unavailable.";
      else {
        const job = JSON.parse(row.value) as AssistantJob;
        if (
          job.kind === "quick" ||
          ["paused", "done", "failed", "cancelled"].includes(job.status) ||
          !(await assistantJobSessionBelongs(store, job, record.session.id, record.projectId))
        )
          reason = "The canonical job/session relationship changed.";
        else {
          const rows = await store.db
              .prepare(
                "SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=? AND json_extract(value,'$.sessionId')=?",
              )
              .all(`assistant-${jobId}`, record.session.id),
            tasks = rows.map((row) => JSON.parse(row.value));
          if (
            tasks.length !== 1 ||
            tasks[0].status !== "running" ||
            tasks[0].runId !== record.runId ||
            tasks[0].projectId !== record.projectId ||
            tasks[0].crewRunId ||
            tasks[0].crewDefinitionId ||
            tasks[0].error
          )
            reason =
              "Independent reviewers, planners, Crews and replaced workers require their existing owner.";
          if (!reason) {
            if (record.session.orchestrationLeadId)
              reason = "Internal orchestration workers keep their canonical owner.";
            const present = new Set(
              (
                await store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
              ).map((row) => String(row.name)),
            );
            for (const table of [
              "tasks",
              "goals",
              "automations",
              "automation_runs",
              "stewards",
              "crew_runs",
              "crew_run_members",
            ] as const) {
              if (reason || !present.has(table)) continue;
              const columns = await store.db.prepare(`PRAGMA table_info(${table})`).all();
              if (!columns.some((column) => column.name === "value")) continue;
              const conflicts = await store.db
                .prepare(
                  `SELECT ${table === "tasks" ? "tasks.id" : "''"} AS owner_id,node.fullkey AS source_key FROM ${table},json_tree(${table}.value) AS node WHERE node.type='text' AND node.value=? AND lower(CAST(node.key AS TEXT)) IN ('sessionid','workersessionid','reviewersessionid','previoussessionid','plannersessionid','lastsessionid')`,
                )
                .all(record.session.id);
              if (
                conflicts.some(
                  (row) =>
                    table !== "tasks" ||
                    row.owner_id !== tasks[0].id ||
                    row.source_key !== "$.sessionId",
                )
              )
                reason =
                  "This conversation also has a planner, reviewer, automation, steward, Crew or different task owner.";
            }
            if (
              !reason &&
              (present.has("crew_runs_v2") || present.has("metadata")) &&
              (await store.db
                .prepare(
                  present.has("crew_runs_v2")
                    ? "SELECT 1 FROM crew_runs_v2 WHERE coordinator_session_id=? LIMIT 1"
                    : "SELECT 1 FROM metadata,json_tree(metadata.value,'$.runs') node WHERE metadata.key='crews.v1' AND node.key='coordinatorSessionId' AND node.value=? LIMIT 1",
                )
                .get(record.session.id))
            )
              reason = "This conversation is a Crew coordinator.";
          }
        }
      }
    }
  }
  return {
    sessionId: record.session.id,
    questionId: String(question.requestId),
    questionToken: assistantQuestionToken(record),
    questionOwnerRequired: !!reason,
    ...(reason
      ? { questionOwnerReason: reason }
      : { questions: structuredClone(question.questions) }),
  };
}
export function validateAssistantQuestionReply(
  record: HostSession,
  input: AssistantQuestionAnswer,
): Extract<UserQuestionReply, { kind: "answered" }> {
  const question = record.session.pendingQuestion;
  if (!question || assistantQuestionToken(record) !== input.questionToken)
    throw new Error(
      "The original question occurrence changed; take fresh status before answering.",
    );
  const reason = questionReason(record, true);
  if (reason) throw new Error(reason);
  const ids = new Set(question.questions.map((item) => item.id));
  if (
    Object.keys(input.answers).some((id) => !ids.has(id)) ||
    Object.keys(input.custom ?? {}).some((id) => !ids.has(id))
  )
    throw new Error("The answer contains a different question identity.");
  for (const item of question.questions) {
    const selected = input.answers[item.id] ?? [],
      custom = input.custom?.[item.id];
    if (
      new Set(selected).size !== selected.length ||
      (!item.multiSelect && selected.length > 1) ||
      selected.some((id) => !item.options.some((option) => option.id === id))
    )
      throw new Error("Choose only exact canonical question options.");
    if (
      custom !== undefined &&
      (!item.allowCustom || !custom.trim() || custom.length > 1000 || ownerTopic.test(custom))
    )
      throw new Error("This custom answer needs owner review.");
    if (!selected.length && !custom?.trim())
      throw new Error("Answer every canonical question before continuing.");
  }
  return {
    kind: "answered",
    answers: structuredClone(input.answers),
    ...(input.custom ? { custom: structuredClone(input.custom) } : {}),
  };
}
