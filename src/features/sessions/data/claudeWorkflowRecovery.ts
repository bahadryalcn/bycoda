import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { invokeProviderCommand } from "../../../integrations/harness/core/child";
import { loadClaudeWorkflowArtifacts } from "../../../integrations/harness/providers/claude/claudeWorkflowArtifacts";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { sessionWorkCwd, type Session } from "../model/session";

type Resolution = {
  providerSessionId: string;
  runId: string;
  status?: "completed" | "failed" | "stopped";
};
type Lookup = (input: {
  cwd: string;
  providerAccountId?: string;
  callId: string;
}) => Promise<Resolution | null>;

const lookups = new Map<string, { until: number; result: Promise<Resolution | null> }>();
const recoveryOffsets = new Map<string, number>();
const lookup: Lookup = (input) => {
  const key = JSON.stringify([input.cwd, input.providerAccountId ?? null, input.callId]);
  const previous = lookups.get(key);
  if (previous && previous.until > Date.now()) return previous.result;
  if (lookups.size >= 256) lookups.delete(lookups.keys().next().value!);
  const result = withTimeout(
    invokeProviderCommand<Resolution | null>("harness_claude_workflow_resolve", input),
    15_000,
    "Claude workflow lookup",
  );
  lookups.set(key, { until: Date.now() + 60_000, result });
  return result;
};

/** Recover only a workflow uniquely proven by its original provider tool call. */
export async function recoverClaudeWorkflows(
  original: Session,
  dependencies: { lookup?: Lookup; load?: typeof loadClaudeWorkflowArtifacts } = {},
): Promise<Session> {
  if (
    original.harness !== "claude" ||
    original.hostBinding ||
    original.busy ||
    original.historyLoading ||
    original.storedHistory
  )
    return original;
  const parents = new Set(
    original.blocks.flatMap((block) =>
      block.agentRun?.workflow?.callId ? [block.agentRun.workflow.callId] : [],
    ),
  );
  const calls = [
    ...new Set(
      original.blocks.flatMap((block) => {
        const tool = block.tool;
        const workflowMarker =
          tool?.kind === "Workflow" || /\bworkflow\b/i.test(`${tool?.title ?? ""} ${block.text}`);
        return workflowMarker &&
          (tool?.kind === "agent" || tool?.kind === "Workflow") &&
          tool.callId &&
          ["interrupted", "in_progress", "running"].includes(tool.status ?? "") &&
          !block.agentRun?.workflow &&
          !parents.has(tool.callId)
          ? [tool.callId]
          : [];
      }),
    ),
  ];
  let session = original;
  const offset = calls.length ? (recoveryOffsets.get(original.id) ?? 0) % calls.length : 0;
  const selected = [...calls.slice(offset), ...calls.slice(0, offset)].slice(0, 2);
  if (calls.length > 2) {
    if (recoveryOffsets.size >= 256) recoveryOffsets.delete(recoveryOffsets.keys().next().value!);
    recoveryOffsets.set(original.id, offset + selected.length);
  } else recoveryOffsets.delete(original.id);
  const deadline = Date.now() + 4_000;
  for (const callId of selected) {
    if (Date.now() >= deadline) break;
    try {
      const found = await withTimeout(
        (dependencies.lookup ?? lookup)({
          cwd: sessionWorkCwd(original),
          providerAccountId: original.providerAccountId,
          callId,
        }),
        Math.max(1, deadline - Date.now()),
        "Claude workflow recovery",
      );
      if (!found) continue;
      if (Date.now() >= deadline) break;
      const events: HarnessEvent[] = [];
      await withTimeout(
        (dependencies.load ?? loadClaudeWorkflowArtifacts)({
          cwd: sessionWorkCwd(original),
          providerAccountId: original.providerAccountId,
          providerSessionId: found.providerSessionId,
          runId: found.runId,
          callId,
          status: found.status === "completed" ? "completed" : "interrupted",
          onEvent: (event) => {
            events.push(event);
          },
        }),
        Math.max(1, deadline - Date.now()),
        "Claude workflow recovery",
      );
      if (!events.some((event) => event.type === "tool.started")) continue;
      session = applyHarnessEvent(session, {
        type: "tool.updated",
        callId,
        kind: "Workflow",
        status: found.status ?? "interrupted",
      });
      for (const event of events) session = applyHarnessEvent(session, event);
    } catch {
      /* Keep the saved conversation when lookup or artifacts are unavailable. */
    }
  }
  return session;
}
