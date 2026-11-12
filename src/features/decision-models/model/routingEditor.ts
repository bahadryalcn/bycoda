import type {
  DecisionRouting,
  DecisionTaskType,
  DecisionSource,
  SourceTestResult,
} from "./decisionTypes";

/** Latest explicit connection test also drives summary counts until the next test. */
export function testedSources(
  sources: DecisionSource[] | null,
  results: Record<string, SourceTestResult>,
): DecisionSource[] | null {
  return (
    sources?.map((source) =>
      results[source.id]
        ? { ...source, status: results[source.id].ok ? "ready" : "error" }
        : source,
    ) ?? null
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
