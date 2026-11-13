import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills";

export const EPIC_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "epic",
  invocation: "epic",
  scope: "builtin",
  source: "bycoda",
  get description() {
    return t("Plan this request as an Epic.");
  },
};
export const CREW_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "crew",
  invocation: "crew:<name>",
  scope: "builtin",
  source: "bycoda",
  get description() {
    return t("Send this request to a Crew lead.");
  },
};
export const AUTOMATION_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "automation",
  invocation: "automation",
  scope: "builtin",
  source: "bycoda",
  get description() {
    return t("Schedule this request as an automation.");
  },
};
export const WORK_COMMANDS = [EPIC_COMMAND, CREW_COMMAND, AUTOMATION_COMMAND];

/** App commands retain their transcript text; execution still uses current tool authority. */
export function consumeWorkCommand(text: string): {
  name: "epic" | "crew" | "automation";
  request: string;
  prompt: string;
} | null {
  const match = text.match(/^\s*\/(epic|automation)(?=\s|$)\s*/i);
  const crew = text.match(/^\s*\/crew:(?:"([^"\r\n]{1,200})"|([^\s"]{1,200}))(?=\s|$)\s*/i);
  if (!crew && /^\s*\/crew(?::(?=\s|$)|(?=\s|$))/i.test(text))
    return { name: "crew", request: "", prompt: "" };
  if (!match && !crew) return null;
  const name = crew ? "crew" : (match![1].toLowerCase() as "epic" | "automation");
  const request = text.slice((crew ?? match)![0].length).trim();
  if (!request) return { name, request, prompt: "" };
  // The composer opens a typed proposal; this command never delegates creation to a prompt.
  if (name === "automation") return { name, request, prompt: "" };
  const instruction =
    name === "epic"
      ? "Create one bycoda Epic with goals.create for the request below. This is a planned parent with board tasks, not a provider-native /goal. Use the current project's saved execution settings and the existing plan approval flow. Do not implement the request in this turn."
      : name === "crew"
        ? `Find the exact visible Crew named ${JSON.stringify(crew![1] ?? crew![2])} with crews.definitions.list. Ask if the name is ambiguous. Send the request to its existing task-linked lead with crews.request, or create a task with tasks.create and that crewDefinitionId if no task-linked run exists. Never create an unlinked crew run or grant approvals to the lead. Report the actual task and coordinator session identifiers.`
        : "";
  return {
    name,
    request,
    prompt: `${instruction}\n\nUse existing Conversation Tools and preserve their permission, revision and request identity checks. If the required tool is unavailable, report that no work was created.\n\nOwner request:\n${request}`,
  };
}
