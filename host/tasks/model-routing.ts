import {
  ModelRoutingItemChoiceSchema,
  type ModelRoutingItemChoice,
  type ModelRoutingRole,
  type ModelRoutingTarget,
} from "../../src/shared/model/host-contracts/model-routing";
import { hostModelRoutingService } from "../model-routing/runtime";
import { resolveModelChoice } from "../model-routing/service";
import type { HostStore } from "../store";

export type RoutedRun = {
  modelChoice?: ModelRoutingItemChoice;
  modelRoutingWait?: { reason: string; retryAt?: number };
  reviewerTarget?: ModelRoutingTarget;
  plannerTarget?: ModelRoutingTarget;
  finalReviewTarget?: ModelRoutingTarget;
};

/** Runtime additions remain separate from the owner's editable model configuration. */
export function routingRun(item: object): RoutedRun {
  return item as RoutedRun;
}

/** Preserve routing through semantic parsers, including conflict comparisons. */
export function routingInput<T>(
  parse: (raw: unknown) => T,
  raw: unknown,
): T & Pick<RoutedRun, "modelChoice"> {
  const parsed = parse(raw);
  const choice = ModelRoutingItemChoiceSchema.optional().parse((raw as RoutedRun).modelChoice);
  return { ...parsed, modelChoice: choice };
}

export function isFixedRouting(item: object): boolean {
  const choice = routingRun(item).modelChoice;
  return !choice || choice.kind === "fixed";
}

export async function resolveRunModel(
  store: HostStore,
  role: ModelRoutingRole,
  item: ModelRoutingTarget,
  choice: ModelRoutingItemChoice | undefined = routingRun(item).modelChoice,
) {
  return resolveModelChoice(hostModelRoutingService(store), {
    role,
    choice,
    fixed: modelTarget(item),
  });
}

export function modelTarget(item: ModelRoutingTarget): ModelRoutingTarget {
  const { harness, providerAccountId, model, modelSettings } = item;
  return { harness, providerAccountId, model, modelSettings };
}

export function reviewerModelInput(
  task: ModelRoutingTarget & {
    reviewerConfig?: {
      harness: ModelRoutingTarget["harness"];
      providerAccountId?: string;
      model: string;
      modelSettings: Record<string, string>;
    };
  },
) {
  const reviewer = task.reviewerConfig;
  return {
    target: reviewer
      ? {
          harness: reviewer.harness,
          providerAccountId:
            reviewer.providerAccountId ??
            (reviewer.harness === task.harness ? task.providerAccountId : undefined),
          model: reviewer.model,
          modelSettings: reviewer.modelSettings,
        }
      : modelTarget(task),
    choice:
      reviewer || isFixedRouting(task) ? { kind: "fixed" as const } : { kind: "default" as const },
  };
}

export const MODEL_ROUTING_WAIT =
  "Waiting for model routing: no eligible entry. Limits or account availability must recover.";

export function routingWait(resolution: { nextResetAt?: number }) {
  return { reason: MODEL_ROUTING_WAIT, retryAt: resolution.nextResetAt };
}

export function routingWaitDue(item: object, now: number): boolean {
  const retryAt = routingRun(item).modelRoutingWait?.retryAt;
  return retryAt === undefined || now >= retryAt;
}
