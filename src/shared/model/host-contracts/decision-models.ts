import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";
import {
  IdentifierSchema,
  JsonObjectSchema,
  JsonValueSchema,
  WIRE_SHA256_PATTERN,
} from "./schemas";

/** Task types are the closed routing keys shared by Social, AI tools and later features. */
export const DECISION_TASK_TYPES = [
  "screen_state",
  "element_choice",
  "audience_classify",
  "interest_score",
  "sentiment",
  "optout",
  "inbox_priority",
  "generic",
] as const;
export type DecisionTaskTypeName = (typeof DECISION_TASK_TYPES)[number];

const text = (max: number) => z.string().min(1).max(max);

export const DecisionTaskTypeSchema = z.enum(DECISION_TASK_TYPES);
export const DecisionSourceKindSchema = z.enum(["local", "api", "gateway", "llm"]);
export const DecisionAdapterSchema = z.enum([
  "systemone",
  "decisions",
  "ollama-systemone",
  "llm-structured",
  "custom",
]);
export const DecisionSourceStatusSchema = z.enum(["unknown", "ready", "error", "stopped"]);
export const DecisionErrorCodeSchema = z.enum(["below_threshold", "unavailable"]);

/** User-editable source fields. The Host assigns id, status and secretRef itself. */
export const DecisionSourceInputSchema = z.strictObject({
  name: text(100),
  kind: DecisionSourceKindSchema,
  adapter: DecisionAdapterSchema,
  endpoint: text(2048).optional(),
  model: text(200).optional(),
  /** Catalog provider this source was added from (limits and verification labels). */
  catalogId: IdentifierSchema.optional(),
  /** Configured provider harness used by the llm-structured adapter. */
  harness: text(64).optional(),
  /** Header that carries the key for a custom endpoint; default is Authorization: Bearer. The Host checks the name. */
  authHeader: text(64).optional(),
  local: z
    .strictObject({
      modelPath: text(4096),
      runtimePath: text(4096).optional(),
      port: z.number().int().min(1).max(65535).optional(),
    })
    .optional(),
});

export const DecisionSourceSchema = DecisionSourceInputSchema.extend({
  id: IdentifierSchema,
  status: DecisionSourceStatusSchema,
  secretRef: IdentifierSchema.optional(),
  avgMs: z.number().min(0).optional(),
  lastAccuracy: z.number().min(0).max(1).optional(),
  costPerMTokens: z.number().min(0).optional(),
});

export const DecisionRouteSchema = z.strictObject({
  sourceIds: z.array(IdentifierSchema).max(16),
  threshold: z.number().min(0).max(1),
});

const optionalRoute = DecisionRouteSchema.optional();
export const DecisionRoutingSchema = z.strictObject({
  screen_state: optionalRoute,
  element_choice: optionalRoute,
  audience_classify: optionalRoute,
  interest_score: optionalRoute,
  sentiment: optionalRoute,
  optout: optionalRoute,
  inbox_priority: optionalRoute,
  generic: optionalRoute,
});

export const DecisionQuestionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("choice"),
    instructions: text(2000),
    criteria: z.record(text(100), text(500)),
  }),
  z.strictObject({
    type: z.literal("noul"),
    instructions: text(2000),
    criteria: z.strictObject({ true: text(500), false: text(500) }),
  }),
  z.strictObject({
    type: z.literal("score"),
    instructions: text(2000),
    criteria: z.array(text(500)).min(2).max(10),
  }),
]);

