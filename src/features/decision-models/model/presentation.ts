import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import type { DecisionRouting, DecisionSource, DiscoveryCandidate } from "./decisionTypes";
import { candidateSourceInput } from "./decisionView";

const kinds = ["local", "api", "gateway", "llm"];
/** Same stable order as Host planRoute; status does not change fallback priority. */
export function automaticSources(sources: DecisionSource[]): DecisionSource[] {
  return kinds.flatMap((kind) => sources.filter((source) => source.kind === kind));
}
function pathIdentity(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}
function endpointIdentity(endpoint: string): string {
  try {
    return new URL(endpoint).href.replace(/\/$/, "");
  } catch {
    return endpoint;
  }
}
/** Match exact file or endpoint/model identity, never a similar display name. */
export function sameSource(a: DecisionSource, b: DecisionSource): boolean {
  if (
    a.local?.modelPath &&
    b.local?.modelPath &&
    pathIdentity(a.local.modelPath) === pathIdentity(b.local.modelPath)
  )
    return true;
  return Boolean(
    a.endpoint &&
    b.endpoint &&
    endpointIdentity(a.endpoint) === endpointIdentity(b.endpoint) &&
    (a.model ?? "") === (b.model ?? "") &&
    a.adapter === b.adapter,
  );
}
export function connectedCandidate(
  candidate: DiscoveryCandidate,
  sources: DecisionSource[],
): DecisionSource | undefined {
  const input = candidateSourceInput(candidate);
  if (input?.local)
    return sources.find(
      (source) =>
        source.local &&
        pathIdentity(source.local.modelPath) === pathIdentity(input.local!.modelPath),
    );
  if (candidate.kind === "local_service" && candidate.detail)
    return sources.find(
      (source) =>
        source.endpoint &&
        endpointIdentity(source.endpoint) === endpointIdentity(candidate.detail!),
    );
  return undefined;
}
/** Count semantic route changes; key ordering and empty automatic routes are irrelevant. */
export function routingChanges(draft: DecisionRouting, saved: DecisionRouting): number {
  return DECISION_TASK_TYPES.filter((task) => {
    const a = draft[task]?.sourceIds.length ? draft[task] : undefined;
    const b = saved[task]?.sourceIds.length ? saved[task] : undefined;
    return (
      a?.threshold !== b?.threshold || JSON.stringify(a?.sourceIds) !== JSON.stringify(b?.sourceIds)
    );
  }).length;
}
