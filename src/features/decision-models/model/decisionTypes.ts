import type { z } from "zod";
import {
  DecisionCatalogEntrySchema,
  DecisionDiscoverySettingsSchema,
  DecisionLocalPlanSchema,
  DecisionRoutingSchema,
  DecisionSourceInputSchema,
  DecisionSourceKindSchema,
  DecisionSourceSchema,
  DecisionSourceTestSchema,
  DecisionEvaluationSchema,
  DiscoveryCandidateSchema,
  HardwareInfoSchema,
  LocalRecommendationSchema,
  LocalStatusSchema,
  DECISION_TASK_TYPES,
} from "../../../shared/model/host-contracts/decision-models";

/** Wire shapes come from the shared Host contract; the UI names them here once. */
export type DecisionSource = z.output<typeof DecisionSourceSchema>;
export type DecisionSourceInput = z.output<typeof DecisionSourceInputSchema>;
export type DecisionSourceKind = z.output<typeof DecisionSourceKindSchema>;
export type DecisionRouting = z.output<typeof DecisionRoutingSchema>;
export type DecisionTaskType = (typeof DECISION_TASK_TYPES)[number];
export type DecisionRoute = NonNullable<DecisionRouting[DecisionTaskType]>;
export type DiscoveryCandidate = z.output<typeof DiscoveryCandidateSchema>;
export type DecisionCatalogEntry = z.output<typeof DecisionCatalogEntrySchema>;
export type HardwareInfo = z.output<typeof HardwareInfoSchema>;
export type LocalRecommendation = z.output<typeof LocalRecommendationSchema>;
export type LocalStatus = z.output<typeof LocalStatusSchema>;
export type LocalPlan = z.output<typeof DecisionLocalPlanSchema>;
export type DiscoverySettings = z.output<typeof DecisionDiscoverySettingsSchema>;
export type SourceTestResult = z.output<typeof DecisionSourceTestSchema>;
export type SourceEvaluation = z.output<typeof DecisionEvaluationSchema>;
