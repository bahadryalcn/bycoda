import { readCrewRun } from "./crew-scheduler-projection";
import type { CrewRun } from "../../src/features/crews/model/crew";
import type { HostStore } from "../store";
import type { HostModelCatalog } from "../../src/features/connections/model/protocol";
import {
  selectCrewCandidate,
  type CrewDefinition,
  type CrewCandidate,
  type CrewCapability,
} from "../../src/features/crews/model/crew";
import { hostModelRoutingService } from "../model-routing/runtime";
import { projectRoutingCwd } from "../tasks/model-routing";
import { createModelRoutingService, resolveModelChoice } from "../model-routing/service";
import { readModelRouting } from "../model-routing/storage";
import type { ModelRoutingTarget } from "../../src/shared/model/host-contracts/model-routing";

/** Shared Work retains this exact coordinator occurrence until admission or reconciliation. */
export class CrewWorkWait extends Error {
  constructor(
    message: string,
    readonly unstarted: boolean,
  ) {
    super(message);
    this.name = "CrewWorkWait";
  }
}

export class CrewRoutingWait extends Error {
  constructor(readonly nextResetAt?: number) {
    super("Crew is waiting for an eligible model. Retry when quota or model availability changes.");
    // Task launch recognises the wait by name; host/tasks does not import crews.
    this.name = "CrewRoutingWait";
  }
}

export async function resolveCrewCandidate(
  store: HostStore,
  discover: (projectId: string) => Promise<HostModelCatalog>,
  probe: boolean,
  probeCapability: (
    candidate: CrewCandidate,
    capability: CrewCapability,
  ) => Promise<boolean | undefined>,
  now: () => number,
  projectId: string,
  definition: CrewDefinition,
  memberId: string,
  required: CrewCapability[],
  excluded: readonly CrewCandidate[],
) {
  const original = definition.agents.find((a) => a.id === memberId);
  const agent = original && structuredClone(original);
  if (!agent) throw new Error("Unknown crew member");
  const catalog = await discover(projectId);
  const same = (left: CrewCandidate, right: ModelRoutingTarget) =>
    left.harness === right.harness &&
    left.model === right.model &&
    left.providerAccountId === right.providerAccountId;
  const toCandidate = (target: ModelRoutingTarget): CrewCandidate => ({
    ...target,
    id: `${target.harness}/${target.providerAccountId ?? "default"}/${target.model}`,
    capabilities: structuredClone(
      agent.candidates.find((candidate) => same(candidate, target))?.capabilities ?? {},
    ),
  });
  const routing = await readModelRouting(store);
  const candidates = [...agent.candidates, ...routing.entries.map(toCandidate)];
  if (required.length && probe)
    await Promise.all(
      candidates.map(async (candidate) => {
        for (const capability of required) {
          const available = await probeCapability(candidate, capability);
          candidate.capabilities[capability] = {
            state: available === undefined ? "unknown" : available ? "available" : "unavailable",
            observedAt: now(),
            source: "host runtime probe",
          };
        }
      }),
    );
  const eligible = (target: ModelRoutingTarget) => {
    if (excluded.some((candidate) => same(candidate, target))) return false;
    const candidate = candidates.find((candidate) => same(candidate, target));
    return (
      !!candidate &&
      required.every((key) => {
        const evidence = candidate.capabilities[key];
        return (
          evidence?.state === "available" &&
          evidence.observedAt <= now() &&
          now() - evidence.observedAt < 24 * 60 * 60 * 1000
        );
      })
    );
  };
  const fixed = agent.candidates[0]!;
  const choice =
    agent.selection === "fixed"
      ? { kind: "fixed" as const }
      : (agent.modelChoice ?? { kind: "fixed" as const });
  const service =
    choice.kind === "fixed" || !routing.entries.length
      ? createModelRoutingService({
          store: store,
          accounts: async () => ({}),
          catalog: async () => undefined,
          signals: async () => ({
            available: () => false,
            signedIn: () => false,
            quota: () => ({ unknown: true }),
            accountKind: () => undefined,
          }),
        })
      : hostModelRoutingService(store);
  let resolution = await resolveModelChoice(service, {
    role: "crew.member",
    choice,
    fixed,
    eligible,
    cwd: await projectRoutingCwd(store, projectId),
  });
  if (!resolution.ok && resolution.reason === "noEligibleEntry")
    throw new CrewRoutingWait(resolution.nextResetAt);
  if (!resolution.ok)
    resolution = await resolveModelChoice(service, {
      role: "crew.member",
      choice: { kind: "fixed" },
      fixed,
    });
  const concrete = resolution.ok
    ? {
        ...(agent.selection === "fixed" ? fixed : toCandidate(resolution.target)),
        ...resolution.target,
        capabilities:
          candidates.find((candidate) => same(candidate, resolution.target))?.capabilities ?? {},
      }
    : fixed;
  return selectCrewCandidate(
    { ...agent, selection: "fixed", candidates: [concrete] },
    definition.policy,
    required,
    (candidate) =>
      eligible(candidate) &&
      !!catalog.models[candidate.harness]?.some((model) => model.id === candidate.model),
    now(),
  );
}

/** Retry a quota-held coordinator and atomically retain its concrete launch target. */
export async function retryCrewCoordinatorRouting(
  store: HostStore,
  run: CrewRun,
  now: () => number,
  select: (memberId: string) => ReturnType<typeof resolveCrewCandidate>,
  update: (run: CrewRun) => Promise<unknown>,
): Promise<CrewRun> {
  if (!run.routingWait) return run;
  if (run.routingWait.nextResetAt !== undefined && now() < run.routingWait.nextResetAt) return run;
  const coordinator = run.definition.agents.find((agent) => agent.role === "coordinator")!;
  let selected;
  try {
    selected = await select(coordinator.id);
  } catch (error) {
    if (!(error instanceof CrewRoutingWait)) throw error;
    return run;
  }
  run = await store.transaction(async () => {
    const current = await readCrewRun(store, run.id);
    if (!current || current.projectId !== run.projectId)
      throw new Error("Crew run does not belong to this project");
    if (!current.routingWait || current.coordinatorSessionId || current.status !== "active")
      return current;
    current.coordinatorCandidate = selected.candidate;
    current.launch = { ...current.launch!, candidate: selected.candidate };
    delete current.routingWait;
    delete current.error;
    await update(current);
    return current;
  });

  return run;
}
