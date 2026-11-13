import { t } from "../../../shared/i18n/core";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { modelEffortSetting } from "../../sessions/public/models";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import {
  crewWorkTitle,
  type CrewAgent,
  type CrewCandidate,
  type CrewDefinition,
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
    modelDisplayName(candidate.model, candidate.harness)
  );
}

/** The candidate's reasoning effort as its model names it ("Low", "High"), when the model has one. */
export function candidateEffortLabel(catalog: HostModelCatalog, candidate?: CrewCandidate) {
  if (!candidate) return "";
  const model = catalog.models[candidate.harness]?.find((m) => m.id === candidate.model);
  const setting = model ? modelEffortSetting(model) : undefined;
  if (!setting) return "";
  const value = candidate.modelSettings[setting.id] ?? setting.value;
  return setting.options.find((option) => option.value === value)?.label ?? value;
}

/**
 * One model summary for roster, library and picker rows: a fixed member names its
 * pinned model; an automatic member names its routing choice.
 */
export function memberModelSummary(
  catalog: HostModelCatalog,
  agent: Pick<CrewAgent, "selection" | "candidates" | "modelChoice">,
) {
  if (!agent.candidates.length) return t("No model");
  return agent.selection === "automatic"
    ? agent.modelChoice?.kind === "order"
      ? t("Model order")
      : agent.modelChoice?.kind === "pool"
        ? t("Model pool")
        : t("Default")
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

export function newCrewMember(
  role: CrewRole,
  name: string,
  candidate?: CrewCandidate,
  routingSupported = false,
): CrewAgent {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    instructions: "",
    selection: routingSupported ? "automatic" : "fixed",
    ...(routingSupported ? { modelChoice: { kind: "default" as const } } : {}),
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
