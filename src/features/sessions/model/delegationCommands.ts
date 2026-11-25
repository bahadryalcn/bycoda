import { DELEGATION_LIMITS } from "../../../shared/model/host-contracts/delegation";
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
  /** What the provider receives in place of the typed command; empty for `/task`, which no turn handles. */
  prompt: string;
};

const MAX_SUBAGENTS = DELEGATION_LIMITS.runningSubagents;

/**
 * Codex only delegates on an explicit request below its highest effort, so the
 * command states that request. The typed text stays visible in the transcript.
 */
function subagentsPrompt(request: string, count?: number): string {
  return [
    request,
    [
      "Delegation requested by the owner (/subagents): split this request into independent parts and run them in parallel with the subagent tools this session offers (built-in or agents.delegate)",
      count ? `, using up to ${count} at once.` : ".",
      " Give each subagent a self-contained brief (goal, relevant files, constraints, what to return).",
      " Keep dependent steps in order and give each file at most one writer at a time.",
      " Check the subagents' results yourself before reporting one combined answer.",
      " If no subagent tool is available, do the parts yourself and say so.",
    ].join(""),
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
    // The owner's words go to the task unchanged; no model turn rewrites them.
    return { name, request, prompt: "" };
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
