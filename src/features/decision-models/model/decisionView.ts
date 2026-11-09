import { formatNumber, t } from "../../../shared/i18n";
import { formatBytes } from "../../../shared/i18n/format";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { BadgeTone } from "../../../shared/ui/Badge";
import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import type {
  DecisionCatalogEntry,
  DecisionRoute,
  DecisionRouting,
  DecisionSource,
  DecisionSourceInput,
  DecisionSourceKind,
  DecisionTaskType,
  DiscoveryCandidate,
  HardwareInfo,
  LocalRecommendation,
} from "./decisionTypes";

/** UI default for a route's threshold; the Host gateway applies the same value when a route omits it. */
export const DEFAULT_ROUTE_THRESHOLD = 0.85;
/** Mirrors the wire limit on `sourceIds`. */
export const MAX_ROUTE_SOURCES = 16;

export const CONTRACT_ADAPTERS = [
  "systemone",
  "decisions",
  "ollama-systemone",
  "llm-structured",
  "custom",
] as const;
export type ContractAdapter = (typeof CONTRACT_ADAPTERS)[number];

export function sourceKindLabel(kind: DecisionSourceKind): string {
  switch (kind) {
    case "local":
      return t("Local");
    case "api":
      return t("API");
    case "gateway":
      return t("Gateway");
    case "llm":
      return t("LLM");
  }
}

export function contractLabel(adapter: ContractAdapter): string {
  switch (adapter) {
    case "systemone":
      return t("System One");
    case "decisions":
      return t("Decisions API");
    case "ollama-systemone":
      return t("Ollama System One");
    case "llm-structured":
      return t("Structured LLM");
    case "custom":
      return t("Custom");
  }
}

export function sourceStatusLabel(status: DecisionSource["status"]): string {
  switch (status) {
    case "ready":
      return t("Ready");
    case "error":
      return t("Error");
    case "stopped":
      return t("Stopped");
    case "unknown":
      return t("Not tested");
  }
}

export function sourceStatusTone(status: DecisionSource["status"]): BadgeTone {
  switch (status) {
    case "ready":
      return "success";
    case "error":
      return "danger";
    case "stopped":
    case "unknown":
      return "neutral";
  }
}

export function taskTypeLabel(task: DecisionTaskType): string {
  switch (task) {
    case "screen_state":
      return t("Screen type");
    case "element_choice":
      return t("Button or field choice");
    case "audience_classify":
      return t("Contact classification");
    case "interest_score":
      return t("Interest score");
    case "sentiment":
      return t("Tone of a message");
    case "optout":
      return t("Stop requests");
    case "inbox_priority":
      return t("Inbox priority");
    case "generic":
      return t("Other questions");
  }
}

export function formatLatency(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  return t("{p1} ms", { p1: formatNumber(Math.round(ms)) });
}

export function formatAccuracy(value: number | undefined): string | null {
  if (value === undefined) return null;
  return formatNumber(value, { style: "percent", maximumFractionDigits: 0 });
}

export function formatCost(perMillionTokens: number | undefined): string | null {
  if (perMillionTokens === undefined) return null;
  return t("{p1} per million tokens", {
    p1: formatNumber(perMillionTokens, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 3,
    }),
  });
}

export function formatHardware(hardware: HardwareInfo): string[] {
  const gpu =
    hardware.gpus.length > 0
      ? hardware.gpus
          .map((item) =>
            item.vramBytes === undefined
              ? item.name
              : `${item.name} (${formatBytes(item.vramBytes)})`,
          )
          .join(", ")
      : t("No dedicated GPU found");
  return [
    t("Memory: {p1} total, {p2} free", {
      p1: formatBytes(hardware.ramBytes),
      p2: formatBytes(hardware.freeRamBytes),
    }),
    t("Processor: {p1} cores", { p1: formatNumber(hardware.cpus) }),
    t("Graphics: {p1}", { p1: gpu }),
    t("Free disk space: {p1}", { p1: formatBytes(hardware.freeDiskBytes) }),
  ];
}

/** Only http(s) addresses are accepted here; reachability is checked by the Host test request. */
export function endpointError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t("Enter an address.");
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return null;
  } catch {
    // Not a parseable URL: the shared message below covers it.
  }
  return t("Enter a full http or https address.");
}

export function nameError(value: string): string | null {
  return value.trim() ? null : t("Enter a name.");
}

/** Names are shown in lists; the wire limit is 100 characters. */
export function clampName(value: string): string {
  return truncateGraphemes(value.trim(), 100, "");
}

export function setRouteSources(
  route: DecisionRoute | undefined,
  sourceIds: readonly string[],
): DecisionRoute {
  return {
    sourceIds: [...new Set(sourceIds)].slice(0, MAX_ROUTE_SOURCES),
    threshold: route?.threshold ?? DEFAULT_ROUTE_THRESHOLD,
  };
}

export function setRouteThreshold(
  route: DecisionRoute | undefined,
  threshold: number,
): DecisionRoute {
  return { sourceIds: route?.sourceIds ?? [], threshold };
}

/** Drops tasks without sources so a cleared row does not reach the Host as an empty route. */
export function cleanRouting(routing: DecisionRouting): DecisionRouting {
  const next: DecisionRouting = {};
  for (const task of DECISION_TASK_TYPES) {
    const route = routing[task];
    if (route && route.sourceIds.length > 0) next[task] = route;
  }
  return next;
}

/** Only a model file found on this computer maps to one click; other candidates need the dialog. */
export function candidateSourceInput(candidate: DiscoveryCandidate): DecisionSourceInput | null {
  if (candidate.kind !== "model_file" || !candidate.detail) return null;
  return {
    name: clampName(candidate.label),
    kind: "local",
    adapter: "systemone",
    local: { modelPath: candidate.detail },
  };
}

export function candidateKindLabel(kind: DiscoveryCandidate["kind"]): string {
  switch (kind) {
    case "local_service":
      return t("Running service");
    case "model_file":
      return t("Model file");
    case "runtime_process":
      return t("Running program");
    case "api_key":
      return t("Key found on this computer");
  }
}

export type LocalOffer = "install" | "api" | "unknown";

/** Local install is offered only for a usable tier with a catalog model; an insufficient machine gets the API path. */
export function localOffer(recommendation: LocalRecommendation | null | undefined): LocalOffer {
  if (!recommendation) return "unknown";
  if (recommendation.tier === "insufficient") return "api";
  return recommendation.modelId ? "install" : "unknown";
}

export function recommendationText(tier: LocalRecommendation["tier"]): string {
  switch (tier) {
    case "strong":
      return t("This computer is suited to local use. A GPU model is recommended for speed.");
    case "medium":
      return t("This computer can run a smaller local model.");
    case "cpu":
      return t("This computer can run a small model on the processor. It may be slow.");
    case "insufficient":
      return t("This computer is not suited to local use. An API provider is recommended.");
  }
}

/** Raw error text is shown only inside the technical details disclosure, never as the main message. */
export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function catalogLabel(entry: DecisionCatalogEntry): string {
  return entry.verified ? entry.name : `${entry.name} · ${t("Not verified")}`;
}

/** A loopback address is a local service; anything else is treated as a remote API. */
export function endpointSourceKind(value: string): "local" | "api" {
  try {
    const host = new URL(value.trim()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? "local" : "api";
  } catch {
    return "api";
  }
}

/** Host error codes are plain words in the UI; the code itself never reaches the user. */
export function sourceErrorText(code: "below_threshold" | "unavailable" | undefined): string {
  if (code === "below_threshold") return t("Confidence is below the threshold.");
  return t("Not available yet.");
}
