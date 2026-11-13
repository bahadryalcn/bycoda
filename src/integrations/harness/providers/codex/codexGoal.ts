import { asRecord, stringField } from "./codexProtocol";
import type { SessionGoal } from "../../../../shared/model/providerGoal";

export function codexGoalState(response: unknown): SessionGoal | null | undefined {
  const record = asRecord(response);
  if (record?.goal === null) return null;
  const goal = asRecord(record?.goal);
  const objective = stringField(goal, "objective");
  const providerSessionId = stringField(goal, "threadId");
  const status = stringField(goal, "status");
  if (!objective || !providerSessionId) return undefined;
  switch (status) {
    case "active":
    case "paused":
    case "blocked":
    case "usageLimited":
    case "budgetLimited":
    case "complete":
      return { provider: "codex", providerSessionId, objective, status };
    default:
      return undefined;
  }
}

export type CodexGoalCommand =
  | { action: "get" | "clear" | "pause" | "resume" }
  | { action: "set"; objective: string };

export function parseCodexGoalCommand(text: string): CodexGoalCommand | null {
  const match = /^\s*\/goal(?=\s|$)\s*([\s\S]*)$/.exec(text);
  if (!match) return null;
  const argument = match[1]!.trim();
  if (!argument || argument === "status") return { action: "get" };
  if (argument === "clear" || argument === "pause" || argument === "resume")
    return { action: argument };
  return { action: "set", objective: argument };
}

export function codexGoalRequest(command: CodexGoalCommand, threadId: string) {
  if (command.action === "get" || command.action === "clear")
    return { method: `thread/goal/${command.action}`, params: { threadId } };
  return {
    method: "thread/goal/set",
    params: {
      threadId,
      status: command.action === "pause" ? "paused" : "active",
      ...(command.action === "set" ? { objective: command.objective } : {}),
    },
  };
}

export function codexGoalSummary(response: unknown): string {
  const goal = asRecord(asRecord(response)?.goal);
  const objective = stringField(goal, "objective");
  if (!objective) return "No active Codex goal. Use /goal <objective> to set one.";
  const tokens = typeof goal?.tokensUsed === "number" ? goal.tokensUsed : 0;
  const budget = typeof goal?.tokenBudget === "number" ? ` / ${goal.tokenBudget}` : "";
  return `Codex goal (${stringField(goal, "status") ?? "active"}): ${objective}\n\nTokens used: ${tokens}${budget}.`;
}