export const DecisionRequestSchema = z.strictObject({
  taskType: DecisionTaskTypeSchema,
  personalData: z.boolean(),
  state: JsonObjectSchema,
  questions: z.record(text(64), DecisionQuestionSchema),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

export const DecisionAnswerSchema = z.strictObject({
  value: z.union([z.string(), z.number(), z.boolean()]),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
  confidence: z.number().min(0).max(1),
  raw: JsonValueSchema.optional(),
  sourceId: IdentifierSchema,
  model: text(200),
});

export const DecisionErrorAnswerSchema = z.strictObject({ error: DecisionErrorCodeSchema });

export const DecisionResultSchema = z.strictObject({
  answers: z.record(text(64), z.union([DecisionAnswerSchema, DecisionErrorAnswerSchema])),
  sourceChain: z.array(IdentifierSchema).max(16),
  durationMs: z.number().min(0),
});

export const DecisionSourceTestSchema = z.strictObject({
  sourceId: IdentifierSchema,
  ok: z.boolean(),
  durationMs: z.number().min(0).optional(),
  error: DecisionErrorCodeSchema.optional(),
});

export const DecisionEvaluationSchema = z.strictObject({
  sourceId: IdentifierSchema,
  cases: z.number().int().min(0),
  accuracy: z.number().min(0).max(1).optional(),
  avgMs: z.number().min(0).optional(),
  error: DecisionErrorCodeSchema.optional(),
});

export const DiscoveryCandidateSchema = z.strictObject({
  id: IdentifierSchema,
  label: text(200),
  kind: z.enum(["local_service", "model_file", "runtime_process", "api_key"]),
  detail: text(500).optional(),
});

export const DiscoveryResultSchema = z.strictObject({
  found: z.array(DiscoveryCandidateSchema).max(200),
});

export const HardwareInfoSchema = z.strictObject({
  ramBytes: z.number().int().min(0),
  freeRamBytes: z.number().int().min(0),
  cpus: z.number().int().min(0),
  gpus: z
    .array(
      z.strictObject({
        name: text(200),
        vramBytes: z.number().int().min(0).optional(),
      }),
    )
    .max(8),
  freeDiskBytes: z.number().int().min(0),
});

export const LocalRecommendationSchema = z.strictObject({
  tier: z.enum(["strong", "medium", "cpu", "insufficient"]),
  modelId: IdentifierSchema.optional(),
});

export const LocalStatusSchema = z.strictObject({
  state: z.enum(["unsupported", "not_installed", "installed", "running", "stopped", "error"]),
  sourceId: IdentifierSchema.optional(),
});

export const DecisionCatalogEntrySchema = z.strictObject({
  id: IdentifierSchema,
  name: text(200),
  kind: DecisionSourceKindSchema,
  adapter: DecisionAdapterSchema,
  endpoint: text(2048).optional(),
  verified: z.boolean(),
  docsUrl: text(2048).optional(),
  /** Models the catalog lists for this provider; a gateway's live model list is not fetched yet. */
  models: z
    .array(z.strictObject({ id: IdentifierSchema, name: text(200), verified: z.boolean() }))
    .max(64)
    .optional(),
});

export const DecisionCatalogSchema = z.strictObject({
  version: z.number().int().min(0),
  entries: z.array(DecisionCatalogEntrySchema).max(500),
});

export const DecisionRoutingStateSchema = z.strictObject({
  routing: DecisionRoutingSchema,
  localOnlyPersonalData: z.boolean(),
});

const EmptyParamsSchema = z.strictObject({});
export const DecisionSourceIdParamsSchema = z.strictObject({ id: IdentifierSchema });

export const DecisionSourcesListResultSchema = z.strictObject({
  sources: z.array(DecisionSourceSchema).max(64),
});
export const DecisionSourcesAddParamsSchema = z.strictObject({
  source: DecisionSourceInputSchema,
  apiKey: text(4096).optional(),
});
export const DecisionSourcesUpdateParamsSchema = z.strictObject({
  id: IdentifierSchema,
  patch: DecisionSourceInputSchema.partial(),
  apiKey: text(4096).optional(),
});
export const DecisionSourcesRemoveResultSchema = z.strictObject({ removed: z.boolean() });
/** Must equal the Host's INSTALL_CONFIRMATION; a download starts only when the caller sends it. */
export const DECISION_INSTALL_CONFIRMATION = "INSTALL_DECISION_MODEL";
export const DecisionLocalInstallParamsSchema = z.strictObject({
  modelId: IdentifierSchema,
  confirm: z.literal(DECISION_INSTALL_CONFIRMATION),
});
export const DecisionModelIdParamsSchema = z.strictObject({ modelId: IdentifierSchema });
export const DecisionLocalPlanSchema = z.strictObject({
  modelId: IdentifierSchema,
  name: text(200),
  installable: z.boolean(),
  files: z
    .array(
      z.strictObject({
        fileName: text(260),
        sizeBytes: z.number().int().positive().optional(),
      }),
    )
    .max(8),
  downloadBytes: z.number().int().min(0),
  freeDiskBytes: z.number().int().min(0),
  fits: z.boolean(),
});

const Sha256Schema = z.string().regex(WIRE_SHA256_PATTERN);
export const DecisionManualVerifyParamsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("model_file"), path: text(4096) }),
  z.strictObject({ kind: z.literal("installation_folder"), path: text(4096) }),
  z.strictObject({ kind: z.literal("endpoint"), url: text(2048) }),
]);
export const DecisionManualVerifyResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("model_file"),
    path: text(4096),
    sizeBytes: z.number().int().min(0),
    ggufVersion: z.number().int().min(0),
    sha256: Sha256Schema.optional(),
    verified: z.boolean(),
    catalogModelId: IdentifierSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("installation_folder"),
    folder: text(4096),
    model: text(200).optional(),
    modelPath: text(4096),
    runtimePath: text(4096).optional(),
    endpoint: text(2048).optional(),
    verified: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("endpoint"),
    url: text(2048),
    reachable: z.boolean(),
    contract: z.literal("systemone").optional(),
    adapter: DecisionAdapterSchema.optional(),
  }),
]);

