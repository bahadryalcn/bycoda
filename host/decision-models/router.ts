import {
  DEFAULT_THRESHOLD,
  type DecisionConfig,
  type DecisionSource,
  type DecisionTaskType,
} from "./decision-types";

export type PlannedSource = { source: DecisionSource; threshold: number };

/** Default order when a task has no route: local, then API, then gateway, then LLM. */
const KIND_ORDER: DecisionSource["kind"][] = ["local", "api", "gateway", "llm"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * A local source must point at loopback when it names an endpoint. Otherwise the "personal data stays
 * local" rule could send data to a remote host through a source labeled local.
 */
export function isLocalSource(source: DecisionSource): boolean {
  if (source.kind !== "local") return false;
  if (!source.endpoint) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(source.endpoint).hostname);
  } catch {
    return false;
  }
}

/**
 * Ordered sources for one task. An empty list means nothing may answer; the caller then reports
 * "unavailable" and never falls back to a remote source for personal data.
 */
export function planRoute(
  config: DecisionConfig,
  taskType: DecisionTaskType,
  personalData: boolean,
): PlannedSource[] {
  const route = config.routing[taskType];
  const threshold =
    route && route.threshold > 0 && route.threshold <= 1 ? route.threshold : DEFAULT_THRESHOLD;
  let sources: DecisionSource[];
  if (route) {
    const byId = new Map(config.sources.map((source) => [source.id, source]));
    const seen = new Set<string>();
    sources = [];
    for (const id of route.sourceIds) {
      const source = byId.get(id);
      if (source && !seen.has(id)) {
        seen.add(id);
        sources.push(source);
      }
    }
  } else {
    sources = KIND_ORDER.flatMap((kind) => config.sources.filter((source) => source.kind === kind));
  }
  if (personalData && config.localOnlyPersonalData) sources = sources.filter(isLocalSource);
  return sources.map((source) => ({ source, threshold }));
}
