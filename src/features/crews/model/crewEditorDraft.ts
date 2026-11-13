import { t } from "../../../shared/i18n/core";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type CrewPolicy,
  type CrewRole,
} from "./crew";
import type { ProjectCrews } from "./crewClient";
import { crewFingerprint } from "./crewBulk";
import { catalogCandidate, catalogModels, newCrewMember } from "./crewRoster";

// Like note drafts, these survive closing the dialog for the lifetime of this window.
// Host + project identity prevents a draft leaking into another connection.
export const crewDrafts = new Map<
  string,
  { newDraft: CrewDefinition | null; drafts: Record<string, CrewDefinition> }
>();

export function forgetCrewDraft(draftKey: string, id: string) {
  const stored = crewDrafts.get(draftKey);
  if (!stored) return;
  const drafts = { ...stored.drafts };
  delete drafts[id];
  crewDrafts.set(draftKey, {
    newDraft: stored.newDraft?.id === id ? null : stored.newDraft,
    drafts,
  });
}

export function emptyCrew(data: ProjectCrews, scope: "project" | "global"): CrewDefinition {
  return {
    id: crypto.randomUUID(),
    name: "",
    projectId: scope === "project" ? data.project.id : undefined,
    agents: [],
    policy: { ...defaultCrewPolicy },
    updatedAt: 0,
  };
}

function firstCandidate(data: ProjectCrews) {
  const first = catalogModels(data.catalog)[0];
  return first ? catalogCandidate(data.catalog, `${first.harness}/${first.id}`) : undefined;
}

/** An optional starting roster; its model is shown on every row before saving. */
export function starterRoster(data: ProjectCrews): CrewAgent[] {
  const candidate = firstCandidate(data);
  return [
    newCrewMember("coordinator", t("Project lead"), candidate, data.modelPoolsSupported),
    newCrewMember("specialist", t("Developer"), candidate, data.modelPoolsSupported),
    newCrewMember("reviewer", t("Code reviewer"), candidate, data.modelPoolsSupported),
  ];
}

export function blankMember(data: ProjectCrews, role: CrewRole = "specialist"): CrewAgent {
  return newCrewMember(role, "", firstCandidate(data), data.modelPoolsSupported);
}

export function policyErrors(policy: CrewPolicy) {
  const outOfRange = (value: number, min: number, max: number, integer = true) =>
    !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value));
  return {
    maxParallel: outOfRange(policy.maxParallel, 1, 4) ? t("Use a whole number from 1 to 4.") : "",
    maxAssignments: outOfRange(policy.maxAssignments, 1, 20)
      ? t("Use a whole number from 1 to 20.")
      : "",
    maxRunMinutes: outOfRange(policy.maxRunMinutes, 1, 240, false)
      ? t("Use a value from 1 to 240.")
      : "",
  };
}

/** The draft an editor opens with: a copy, a new crew (resuming an unsaved one), or a stored crew. */
export function initialCrewDraft(
  data: ProjectCrews,
  draftKey: string,
  focus: {
    crewId?: string;
    createScope?: "project" | "global";
    copyOf?: { crewId: string; scope: "project" | "global" };
  },
): CrewDefinition | null {
  const { crewId, createScope, copyOf } = focus;
  const stored = crewDrafts.get(draftKey);
  if (copyOf) {
    const source = data.definitions.find((d) => d.id === copyOf.crewId);
    if (source)
      return {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name:
          (copyOf.scope === "project") === !!source.projectId
            ? t("{p0} copy", { p0: source.name })
            : source.name,
        projectId: copyOf.scope === "project" ? data.project.id : undefined,
        updatedAt: 0,
      };
  }
  if (createScope) {
    // Reopening New crew resumes the unsaved one left in the same scope.
    const resumed = stored?.newDraft;
    return resumed && !!resumed.projectId === (createScope === "project")
      ? resumed
      : emptyCrew(data, createScope);
  }
  const found =
    (crewId ? stored?.drafts[crewId] : undefined) ?? data.definitions.find((d) => d.id === crewId);
  return found ? structuredClone(found) : null;
}

/** Keeps the draft for this window: an unsaved crew as the new draft, a stored one only while it differs. */
export function rememberCrewDraft(
  draftKey: string,
  draft: CrewDefinition,
  definitions: readonly CrewDefinition[],
  isCopy: boolean,
) {
  const stored = crewDrafts.get(draftKey) ?? { newDraft: null, drafts: {} };
  if (!draft.updatedAt) {
    if (!isCopy) crewDrafts.set(draftKey, { ...stored, newDraft: draft });
    return;
  }
  const saved = definitions.find((d) => d.id === draft.id);
  const drafts = { ...stored.drafts };
  if (saved && JSON.stringify(saved) === JSON.stringify(draft)) delete drafts[draft.id];
  else drafts[draft.id] = draft;
  crewDrafts.set(draftKey, { ...stored, drafts });
}

/** After a save: drops the kept draft when it holds nothing but what was just saved. */
export function forgetSentCrewDraft(draftKey: string, sent: CrewDefinition) {
  const kept = crewDrafts.get(draftKey)?.drafts[sent.id];
  if (kept && crewFingerprint(kept) === crewFingerprint(sent)) forgetCrewDraft(draftKey, sent.id);
}
