import type { HostModelCatalog } from "../../connections/model/protocol";
import {
  defaultCrewPolicy,
  parseCrewDefinition,
  type CrewDefinition,
  type CrewRole,
  type SavedCrewAgent,
} from "./crew";
import { catalogCandidate, catalogModels } from "./crewRoster";

/** Stable IDs belong to the initial seed, never to a recurring reset or sync. */
export const DEFAULT_CREW_ID = "bycoda.product-team";
export const DEFAULT_CREW_REVISION = 2;

type RoleProfile = {
  id: string;
  name: string;
  role: CrewRole;
  groups: string[];
  instructions: string;
};

/**
 * bycoda's editable starting points, not job-title or methodology requirements.
 * Research rationale and primary sources are maintained in docs/guides/crews.md.
 */
const profiles: RoleProfile[] = [
  {
    id: "team-lead",
    name: "Team Lead",
    role: "coordinator",
    groups: ["Leadership", "Engineering"],
    instructions: `Plan scoped assignments, coordinate dependencies and resolve requests. Delegate implementation and independent technical review; arrange integration for multi-part work.`,
  },
  {
    id: "project-manager",
    name: "Project Manager",
    role: "advisor",
    groups: ["Leadership", "Delivery"],
    instructions: `Track deliverables, dependencies, decisions and blockers; coordinate realistic delivery and recovery plans.`,
  },
  {
    id: "product-manager",
    name: "Product Manager",
    role: "advisor",
    groups: ["Leadership", "Product"],
    instructions: `Define the user problem, scope and acceptance criteria; assess tradeoffs and evidence for the requested outcome.`,
  },
  {
    id: "ux-researcher",
    name: "UX Researcher",
    role: "specialist",
    groups: ["UX", "Research"],
    instructions: `Choose research suited to the decision; protect participants and distinguish evidence from hypotheses.`,
  },
  {
    id: "ux-designer",
    name: "UX Designer",
    role: "specialist",
    groups: ["UX", "Design"],
    instructions: `Design accessible task flows including interruption, errors and recovery; specify interaction and state behavior.`,
  },
  {
    id: "designer",
    name: "Designer",
    role: "specialist",
    groups: ["Design", "Brand"],
    instructions: `Apply the existing design system to clear, responsive visual hierarchy; specify relevant states and assets.`,
  },
  {
    id: "ui-engineer",
    name: "UI Engineer",
    role: "specialist",
    groups: ["UI", "Frontend"],
    instructions: `Implement accessible, responsive interfaces using shared components; preserve state, validation, keyboard and recovery behavior.`,
  },
  {
    id: "mobile-engineer",
    name: "Mobile Engineer",
    role: "specialist",
    groups: ["Mobile", "Engineering"],
    instructions: `Implement native mobile flows; preserve navigation, drafts, accessibility, lifecycle and connectivity behavior.`,
  },
  {
    id: "backend-engineer",
    name: "Backend Engineer",
    role: "specialist",
    groups: ["Backend", "Engineering"],
    instructions: `Implement API and data contracts with validation, authorization, concurrency safety and compatible failure handling.`,
  },
  {
    id: "dba",
    name: "Database Administrator (DBA)",
    role: "specialist",
    groups: ["Database", "Data", "Reliability"],
    instructions: `Protect database integrity and recovery; assess schema, transactions, migrations and measured query performance.`,
  },
  {
    id: "data-engineer",
    name: "Data Engineer",
    role: "specialist",
    groups: ["Data", "Backend"],
    instructions: `Own scoped ingestion and transformation contracts, lineage, replay and data quality; coordinate storage with DBA.`,
  },
  {
    id: "architect",
    name: "Architect",
    role: "advisor",
    groups: ["Architecture", "Engineering"],
    instructions: `Assess affected boundaries, ownership and contracts; recommend the smallest compatible design and explain tradeoffs.`,
  },
  {
    id: "devops-engineer",
    name: "DevOps Engineer",
    role: "specialist",
    groups: ["DevOps", "Reliability"],
    instructions: `Improve reproducible builds and operational reliability; assess observability, recovery and rollout boundaries.`,
  },
  {
    id: "tester",
    name: "Tester",
    role: "specialist",
    groups: ["QA", "Testing"],
    instructions: `Exercise acceptance criteria with meaningful positive, negative and recovery scenarios; report reproducible defects and evidence.`,
  },
  {
    id: "security-engineer",
    name: "Security Engineer",
    role: "specialist",
    groups: ["Security", "Engineering"],
    instructions: `Assess relevant trust boundaries, authorization, sensitive data and attack paths; report actionable risks and mitigations.`,
  },
  {
    id: "accessibility-specialist",
    name: "Accessibility Specialist",
    role: "specialist",
    groups: ["Accessibility", "UX"],
    instructions: `Assess semantics, keyboard, focus, assistive technology and relevant accessibility states; report user impact and evidence.`,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "reviewer",
    groups: ["QA", "Review"],
    instructions: `Independently review the assigned result against its request and acceptance criteria. Inspect actual changes and evidence; stay read-only and request corrections for blocking defects.`,
  },
];

/** No invented model IDs, capabilities, quality scores or provider billing estimates. */
export function createDefaultCrew(
  catalog: HostModelCatalog,
  updatedAt: number,
): { agents: SavedCrewAgent[]; definition: CrewDefinition } | undefined {
  const model = catalogModels(catalog)[0];
  const candidate = model && catalogCandidate(catalog, `${model.harness}/${model.id}`);
  if (!candidate) return undefined;
  const agents: SavedCrewAgent[] = profiles.map((profile) => ({
    ...profile,
    id: `bycoda.role.${profile.id}`,
    groups: [...profile.groups],
    instructions: profile.instructions,
    selection: "fixed",
    candidates: [structuredClone(candidate)],
    updatedAt,
  }));
  const definition = parseCrewDefinition({
    id: DEFAULT_CREW_ID,
    name: "bycoda Product Team",
    agents: agents.map(({ updatedAt, ...agent }) => ({
      ...structuredClone(agent),
      source: { id: agent.id, updatedAt },
    })),
    policy: { ...defaultCrewPolicy, delegateApprovals: false },
    updatedAt,
  });
  return { agents, definition };
}
