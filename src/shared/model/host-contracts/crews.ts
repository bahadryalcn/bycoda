import { z } from "zod";
import { SafeCounterSchema, WIRE_UUID_V4_PATTERN } from "./schemas";
import {
  CommandReceiptSchema,
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "./session-commands";
import { HostTaskSchema } from "./tasks";

// Structural inventory only. Existing manual parsers retain text/number limits,
// role requirements, scope/dependency checks, fingerprints and authority.
const text = z.string();
export const CrewCapabilitySchema = z.enum([
  "code",
  "review",
  "image-generation",
  "vision",
  "browser",
  "terminal",
  "subagents",
]);
export const CrewCapabilityEvidenceSchema = z.strictObject({
  state: z.enum(["available", "unavailable", "unknown"]),
  observedAt: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
  source: text,
});
export const CrewCapabilitiesSchema = z.strictObject({
  code: CrewCapabilityEvidenceSchema.optional(),
  review: CrewCapabilityEvidenceSchema.optional(),
  "image-generation": CrewCapabilityEvidenceSchema.optional(),
  vision: CrewCapabilityEvidenceSchema.optional(),
  browser: CrewCapabilityEvidenceSchema.optional(),
  terminal: CrewCapabilityEvidenceSchema.optional(),
  subagents: CrewCapabilityEvidenceSchema.optional(),
});
export const CrewCandidateSchema = z.strictObject({
  id: text,
  harness: SessionProviderSchema,
  model: text,
  modelSettings: ModelSettingsSchema,
  capabilities: CrewCapabilitiesSchema,
  cost: z.number().optional(),
  quality: z.number().optional(),
  qualitySource: z.enum(["owner-estimate", "review-history"]).optional(),
  samples: SafeCounterSchema.optional(),
});
export const CrewRoleSchema = z.enum([
  "coordinator",
  "specialist",
  "reviewer",
  "advisor",
]);
export const CrewAgentSchema = z.strictObject({
  id: text,
  name: text,
  role: CrewRoleSchema,
  instructions: text,
  selection: z.enum(["fixed", "automatic"]),
  candidates: z.array(CrewCandidateSchema),
  groups: z.array(text).optional(),
  source: z.strictObject({ id: text, updatedAt: z.number() }).optional(),
});
export const CrewAgentInputSchema = CrewAgentSchema.extend({
  projectId: text.optional(),
  updatedAt: z.number().optional(),
});
export const SavedCrewAgentSchema = CrewAgentInputSchema.extend({
  updatedAt: z.number(),
});
export const CrewPolicySchema = z.strictObject({
  preset: z.enum(["economy", "balanced", "quality"]),
  maxParallel: z.number(),
  maxAssignments: z.number(),
  maxRunMinutes: z.number(),
  maxEstimatedCost: z.number().optional(),
  minimumQuality: z.number().optional(),
  costWeight: z.number().optional(),
  qualityWeight: z.number().optional(),
  allowUnknownCost: z.boolean(),
  allowSubagents: z.boolean(),
  delegateApprovals: z.boolean().optional(),
});
export const CrewDefinitionTemplateSchema = z.strictObject({
  id: text,
  name: text,
  projectId: text.optional(),
  agents: z.array(CrewAgentSchema),
  policy: CrewPolicySchema,
});
export const CrewDefinitionInputSchema = CrewDefinitionTemplateSchema.extend({
  updatedAt: z.number().optional(),
});
export const CrewDefinitionSchema = CrewDefinitionInputSchema.extend({
  updatedAt: z.number(),
});
export const CrewMessageSchema = z.strictObject({
  id: text,
  from: text,
  text,
  taskId: text.optional(),
  createdAt: SafeCounterSchema,
  resolvedAt: SafeCounterSchema.optional(),
});
export const CrewAssignmentSchema = z.strictObject({
  id: text,
  memberId: text,
  taskId: text,
  title: text,
  files: z.array(text).optional(),
  integration: z.boolean().optional(),
  candidate: CrewCandidateSchema,
  reason: text,
  estimatedCost: z.number().optional(),
  requestFingerprint: text.optional(),
});
export const CrewRunSchema = z.strictObject({
  title: text.optional(),
  sourceTaskId: text.optional(),
  requestedBySessionId: text.optional(),
  id: text,
  projectId: text,
  definition: CrewDefinitionSchema,
  status: z.enum(["active", "paused", "finished"]),
  coordinatorSessionId: text.optional(),
  coordinatorCandidate: CrewCandidateSchema.optional(),
  launch: z
    .strictObject({
      candidate: CrewCandidateSchema,
      runtimeMode: SessionRuntimeModeSchema,
      prompt: text,
    })
    .optional(),
  requestFingerprint: text.optional(),
  assignments: z.array(CrewAssignmentSchema),
  messages: z.array(CrewMessageSchema),
  notifications: z.record(text, text),
  pendingDelivery: z
    .strictObject({
      commandId: text,
      text,
      notifications: z.record(text, text),
    })
    .optional(),
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
  error: text.optional(),
});

// Read-only views cannot carry the launch/pending-delivery payload or member
// instructions. Reuse the full Task DTO while declaring its actual redactions.
export const CrewTaskViewSchema = HostTaskSchema.omit({
  retryFeedback: true,
}).extend({
  prompt: z.literal(""),
  reviewNotes: HostTaskSchema.shape.reviewNotes.unwrap().max(0),
  reviewerConfig: HostTaskSchema.shape.reviewerConfig
    .unwrap()
    .extend({ instructions: z.literal("") })
    .optional(),
  attemptHistory: z
    .array(
      HostTaskSchema.shape.attemptHistory
        .unwrap()
        .element.omit({ workspaceFingerprint: true })
        .extend({
          workerSummary: z.literal(""),
          note: z.literal(""),
          findings: z.array(text).max(0),
        }),
    )
    .optional(),
});
export const CrewRunViewSchema = CrewRunSchema.omit({
  launch: true,
  pendingDelivery: true,
}).extend({
  definition: CrewDefinitionSchema.extend({
    agents: z.array(CrewAgentSchema.extend({ instructions: z.literal("") })),
  }),
  tasks: z.array(CrewTaskViewSchema),
  coordinatorStatus: z.enum(["idle", "running", "interrupted"]).optional(),
});
export const CrewDirectorySchema = z.strictObject({
  definitions: z.array(CrewDefinitionSchema),
  agents: z.array(SavedCrewAgentSchema),
  runs: z.array(CrewRunViewSchema),
});
export const CrewApprovalSchema = z.strictObject({
  requestId: SafeCounterSchema,
  occurrenceId: z.string().regex(WIRE_UUID_V4_PATTERN).optional(),
  decided: z.enum(["allow", "deny", "cancelled"]).optional(),
});
export const CrewUserQuestionOptionSchema = z.strictObject({
  id: text,
  label: text,
  description: text.optional(),
  literal: z.boolean().optional(),
});
export const CrewUserQuestionSchema = z.strictObject({
  id: text,
  header: text.optional(),
  prompt: text,
  multiSelect: z.boolean(),
  allowCustom: z.boolean(),
  preserveCustomWhitespace: z.boolean().optional(),
  options: z.array(CrewUserQuestionOptionSchema),
});
export const CrewUserQuestionPromptSchema = z.strictObject({
  requestId: SafeCounterSchema,
  title: text.optional(),
  questions: z.array(CrewUserQuestionSchema),
  behavior: z.enum(["blocking", "nonBlocking"]).optional(),
  dismissAction: z.enum(["skip", "cancel", "decline"]).optional(),
  providerTurnId: text.optional(),
  callId: text.optional(),
  delivery: z.enum(["sending", "queued", "failed", "unknown"]).optional(),
  error: text.optional(),
  autoResolveAt: z.number().optional(),
});
const pendingTarget = {
  taskId: text,
  sessionId: text,
  targetRunId: text.optional(),
};
export const CrewPendingInputSchema = z.union([
  z.strictObject({ ...pendingTarget, approval: CrewApprovalSchema, text }),
  z.strictObject({ ...pendingTarget, question: CrewUserQuestionPromptSchema }),
]);
export const CrewRunDetailSchema = CrewRunViewSchema.extend({
  pendingInputs: z.array(CrewPendingInputSchema),
});

export const CrewModelSettingChoiceSchema = z.strictObject({
  value: text,
  label: text,
});
export const CrewModelSettingSchema = z.strictObject({
  id: text,
  label: text,
  kind: z.enum(["select", "toggle"]),
  value: text,
  options: z.array(CrewModelSettingChoiceSchema),
  description: text.optional(),
});
export const CrewCatalogModelSchema = z.strictObject({
  id: text,
  harness: SessionProviderSchema,
  name: text,
  nativeId: text.optional(),
  aliasTarget: text.optional(),
  provider: z.strictObject({ id: text, name: text }).optional(),
  settings: z.array(CrewModelSettingSchema).optional(),
  contextWindow: z.number().optional(),
});
function providerMap<S extends z.ZodType>(schema: S) {
  const fields = Object.fromEntries(
    SessionProviderSchema.options.map((provider) => [
      provider,
      schema.optional(),
    ]),
  ) as {
    [K in z.infer<typeof SessionProviderSchema>]: z.ZodOptional<S>;
  };
  return z.strictObject(fields);
}
export const CrewModelCatalogSchema = z.strictObject({
  models: providerMap(z.array(CrewCatalogModelSchema)),
  errors: providerMap(text),
  pending: z.array(SessionProviderSchema).optional(),
});
export const CrewCandidateObservationsSchema = z.strictObject({
  count: SafeCounterSchema,
  accepted: SafeCounterSchema,
  passed: SafeCounterSchema,
});
export const CrewInspectedCandidateSchema = CrewCandidateSchema.extend({
  observations: CrewCandidateObservationsSchema,
  imageGeneration: z.boolean().optional(),
});
export const CrewInspectResultSchema = z.union([
  z.strictObject({ catalog: CrewModelCatalogSchema }),
  z.strictObject({
    catalog: CrewModelCatalogSchema,
    agent: CrewAgentSchema,
    candidates: z.array(CrewInspectedCandidateSchema),
  }),
]);
export const CrewSchemaResultSchema = z.strictObject({
  version: z.literal(1),
  definition: CrewDefinitionTemplateSchema,
  capabilities: z.array(CrewCapabilitySchema),
  notes: text,
});

const project = { projectId: text };
const run = { ...project, runId: text };
const revision = { expectedUpdatedAt: z.number().optional() };
export const CrewsListParamsSchema = z.strictObject(project);
export const CrewsSchemaParamsSchema = z.strictObject(project);
export const CrewsInspectParamsSchema = z.strictObject({
  ...project,
  definitionId: text.optional(),
  memberId: text.optional(),
});
// The existing owner accepts either a structured object or explicit JSON text.
// Do not parse/canonicalize that text or alter the retained request fingerprint.
export const CrewsSaveParamsSchema = z.union([
  z.strictObject({
    ...project,
    definition: CrewDefinitionInputSchema,
    definitionJson: text.optional(),
    ...revision,
  }),
  z.strictObject({
    ...project,
    definition: CrewDefinitionInputSchema.optional(),
    definitionJson: text,
    ...revision,
  }),
]);
export const CrewsDeleteParamsSchema = z.strictObject({
  ...project,
  definitionId: text,
  ...revision,
});
export const CrewsDeleteRunParamsSchema = z.strictObject({
  ...run,
  expectedUpdatedAt: z.number(),
});
export const CrewsAgentSaveParamsSchema = z.union([
  z.strictObject({
    ...project,
    agent: CrewAgentInputSchema,
    agentJson: text.optional(),
    ...revision,
  }),
  z.strictObject({
    ...project,
    agent: CrewAgentInputSchema.optional(),
    agentJson: text,
    ...revision,
  }),
]);
export const CrewsAgentDeleteParamsSchema = z.strictObject({
  ...project,
  agentId: text,
});
export const CrewsStartParamsSchema = z.strictObject({
  ...project,
  definitionId: text,
  prompt: text,
  requestId: text,
  newConversation: z.boolean().optional(),
});
export const CrewsGetParamsSchema = z.strictObject(run);
export const CrewsAssignParamsSchema = z.strictObject({
  ...run,
  requestId: text,
  memberId: text,
  title: text,
  prompt: text,
  files: z.array(text).optional(),
  integration: z.boolean().optional(),
  required: z.array(CrewCapabilitySchema).optional(),
  dependsOn: z.array(text).optional(),
  verifyCommand: text.optional(),
});
export const CrewsRequestParamsSchema = z.strictObject({
  ...run,
  requestId: text,
  text,
});
export const CrewsResolveParamsSchema = z.strictObject({
  ...run,
  requestId: text,
});
const response = {
  ...run,
  sessionId: text,
  targetRunId: text.optional(),
  requestId: text,
};
export const CrewsRespondParamsSchema = z.strictObject({
  ...response,
  approvalId: SafeCounterSchema,
  approvalOccurrenceId: z.string().regex(WIRE_UUID_V4_PATTERN),
  decision: z.enum(["allow", "deny"]),
});
export const CrewsAnswerParamsSchema = z.strictObject({
  ...response,
  questionId: SafeCounterSchema,
  replyJson: text,
});
export const CrewsPauseParamsSchema = z.strictObject(run);
export const CrewsStopParamsSchema = z.strictObject(run);
export const CrewsResumeParamsSchema = z.strictObject(run);
export const CrewsAcceptParamsSchema = z.strictObject({ ...run, taskId: text });
export const CrewsFinishParamsSchema = z.strictObject(run);

const deleted = z.strictObject({ deleted: z.literal(true) });
export const CrewsListResultSchema = CrewDirectorySchema;
export const CrewsSchemaResultSchema = CrewSchemaResultSchema;
export const CrewsInspectResultSchema = CrewInspectResultSchema;
export const CrewsSaveResultSchema = CrewDefinitionSchema;
export const CrewsDeleteResultSchema = deleted;
export const CrewsDeleteRunResultSchema = deleted;
export const CrewsAgentSaveResultSchema = SavedCrewAgentSchema;
export const CrewsAgentDeleteResultSchema = deleted;
export const CrewsStartResultSchema = CrewRunSchema;
export const CrewsGetResultSchema = CrewRunDetailSchema;
export const CrewsAssignResultSchema = CrewAssignmentSchema;
export const CrewsRequestResultSchema = CrewMessageSchema;
export const CrewsResolveResultSchema = CrewMessageSchema;
export const CrewsRespondResultSchema = CommandReceiptSchema;
export const CrewsAnswerResultSchema = CommandReceiptSchema;
export const CrewsPauseResultSchema = CrewRunSchema;
export const CrewsStopResultSchema = CrewRunSchema;
export const CrewsResumeResultSchema = CrewRunSchema;
export const CrewsAcceptResultSchema = HostTaskSchema;
export const CrewsFinishResultSchema = CrewRunSchema;

/** Schema inventory only; no method registration, authority or dispatch. */
export const CREWS_RPC_SCHEMAS = {
  "crews.list": {
    params: CrewsListParamsSchema,
    result: CrewsListResultSchema,
  },
  "crews.schema": {
    params: CrewsSchemaParamsSchema,
    result: CrewsSchemaResultSchema,
  },
  "crews.inspect": {
    params: CrewsInspectParamsSchema,
    result: CrewsInspectResultSchema,
  },
  "crews.save": {
    params: CrewsSaveParamsSchema,
    result: CrewsSaveResultSchema,
  },
  "crews.delete": {
    params: CrewsDeleteParamsSchema,
    result: CrewsDeleteResultSchema,
  },
  "crews.deleteRun": {
    params: CrewsDeleteRunParamsSchema,
    result: CrewsDeleteRunResultSchema,
  },
  "crews.agent.save": {
    params: CrewsAgentSaveParamsSchema,
    result: CrewsAgentSaveResultSchema,
  },
  "crews.agent.delete": {
    params: CrewsAgentDeleteParamsSchema,
    result: CrewsAgentDeleteResultSchema,
  },
  "crews.start": {
    params: CrewsStartParamsSchema,
    result: CrewsStartResultSchema,
  },
  "crews.get": { params: CrewsGetParamsSchema, result: CrewsGetResultSchema },
  "crews.assign": {
    params: CrewsAssignParamsSchema,
    result: CrewsAssignResultSchema,
  },
  "crews.request": {
    params: CrewsRequestParamsSchema,
    result: CrewsRequestResultSchema,
  },
  "crews.resolve": {
    params: CrewsResolveParamsSchema,
    result: CrewsResolveResultSchema,
  },
  "crews.respond": {
    params: CrewsRespondParamsSchema,
    result: CrewsRespondResultSchema,
  },
  "crews.answer": {
    params: CrewsAnswerParamsSchema,
    result: CrewsAnswerResultSchema,
  },
  "crews.pause": {
    params: CrewsPauseParamsSchema,
    result: CrewsPauseResultSchema,
  },
  "crews.stop": {
    params: CrewsStopParamsSchema,
    result: CrewsStopResultSchema,
  },
  "crews.resume": {
    params: CrewsResumeParamsSchema,
    result: CrewsResumeResultSchema,
  },
  "crews.accept": {
    params: CrewsAcceptParamsSchema,
    result: CrewsAcceptResultSchema,
  },
  "crews.finish": {
    params: CrewsFinishParamsSchema,
    result: CrewsFinishResultSchema,
  },
} as const;
export type CrewRun = z.infer<typeof CrewRunSchema>;
export type CrewRunView = z.infer<typeof CrewRunViewSchema>;
export type CrewRunDetail = z.infer<typeof CrewRunDetailSchema>;
export type CrewDefinition = z.infer<typeof CrewDefinitionSchema>;
export type CrewCandidate = z.infer<typeof CrewCandidateSchema>;
export type CrewAgent = z.infer<typeof CrewAgentSchema>;
export type SavedCrewAgent = z.infer<typeof SavedCrewAgentSchema>;
