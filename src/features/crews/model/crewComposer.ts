import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { CrewAgent } from "./crew";
import type { CrewRunView } from "./crewClient";
import { assignableMembers, noteMembers } from "./crewOwnerActions";

const TITLE_LIMIT = 80;

/** Who the owner's message goes to first: the coordinator, else the first member. */
export function composerDefaultMember(run: CrewRunView): string {
  const members = noteMembers(run);
  return (members.find((agent) => agent.role === "coordinator") ?? members[0])?.id ?? "";
}

/** The assignment title the Host requires, taken from the message's first line. */
export function composerTitle(text: string): string {
  const first = text.trim().split(/\r?\n/, 1)[0] ?? "";
  return truncateGraphemes(first.replace(/\s+/g, " ").trim(), TITLE_LIMIT);
}

/** Assigning is offered only for a member the Host accepts an assignment for; else it is a note. */
export function composerCanAssign(run: CrewRunView, member?: CrewAgent): boolean {
  return !!member && assignableMembers(run).some((agent) => agent.id === member.id);
}
