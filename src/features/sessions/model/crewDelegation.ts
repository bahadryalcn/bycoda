import {
  backgroundMachineFor,
  backgroundMachines,
  machineCapabilities,
  machineProjects,
} from "../../automations/public/hostMachines";
import { remoteRequest } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { HOST_CREWS, type CrewDefinition, type SavedCrewAgent } from "../../crews/public/mentions";
import { pathKey } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import {
  HOST_CREW_MEMBER_ASK_CAPABILITY,
  crewMentionTargets,
  delegationNote,
  delegationRequestId,
  findCrewMentions,
  type CrewMentionSource,
  type CrewMentionTarget,
} from "./crewMentions";

/** One send's delegation context: where it runs and the identity its Host requests repeat. */
export type DelegationContext = {
  sessionId: string;
  cwd: string;
  requestKey: string;
};

type AskedMember = { taskId?: string; id?: string };
type StartedCrew = { id?: string; error?: string };

/**
 * Calls `crews.member.ask` with the send-derived request ID, so a resend of the same
 * turn reuses the Host task. `askCrewMember` mints its own IDs and fits other callers.
 */
function askMember(
  machineId: string,
  params: {
    projectId: string;
    requestId: string;
    memberId: string;
    prompt: string;
    parentSessionId: string;
  },
): Promise<AskedMember> {
  return remoteRequest<AskedMember>(machineId, "crews.member.ask", params, false, true);
}

/**
 * The project's library members and saved crews, or null when this project has no Crews host
 * or the Host does not know the project yet. Read only: it never registers a project.
 */
export async function loadCrewMentionSource(
  cwd: string,
  fresh = false,
): Promise<CrewMentionSource | null> {
  if (!cwd || cwd === "~") return null;
  const machine = backgroundMachineFor(await backgroundMachines(HOST_CREWS, fresh), cwd);
  if (!machine) return null;
  const hostPath = parseRemotePath(cwd)?.hostPath ?? cwd;
  const project = (await machineProjects(machine)).find(
    (entry) => pathKey(entry.cwd) === pathKey(hostPath),
  );
  if (!project) return null;
  const [state, capabilities] = await Promise.all([
    remoteRequest<{ definitions: CrewDefinition[]; agents: SavedCrewAgent[] }>(
      machine.id,
      "crews.list",
      { projectId: project.id, historyLimit: 1 },
    ),
    machineCapabilities(machine, fresh),
  ]);
  return {
    machineId: machine.id,
    projectId: project.id,
    agents: state.agents ?? [],
    definitions: state.definitions ?? [],
    memberAsk: capabilities.includes(HOST_CREW_MEMBER_ASK_CAPABILITY),
  };
}

async function delegate(
  source: CrewMentionSource,
  target: CrewMentionTarget,
  prompt: string,
  context: DelegationContext,
): Promise<string | undefined> {
  const requestId = delegationRequestId(context.requestKey, target);
  if (target.kind === "member") {
    const asked = await askMember(source.machineId, {
      projectId: source.projectId,
      requestId,
      memberId: target.id,
      prompt,
      parentSessionId: context.sessionId,
    });
    return asked.taskId ?? asked.id;
  }
  const run = await remoteRequest<StartedCrew>(
    source.machineId,
    "crews.start",
    {
      projectId: source.projectId,
      definitionId: target.id,
      prompt,
      requestId,
      newConversation: true,
    },
    false,
    true,
  );
  if (run.error) throw new Error(run.error);
  return run.id;
}

/**
 * Sends the message to every member and crew it names with a resolved `@token` and returns
 * one note per delegation, so the conversation's agent knows. A message without a resolved
 * mention, or a Host without the capability, yields no notes and nothing is called. A failure
 * throws, so the send stops with its draft kept; a repeated send repeats the same request ids
 * and is never resent automatically.
 */
export async function delegateCrewMentions(
  text: string,
  context: DelegationContext,
): Promise<string[]> {
  if (!text.includes("@")) return [];
  const source = await loadCrewMentionSource(context.cwd, true).catch((error) => {
    console.warn("Loading crew mentions failed", error);
    return null;
  });
  if (!source) return [];
  const notes: string[] = [];
  for (const target of findCrewMentions(text, crewMentionTargets(source))) {
    try {
      notes.push(delegationNote(target, await delegate(source, target, text.trim(), context)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(t("Could not delegate to @{p0}: {p1}", { p0: target.token, p1: reason }));
    }
  }
  return notes;
}
