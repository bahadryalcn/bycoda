import { t } from "../../../shared/i18n/core";
import type { HostModelCatalog } from "../../connections/model/protocol";
import {
  crewWorkTitle,
  type CrewAgent,
  type CrewCandidate,
  type CrewDefinition,
  type CrewPolicy,
  type CrewRole,
  type CrewRun,
  type SavedCrewAgent,
} from "./crew";

/** Mirrors the host's crew rules so problems show beside the roster before saving. */
export type CrewRosterIssues = {
  coordinator?: "missing" | "duplicate";
  reviewer?: "missing" | "duplicate";
  specialist?: "missing";
  size?: "small" | "large";
  name?: "missing";
  /** Members without a usable model or name. */
  members: Record<string, "model" | "name">;
};

export const CREW_ROLES: CrewRole[] = ["coordinator", "specialist", "reviewer", "advisor"];

export function crewRosterIssues(definition: CrewDefinition): CrewRosterIssues {
  const count = (role: CrewRole) => definition.agents.filter((a) => a.role === role).length;
  const issues: CrewRosterIssues = { members: {} };
  const coordinators = count("coordinator");
  const reviewers = count("reviewer");
  if (coordinators !== 1) issues.coordinator = coordinators ? "duplicate" : "missing";
  if (reviewers !== 1) issues.reviewer = reviewers ? "duplicate" : "missing";
  if (!count("specialist")) issues.specialist = "missing";
  if (definition.agents.length > 20) issues.size = "large";
  else if (definition.agents.length < 3) issues.size = "small";
  if (!definition.name.trim()) issues.name = "missing";
  for (const agent of definition.agents) {
    if (!agent.name.trim()) issues.members[agent.id] = "name";
    else if (!agent.candidates.length) issues.members[agent.id] = "model";
  }
  return issues;
}

export function crewRosterValid(issues: CrewRosterIssues): boolean {
  return (
    !issues.coordinator &&
    !issues.reviewer &&
    !issues.specialist &&
    !issues.size &&
    !issues.name &&
    !Object.keys(issues.members).length
  );
}

export function catalogModels(catalog: HostModelCatalog) {
  return Object.values(catalog.models).flatMap((models) => models ?? []);
}

/** A catalog model as a member candidate, starting from the model's own option defaults. */
export function catalogCandidate(
  catalog: HostModelCatalog,
  value: string,
): CrewCandidate | undefined {
  const model = catalogModels(catalog).find((m) => `${m.harness}/${m.id}` === value);
  return model
    ? {
        id: value,
        harness: model.harness,
        model: model.id,
        modelSettings: Object.fromEntries(
          (model.settings ?? []).map((setting) => [setting.id, setting.value]),
        ),
        capabilities: {},
      }
    : undefined;
}

export function candidateLabel(catalog: HostModelCatalog, candidate?: CrewCandidate) {
  if (!candidate) return "";
  return (
    catalog.models[candidate.harness]?.find((m) => m.id === candidate.model)?.name ??
    candidate.model
  );
}

/**
 * One model summary for roster, library and picker rows: a fixed member names its
 * pinned model; an automatic member names its pool size, not a selected model
 * (the Host picks per assignment).
 */
export function memberModelSummary(
  catalog: HostModelCatalog,
  agent: Pick<CrewAgent, "selection" | "candidates">,
) {
  if (!agent.candidates.length) return t("No model");
  return agent.selection === "automatic"
    ? agent.candidates.length === 1
      ? t("Automatic: 1 candidate")
      : t("Automatic: {p0} candidates", { p0: agent.candidates.length })
    : t("Fixed: {p0}", { p0: candidateLabel(catalog, agent.candidates[0]) });
}

/**
 * Provider-qualified candidate for member detail: the model name and the provider
 * that serves it, so equal model names from two providers stay distinguishable.
 */
export function candidateDetailLabel(catalog: HostModelCatalog, candidate?: CrewCandidate) {
  if (!candidate) return "";
  return `${candidateLabel(catalog, candidate)} · ${candidate.harness}`;
}

/** Candidates the Host may choose from: a fixed member only ever uses its first (pinned) model. */
export function memberCandidatePool(agent: Pick<CrewAgent, "selection" | "candidates">) {
  return agent.selection === "fixed" ? agent.candidates.slice(0, 1) : agent.candidates;
}

/**
 * The policy guards that depend only on the saved definition (unknown cost, highest
 * cost, lowest quality). Availability and capability evidence are runtime facts the
 * Host adds on top. Mirrors the filters in `selectCrewCandidate`; it never exempts a pin.
 */
export function candidatePassesPolicy(
  candidate: Pick<CrewCandidate, "cost" | "quality">,
  policy: Pick<CrewPolicy, "allowUnknownCost" | "maxEstimatedCost" | "minimumQuality">,
) {
  return (
    (policy.allowUnknownCost || candidate.cost !== undefined) &&
    (policy.maxEstimatedCost === undefined ||
      (candidate.cost !== undefined && candidate.cost <= policy.maxEstimatedCost)) &&
    (policy.minimumQuality === undefined ||
      (candidate.quality !== undefined && candidate.quality >= policy.minimumQuality))
  );
}