export const DecisionDiscoverySettingsSchema = z.strictObject({
  extraPorts: z.array(z.number().int().min(1).max(65535)).max(16),
  extraFolders: z.array(text(4096)).max(32),
});
export const DecisionDiscoverySettingsPatchSchema = DecisionDiscoverySettingsSchema.partial();
export const DecisionFirstRunSchema = z.strictObject({ dismissed: z.boolean() });

export const DecisionRoutingSetParamsSchema = z.strictObject({
  routing: DecisionRoutingSchema.optional(),
  localOnlyPersonalData: z.boolean().optional(),
});

/** Method inventory for `decisionModels.*`. Served through owner RPC; not advertised on WS. */
export const DECISION_MODELS_RPC = {
  "decisionModels.sources.list": {
    params: EmptyParamsSchema,
    result: DecisionSourcesListResultSchema,
    query: true,
  },
  "decisionModels.sources.add": {
    params: DecisionSourcesAddParamsSchema,
    result: DecisionSourceSchema,
    query: false,
  },
  "decisionModels.sources.update": {
    params: DecisionSourcesUpdateParamsSchema,
    result: DecisionSourceSchema,
    query: false,
  },
  "decisionModels.sources.remove": {
    params: DecisionSourceIdParamsSchema,
    result: DecisionSourcesRemoveResultSchema,
    query: false,
  },
  "decisionModels.sources.test": {
    params: DecisionSourceIdParamsSchema,
    result: DecisionSourceTestSchema,
    query: false,
  },
  "decisionModels.sources.evaluate": {
    params: DecisionSourceIdParamsSchema,
    result: DecisionEvaluationSchema,
    query: false,
  },
  "decisionModels.discovery.scan": {
    params: EmptyParamsSchema,
    result: DiscoveryResultSchema,
    query: false,
  },
  "decisionModels.discovery.results": {
    params: EmptyParamsSchema,
    result: DiscoveryResultSchema,
    query: true,
  },
  "decisionModels.local.hardware": {
    params: EmptyParamsSchema,
    result: HardwareInfoSchema,
    query: true,
  },
  "decisionModels.local.recommend": {
    params: EmptyParamsSchema,
    result: LocalRecommendationSchema,
    query: true,
  },
  "decisionModels.local.install": {
    params: DecisionLocalInstallParamsSchema,
    result: LocalStatusSchema,
    query: false,
  },
  "decisionModels.local.start": {
    params: DecisionSourceIdParamsSchema,
    result: LocalStatusSchema,
    query: false,
  },
  "decisionModels.local.stop": {
    params: DecisionSourceIdParamsSchema,
    result: LocalStatusSchema,
    query: false,
  },
  "decisionModels.local.uninstall": {
    params: DecisionSourceIdParamsSchema,
    result: LocalStatusSchema,
    query: false,
  },
  "decisionModels.local.status": {
    params: DecisionSourceIdParamsSchema,
    result: LocalStatusSchema,
    query: true,
  },
  "decisionModels.local.plan": {
    params: DecisionModelIdParamsSchema,
    result: DecisionLocalPlanSchema,
    query: true,
  },
  "decisionModels.manual.verify": {
    params: DecisionManualVerifyParamsSchema,
    result: DecisionManualVerifyResultSchema,
    query: false,
  },
  "decisionModels.discovery.settings.get": {
    params: EmptyParamsSchema,
    result: DecisionDiscoverySettingsSchema,
    query: true,
  },
  "decisionModels.discovery.settings.set": {
    params: DecisionDiscoverySettingsPatchSchema,
    result: DecisionDiscoverySettingsSchema,
    query: false,
  },
  "decisionModels.firstRun.get": {
    params: EmptyParamsSchema,
    result: DecisionFirstRunSchema,
    query: true,
  },
  "decisionModels.firstRun.set": {
    params: DecisionFirstRunSchema,
    result: DecisionFirstRunSchema,
    query: false,
  },
  "decisionModels.routing.get": {
    params: EmptyParamsSchema,
    result: DecisionRoutingStateSchema,
    query: true,
  },
  "decisionModels.routing.set": {
    params: DecisionRoutingSetParamsSchema,
    result: DecisionRoutingStateSchema,
    query: false,
  },
  "decisionModels.catalog.get": {
    params: EmptyParamsSchema,
    result: DecisionCatalogSchema,
    query: true,
  },
  "decisionModels.decide": {
    params: DecisionRequestSchema,
    result: DecisionResultSchema,
    query: false,
  },
} as const;

