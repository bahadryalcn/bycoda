import type { CrewAgent, SavedCrewAgent } from "../../src/features/crews/model/crew";
import { CREW_TOOLS_KEY } from "../../src/shared/model/host-contracts/delegation";

/** A library handle is unique across the global library and the saving project's own agents. */
export function assertUniqueHandle(
  library: readonly SavedCrewAgent[],
  agent: CrewAgent,
  projectId: string | undefined,
): void {
  if (!agent.handle) return;
  const clash = library.find(
    (other) =>
      other.id !== agent.id &&
      other.handle === agent.handle &&
      (!other.projectId || !projectId || other.projectId === projectId),
  );
  if (clash) throw new Error(`Handle @${agent.handle} is already used by ${clash.name}`);
}

/** The library record written by `crews.agent.save`; candidate capability evidence is not kept. */
export function prepareSavedAgent(
  library: readonly SavedCrewAgent[],
  agent: CrewAgent,
  projectId: string | undefined,
  updatedAt: number,
): SavedCrewAgent {
  assertUniqueHandle(library, agent, projectId);
  const saved = { ...agent, projectId, updatedAt };
  for (const candidate of saved.candidates) candidate.capabilities = {};
  return saved;
}

/** Writes the member's tool profile into its session's model settings (`crew-tools.ts` enforces it). */
export function withCrewTools(
  modelSettings: Record<string, string>,
  agent: Pick<CrewAgent, "tools"> | undefined,
): Record<string, string> {
  return agent?.tools
    ? { ...modelSettings, [CREW_TOOLS_KEY]: JSON.stringify(agent.tools) }
    : modelSettings;
}
