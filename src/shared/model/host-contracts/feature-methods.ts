import type { z } from "zod";
import { activityMethods } from "./activity";
import { decisionModelsMethods } from "./decision-models";
import type { HostRpcMethodDefinition } from "./methods";
import { secretsOwnerMethods } from "./secrets-owner";
import { sessionLifecycleMethods } from "./session-lifecycle";

/** Method inventories of feature contracts, composed once so `methods.ts` needs one entry. */
export function featureMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  return {
    ...decisionModelsMethods(workflow),
    ...activityMethods(workflow),
    ...secretsOwnerMethods(workflow),
    ...sessionLifecycleMethods(workflow),
  };
}