export type MemberPolicyEffect = {
  agent: CrewAgent;
  /** Candidates the member may use before the policy (1 for a fixed member). */
  pool: number;
  /** Candidates that still pass the eligibility guards. */
  eligible: number;
};

/**
 * Members the current eligibility guards change. `blocked` members have no eligible
 * model left, fixed pins included; `narrowed` ones keep at least one.
 */
export function crewPolicyImpact(
  agents: readonly CrewAgent[],
  policy: Pick<CrewPolicy, "allowUnknownCost" | "maxEstimatedCost" | "minimumQuality">,
): { blocked: MemberPolicyEffect[]; narrowed: MemberPolicyEffect[] } {
  const blocked: MemberPolicyEffect[] = [];
  const narrowed: MemberPolicyEffect[] = [];
  for (const agent of agents) {
    const pool = memberCandidatePool(agent);
    if (!pool.length) continue;
    const eligible = pool.filter((candidate) => candidatePassesPolicy(candidate, policy)).length;
    if (eligible === pool.length) continue;
    (eligible ? narrowed : blocked).push({ agent, pool: pool.length, eligible });
  }
  return { blocked, narrowed };
}

/**
 * Bulk fixed-model Apply: every fixed member pins the chosen model first. A matching
 * candidate keeps its own settings and ratings, the remaining pool is preserved,
 * and automatic members are untouched.
 */
export function applyFixedModel(agents: readonly CrewAgent[], next: CrewCandidate): CrewAgent[] {
  return agents.map((agent) =>
    agent.selection === "fixed"
      ? {
          ...agent,
          candidates: [
            agent.candidates.find((candidate) => candidate.id === next.id) ?? next,
            ...agent.candidates.filter((candidate) => candidate.id !== next.id),
          ],
        }
      : agent,
  );
}

/** Names for a short inline list: the first few, then how many more. */
export function shortNameList(names: readonly string[], shown = 5) {
  if (names.length <= shown) return names.join(", ");
  return t("{p0} and {p1} more", {
    p0: names.slice(0, shown).join(", "),
    p1: names.length - shown,
  });
}

/** True once an unfinished new-member draft holds anything the owner typed or chose. */
export function memberDraftStarted(agent: Pick<CrewAgent, "name" | "instructions" | "groups">) {
  return !!agent.name.trim() || !!agent.instructions.trim() || !!agent.groups?.length;
}

export function newCrewMember(role: CrewRole, name: string, candidate?: CrewCandidate): CrewAgent {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    instructions: "",
    selection: "fixed",
    candidates: candidate ? [candidate] : [],
  };
}

/** A team copy of a library profile; later library edits stay out until the owner updates. */
export function memberFromLibrary(saved: SavedCrewAgent, role?: CrewRole): CrewAgent {
  const { projectId: _scope, updatedAt, ...agent } = structuredClone(saved);
  return {
    ...agent,
    id: crypto.randomUUID(),
    role: role ?? agent.role,
    source: { id: saved.id, updatedAt },
  };
}

/** Library profile changes not yet taken into this team member. */
export function libraryUpdate(member: CrewAgent, library: SavedCrewAgent[]) {
  const source = member.source && library.find((agent) => agent.id === member.source!.id);
  return source && source.updatedAt > member.source!.updatedAt ? source : undefined;
}

export function libraryGroups(agents: readonly { groups?: string[] }[]): string[] {
  return [...new Set(agents.flatMap((agent) => agent.groups ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function activeCrewRuns<T extends CrewRun>(runs: readonly T[], definitionId: string): T[] {
  return runs.filter((run) => run.definition.id === definitionId && run.status !== "finished");
}

/** A short work title: the delivery's first line, never the whole prompt. */
export function crewRunTitle(run: CrewRun): string {
  return (
    run.title ??
    crewWorkTitle(run.launch?.prompt) ??
    crewWorkTitle(run.assignments[0]?.title) ??
    run.definition.name
  );
}

type CrewCall = <T = unknown>(action: string, input: Record<string, unknown>) => Promise<T>;

/**
 * Saves a member as a library profile. The same scope updates its profile; another
 * scope gets a separate copy, because the host keeps a saved profile in its scope.
 */
export function saveLibraryProfile(
  call: CrewCall,
  library: SavedCrewAgent[],
  projectId: string | undefined,
  agent: CrewAgent,
): Promise<SavedCrewAgent> {
  const existing = agent.source && library.find((saved) => saved.id === agent.source!.id);
  const same = existing && existing.projectId === projectId ? existing : undefined;
  const { source: _source, ...profile } = agent;
  return call<SavedCrewAgent>("crews.agent.save", {
    agent: { ...profile, id: same?.id ?? crypto.randomUUID(), projectId },
    expectedUpdatedAt: same?.updatedAt,
  });
}

/**
 * Owner ratings stored as plain numbers: cost is a relative level compared with the
 * crew's cost limit, quality a 0–100 score compared with its minimum. Levels keep
 * both readable; any other stored value stays as a custom rating.
 */
export const COST_LEVELS = [1, 2, 3] as const;
export const QUALITY_LEVELS = [40, 70, 90] as const;
