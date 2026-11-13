import type {
  DecisionRouting,
  DecisionTaskType,
  DecisionSource,
  SourceTestResult,
} from "./decisionTypes";
import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import { routingChanges } from "./presentation";

/** A new Host snapshot updates clean routes without replacing the owner's unsaved routes. */
export function mergeRoutingDraft(
  previous: DecisionRouting,
  draft: DecisionRouting,
  incoming: DecisionRouting,
): DecisionRouting {
  const next = { ...incoming };
  for (const task of DECISION_TASK_TYPES) {
    if (!routingChanges({ [task]: previous[task] }, { [task]: draft[task] })) continue;
    if (draft[task]) next[task] = draft[task];
    else delete next[task];
  }
  return next;
}

/** A test describes one source configuration and lifecycle state. */
export type SourceTestSnapshot = { source: DecisionSource; result: SourceTestResult };

export function matchingTest(
  source: DecisionSource,
  snapshot?: SourceTestSnapshot,
): SourceTestResult | undefined {
  if (!snapshot) return undefined;
  const key = (value: DecisionSource) =>
    JSON.stringify([
      value.id,
      value.name,
      value.kind,
      value.adapter,
      value.endpoint,
      value.model,
      value.catalogId,
      value.harness,
      value.authHeader,
      value.local?.modelPath,
      value.local?.runtimePath,
      value.local?.projectorPath,
      value.local?.port,
      value.secretRef,
      value.status,
    ]);
  return key(source) === key(snapshot.source) ? snapshot.result : undefined;
}

export function testedSources(
  sources: DecisionSource[] | null,
  results: Record<string, SourceTestSnapshot>,
): DecisionSource[] | null {
  return (
    sources?.map((source) => {
      const result = matchingTest(source, results[source.id]);
      return result ? { ...source, status: result.ok ? "ready" : "error" } : source;
    }) ?? null
  );
}

export function parseThreshold(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Selected sources stay in fallback order; search never changes selection. */
export function sourceOptions(
  ids: readonly string[],
  sources: DecisionSource[],
  search: string,
): string[] {
  const query = search.trim().toLocaleLowerCase();
  return [
    ...ids,
    ...sources.filter((source) => !ids.includes(source.id)).map((source) => source.id),
  ].filter((id) =>
    (sources.find((source) => source.id === id)?.name ?? id).toLocaleLowerCase().includes(query),
  );
}

/** Reorder only existing selections; moving past either end is a no-op. */
export function moveSource(ids: readonly string[], id: string, offset: -1 | 1): string[] {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Absence restores Host automatic routing, including its default threshold. */
export function resetRoute(routing: DecisionRouting, task: DecisionTaskType): DecisionRouting {
  const next = { ...routing };
  delete next[task];
  return next;
}
