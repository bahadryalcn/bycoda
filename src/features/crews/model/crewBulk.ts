import type {
  ModelRoutingItemChoice,
  ModelRoutingPool,
} from "../../../shared/model/host-contracts/model-routing";
import type { CrewAgent, CrewCandidate, CrewDefinition } from "./crew";

/**
 * Bulk model assignment: every target member becomes a fixed member pinned to the
 * candidate (model and its settings, e.g. effort). An empty `ids` list targets everyone.
 * Other members are returned untouched.
 */
export function applyCandidate<T extends Pick<CrewAgent, "id" | "selection" | "candidates">>(
  agents: readonly T[],
  ids: readonly string[],
  candidate: CrewCandidate,
): T[] {
  const targets = ids.length ? new Set(ids) : undefined;
  return agents.map((agent) =>
    !targets || targets.has(agent.id)
      ? {
          ...agent,
          modelChoice: { kind: "fixed" as const },
          selection: "fixed" as const,
          candidates: [structuredClone(candidate)],
        }
      : agent,
  );
}

/**
 * Bulk routing assignment keeps the concrete fallback and stores only a shared routing reference.
 */
export function applyChoice<T extends Pick<CrewAgent, "id" | "selection" | "candidates">>(
  agents: readonly T[],
  ids: readonly string[],
  modelChoice: ModelRoutingItemChoice,
): T[] {
  const targets = ids.length ? new Set(ids) : undefined;
  return agents.map((agent) =>
    !targets || targets.has(agent.id)
      ? {
          ...agent,
          modelChoice,
          selection: modelChoice.kind === "fixed" ? ("fixed" as const) : ("automatic" as const),
        }
      : agent,
  );
}
export function applyPool<T extends Pick<CrewAgent, "id" | "selection" | "candidates">>(
  agents: readonly T[],
  ids: readonly string[],
  pool: Pick<ModelRoutingPool, "id">,
): T[] {
  return applyChoice(agents, ids, { kind: "pool", poolId: pool.id });
}

/** What a save sends: the stored name never keeps surrounding whitespace. */
export function outgoingCrew(draft: CrewDefinition): CrewDefinition {
  return { ...draft, name: draft.name.trim() };
}

/** Content identity of a definition, ignoring the revision so a bumped `updatedAt` is not a change. */
export function crewFingerprint(definition: CrewDefinition): string {
  return JSON.stringify({ ...definition, name: definition.name.trim(), updatedAt: 0 });
}

/**
 * Whether a saved crew's draft should be sent now: it is valid, differs from the latest
 * saved content, and is not the content that was just sent or that just failed (a failed
 * draft waits for Retry or the next edit instead of looping).
 */
export function shouldAutosave(
  draft: CrewDefinition,
  saved: CrewDefinition | undefined,
  valid: boolean,
  lastSent?: string,
  failed?: string,
): boolean {
  if (!valid || !draft.updatedAt || !saved) return false;
  const current = crewFingerprint(draft);
  return current !== crewFingerprint(saved) && current !== lastSent && current !== failed;
}

/**
 * The draft after a save finished. Untouched since the request: the stored definition
 * replaces it. Edited meanwhile: the edits stay and only the revision moves on, so the
 * next save carries the right `expectedUpdatedAt`.
 */
export function adoptSaved(
  current: CrewDefinition,
  sent: CrewDefinition,
  returned: CrewDefinition,
): CrewDefinition {
  return JSON.stringify(current) === JSON.stringify(sent)
    ? returned
    : { ...current, updatedAt: returned.updatedAt };
}

/** The candidate most members share (same harness, model and settings); the first wins a tie. */
export function commonCandidate(
  allAgents: readonly Pick<CrewAgent, "id" | "candidates">[],
  /** Limits the count to these members; empty means everyone. */
  ids: readonly string[] = [],
): CrewCandidate | undefined {
  const agents = ids.length ? allAgents.filter((agent) => ids.includes(agent.id)) : allAgents;
  const counts = new Map<string, { candidate: CrewCandidate; count: number }>();
  for (const agent of agents) {
    const candidate = agent.candidates[0];
    if (!candidate) continue;
    const key = JSON.stringify([candidate.harness, candidate.model, candidate.modelSettings]);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { candidate, count: 1 });
  }
  let best: { candidate: CrewCandidate; count: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best && structuredClone(best.candidate);
}
