import type { SocialPolicies, SocialPolicy } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { writeScope, type PolicyScope } from "./policyScope";

/**
 * Saves one scope of the social policies through the reviewed path: the Host refuses the save when
 * the policies changed since `current` was read, so a concurrent edit is never overwritten.
 */
export function savePolicyScope(
  client: SocialClient,
  current: SocialPolicies,
  scope: PolicyScope,
  next: SocialPolicy,
): Promise<SocialPolicies> {
  return client.request<SocialPolicies>("policy.saveReviewed", {
    policies: writeScope(current, scope, next),
    expectedPolicies: current,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
}
