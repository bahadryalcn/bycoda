import { withTimeout } from "../../../../shared/lib/withTimeout";
import { invokeProviderCommand } from "../../core/child";
import type { HarnessEvent } from "../../core/types";
import {
  asRecord,
  assistantTextBlocks,
  assistantThinkingBlocks,
  assistantToolUses,
  previewFromTool,
  stringField,
  toolKindFromName,
  toolResultsFromUserMessage,
  toolTitle,
} from "./claudeProtocol";

export type ClaudeWorkflowReference = {
  callId: string;
  runId: string;
  taskId: string;
  status?: "completed" | "failed" | "stopped";
};

export function workflowReference(
  rec: Record<string, unknown>,
): ClaudeWorkflowReference | undefined {
  const result = asRecord(rec.toolUseResult) ?? asRecord(rec.tool_use_result);
  if ((stringField(result, "taskType") ?? stringField(result, "task_type")) !== "local_workflow")
    return undefined;
  const runId = stringField(result, "runId") ?? stringField(result, "run_id");
  const taskId = stringField(result, "taskId") ?? stringField(result, "task_id");
  const calls = toolResultsFromUserMessage(rec);
  if (!runId || !taskId || calls.length !== 1) return undefined;
  return { runId, taskId, callId: calls[0].toolUseId };
}

/** Find workflow identities in a provider transcript without trusting its paths. */
export function claudeWorkflowReferences(transcript: string): ClaudeWorkflowReference[] {
  const references = new Map<string, ClaudeWorkflowReference>();
  const workflowCalls = new Set<string>();
  const outcomes = new Map<string, "completed" | "failed" | "stopped">();
  for (const line of transcript.split("\n")) {
    try {
      const rec = asRecord(JSON.parse(line));
      if (!rec) continue;
      for (const use of assistantToolUses(rec))
        if (use.name === "Workflow") workflowCalls.add(use.id);
      const reference = workflowReference(rec);
      if (reference && workflowCalls.has(reference.callId))
        references.set(reference.callId, reference);
      const origin = asRecord(rec.origin);
      const content = asRecord(rec.message)?.content;
      if (
        rec.type === "user" &&
        stringField(origin, "kind") === "task-notification" &&
        stringField(origin, "producer") === "session-task" &&
        typeof content === "string" &&
        /^\s*<task-notification>/.test(content)
      ) {
        const taskId = /<task-id>([^<>]+)<\/task-id>/.exec(content)?.[1];
        const status = /<status>(completed|failed|stopped)<\/status>/.exec(content)?.[1];
        if (taskId && (status === "completed" || status === "failed" || status === "stopped"))
          outcomes.set(taskId, status);
      }
    } catch {
      /* A partial JSONL line is not a record. */
    }
  }
  const found = [...references.values()];
  return found.map((reference) => ({
    ...reference,
    ...(found.filter((entry) => entry.taskId === reference.taskId).length === 1 &&
    outcomes.has(reference.taskId)
      ? { status: outcomes.get(reference.taskId)! }
      : {}),
  }));
}

/** Read a bounded native snapshot. The native side resolves and validates all paths. */
export async function loadClaudeWorkflowArtifacts(input: {
  cwd: string;
  providerAccountId?: string;
  providerSessionId: string;
  runId: string;
  callId: string;
  onEvent: (event: HarnessEvent) => void;
  status?: "in_progress" | "completed" | "interrupted";
  snapshotCache?: Map<string, string>;
}): Promise<void> {
  const artifacts = await withTimeout(
    invokeProviderCommand<Array<{ agentId: string; metadata: string; transcript: string }>>(
      "harness_claude_workflow_artifacts",
      {
        cwd: input.cwd,
        providerAccountId: input.providerAccountId,
        providerSessionId: input.providerSessionId,
        runId: input.runId,
      },
    ),
    15_000,
    "Claude workflow artifacts read",
  );
  for (const artifact of artifacts) {
    const snapshot = `${input.status ?? "in_progress"}\n${artifact.metadata}\n${artifact.transcript}`;
    if (input.snapshotCache?.get(artifact.agentId) === snapshot) continue;
    input.snapshotCache?.set(artifact.agentId, snapshot);
    let metadata: Record<string, unknown> | null;
    try {
      metadata = asRecord(JSON.parse(artifact.metadata));
    } catch {
      continue;
    }
    if (
      stringField(metadata, "agentType") !== "workflow-subagent" ||
      metadata?.inWorkflowRun !== true
    )
      continue;
    const callId = `workflow:${input.callId}:${artifact.agentId}`;
    const phase = stringField(metadata, "workflowPhase");
    input.onEvent({
      type: "tool.started",
      callId,
      title: stringField(metadata, "description") ?? "Subagent",
      kind: "agent",
      status: input.status ?? "in_progress",
      agentModel: stringField(metadata, "model"),
      workflow: { callId: input.callId, ...(phase ? { phase } : {}) },
    });
    let ended = false;
    for (const line of artifact.transcript.split("\n")) {
      let rec: Record<string, unknown> | null;
      try {
        rec = asRecord(JSON.parse(line));
      } catch {
        continue;
      }
      if (!rec) continue;
      const id = stringField(rec, "uuid");
      if (!id) continue;
      if (rec.type === "assistant") {
        ended = stringField(asRecord(rec.message), "stop_reason") === "end_turn";
        for (const use of assistantToolUses(rec))
          input.onEvent({
            type: "agent.step",
            callId,
            stepId: use.id,
            kind: "tool",
            text: toolTitle(use.name, use.input),
            toolKind: toolKindFromName(use.name),
            status: "in_progress",
            preview: previewFromTool(use.name, use.input),
          });
        const text = assistantTextBlocks(rec).join("").trim();
        if (text)
          input.onEvent({
            type: "agent.step",
            callId,
            stepId: `${id}:text`,
            kind: "message",
            text,
          });
        const thinking = assistantThinkingBlocks(rec).join("").trim();
        if (thinking)
          input.onEvent({
            type: "agent.step",
            callId,
            stepId: `${id}:thinking`,
            kind: "reasoning",
            text: thinking,
          });
      } else if (rec.type === "user") {
        ended = false;
        for (const result of toolResultsFromUserMessage(rec))
          input.onEvent({
            type: "agent.step",
            callId,
            stepId: result.toolUseId,
            kind: "tool",
            text: "",
            status: result.isError ? "failed" : "completed",
            ...(result.isError ? { detail: result.text } : { output: result.text }),
          });
      }
    }
    if (input.status && input.status !== "in_progress")
      input.onEvent({
        type: "tool.updated",
        callId,
        status: input.status === "completed" && ended ? "completed" : "interrupted",
      });
  }
}