export type DecisionModelsMethod = keyof typeof DECISION_MODELS_RPC;

/**
 * Owner-RPC inventory for decision models; advertised by no WS capability yet. The caller passes
 * its workflow builder in, as appearanceMethods does, so this module never imports methods at runtime.
 */
export function decisionModelsMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: DecisionModelsMethod): HostRpcMethodDefinition => {
    const schema = DECISION_MODELS_RPC[method];
    return workflow("decisionModels.v1", schema.params, schema.result, schema.query);
  };
  return {
    "decisionModels.sources.list": operation("decisionModels.sources.list"),
    "decisionModels.sources.add": operation("decisionModels.sources.add"),
    "decisionModels.sources.update": operation("decisionModels.sources.update"),
    "decisionModels.sources.remove": operation("decisionModels.sources.remove"),
    "decisionModels.sources.test": operation("decisionModels.sources.test"),
    "decisionModels.sources.evaluate": operation("decisionModels.sources.evaluate"),
    "decisionModels.discovery.scan": operation("decisionModels.discovery.scan"),
    "decisionModels.discovery.results": operation("decisionModels.discovery.results"),
    "decisionModels.discovery.settings.get": operation("decisionModels.discovery.settings.get"),
    "decisionModels.discovery.settings.set": operation("decisionModels.discovery.settings.set"),
    "decisionModels.manual.verify": operation("decisionModels.manual.verify"),
    "decisionModels.firstRun.get": operation("decisionModels.firstRun.get"),
    "decisionModels.firstRun.set": operation("decisionModels.firstRun.set"),
    "decisionModels.local.hardware": operation("decisionModels.local.hardware"),
    "decisionModels.local.recommend": operation("decisionModels.local.recommend"),
    "decisionModels.local.plan": operation("decisionModels.local.plan"),
    "decisionModels.local.install": operation("decisionModels.local.install"),
    "decisionModels.local.start": operation("decisionModels.local.start"),
    "decisionModels.local.stop": operation("decisionModels.local.stop"),
    "decisionModels.local.uninstall": operation("decisionModels.local.uninstall"),
    "decisionModels.local.status": operation("decisionModels.local.status"),
    "decisionModels.routing.get": operation("decisionModels.routing.get"),
    "decisionModels.routing.set": operation("decisionModels.routing.set"),
    "decisionModels.catalog.get": operation("decisionModels.catalog.get"),
    "decisionModels.decide": operation("decisionModels.decide"),
  };
}
