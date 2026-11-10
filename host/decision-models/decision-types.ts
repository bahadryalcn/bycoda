import type { DecisionTaskTypeName } from "../../src/shared/model/host-contracts/decision-models";

/** Closed routing keys; the list lives in the shared contract (`DECISION_TASK_TYPES`). */
export type DecisionTaskType = DecisionTaskTypeName;

/** Confidence at or above this value is used; below it the next source is tried. */
export const DEFAULT_THRESHOLD = 0.85;

export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type DecisionRequest = {
  taskType: DecisionTaskTypeName;
  personalData: boolean;
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  timeoutMs?: number;
};

export type DecisionErrorCode = "below_threshold" | "unavailable";

export type DecisionAnswer = {
  value: string | number | boolean;
  probabilities?: Record<string, number>;
  /** Normalized by the gateway to 0-1; providers' own confidence scales are not comparable. */
  confidence: number;
  raw?: unknown;
  sourceId: string;
  model: string;
};

export type DecisionResult = {
  answers: Record<string, DecisionAnswer | { error: DecisionErrorCode }>;
  sourceChain: string[];
  durationMs: number;
};

export interface DecisionService {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

export type DecisionSource = {
  id: string;
  name: string;
  kind: "local" | "api" | "gateway" | "llm";
  adapter: "systemone" | "decisions" | "ollama-systemone" | "llm-structured" | "custom";
  endpoint?: string;
  model?: string;
  secretRef?: string;
  local?: { modelPath: string; runtimePath?: string; projectorPath?: string; port?: number };
  catalogId?: string;
  harness?: string;
  authHeader?: string;
  status: "unknown" | "ready" | "error" | "stopped";
  avgMs?: number;
  lastAccuracy?: number;
  costPerMTokens?: number;
};

/** The user-editable part of a source; the Host assigns id, status and secretRef. */
export type DecisionSourceInput = Pick<
  DecisionSource,
  | "name"
  | "kind"
  | "adapter"
  | "endpoint"
  | "model"
  | "local"
  | "catalogId"
  | "harness"
  | "authHeader"
>;

export type DecisionRoute = { sourceIds: string[]; threshold: number };

export type DecisionRouting = { [K in DecisionTaskTypeName]?: DecisionRoute };

export type DecisionConfig = {
  version: 1;
  sources: DecisionSource[];
  routing: DecisionRouting;
  localOnlyPersonalData: boolean;
  discovery: { extraPorts: number[]; extraFolders: string[] };
  firstRunDismissed: boolean;
};

export type DecisionSourceTest = {
  sourceId: string;
  ok: boolean;
  durationMs?: number;
  error?: DecisionErrorCode;
};

export type DecisionEvaluation = {
  sourceId: string;
  cases: number;
  accuracy?: number;
  avgMs?: number;
  error?: DecisionErrorCode;
};

export type HardwareInfo = {
  ramBytes: number;
  freeRamBytes: number;
  cpus: number;
  gpus: { name: string; vramBytes?: number }[];
  freeDiskBytes: number;
};

export type DiscoveryCandidate = {
  id: string;
  label: string;
  kind: "local_service" | "model_file" | "runtime_process" | "api_key";
  detail?: string;
};

export type DiscoveryResult = { found: DiscoveryCandidate[]; incomplete?: boolean };

export type LocalTier = "strong" | "medium" | "cpu" | "insufficient";

export type LocalRecommendation = { tier: LocalTier; modelId?: string };

export type LocalStatus = {
  state: "unsupported" | "not_installed" | "installed" | "running" | "stopped" | "error";
  sourceId?: string;
};
