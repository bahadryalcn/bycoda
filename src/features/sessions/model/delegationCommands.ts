import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

export const SUBAGENTS_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "subagents",
  invocation: "subagents",
  get description() {
    return t("Split this request across parallel subagents.");
  },
  scope: "builtin",
  source: "bycoda",
};

export const TASK_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "task",
  invocation: "task",
  get description() {
    return t("Turn this request into bycoda tasks.");
  },
  scope: "builtin",
  source: "bycoda",
};

export type DelegationCommand = {
  name: "subagents" | "task";
  /** The request after the command, without its optional subagent count. */
  request: string;
  /** What the provider receives in place of the typed command. */
  prompt: string;
};

const MAX_SUBAGENTS = 16;

/**
 * Codex only delegates on an explicit request below its highest effort, so the
 * command states that request. The typed text stays visible in the transcript.
 */
function subagentsPrompt(request: string, count?: number): string {
  return [
    request,
    [
      "Delegation requested by the owner (/subagents): split this request into independent parts and run them in parallel with your native subagents",
      count ? `, using up to ${count} at once.` : ".",
      " Give each subagent a self-contained brief (goal, relevant files, constraints, what to return).",
      " Keep dependent steps in order and give each file at most one writer at a time.",
      " Check the subagents' results yourself before reporting one combined answer.",
      " If no subagent tool is available, do the parts yourself and say so.",
    ].join(""),
  ].join("\n\n");
}

function taskPrompt(request: string): string {
  return [
    "Create bycoda tasks for the work below with Conversation Tools (tasks.create). Do not implement it in this turn.",
    "Write each task prompt as a self-contained spec: goal, relevant files, constraints and acceptance checks. Split independent parts into separate tasks and use task dependencies for work that must run in order. Keep this project's default agent, model and workspace unless the request names others.",
    "Report the created task titles and ids. If Conversation Tools are unavailable, say so instead of doing the work.",
    `Work:\n${request}`,
  ].join("\n\n");
}

/** Expand a leading `/subagents [count]` or `/task`; `null` when neither leads. */
export function consumeDelegationCommand(text: string): DelegationCommand | null {
  const match = text.match(/^\s*\/(subagents|task)(?=\s|$)\s*/i);
  if (!match) return null;
  const name = match[1].toLowerCase() as DelegationCommand["name"];
  let rest = text.slice(match[0].length);
  if (name === "task") {
    const request = rest.trim();
    return { name, request, prompt: request ? taskPrompt(request) : "" };
  }
  const counted = rest.match(/^(\d{1,2})(?=\s|$)\s*/);
  const count = counted ? Math.min(MAX_SUBAGENTS, Number(counted[1])) : undefined;
  if (counted) rest = rest.slice(counted[0].length);
  const request = rest.trim();
  return {
    name,
    request,
    prompt: request ? subagentsPrompt(request, count || undefined) : "",
  };
}
