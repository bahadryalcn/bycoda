/**
 * Reads and writes one scope of the social policies: the global policy or one platform override.
 * A platform override with no keys is removed, so the platform inherits global again.
 */
import { effectiveSocialPolicy } from "../../model/socialPolicy";
import type { SocialAgent, SocialPlatform, SocialPolicies, SocialPolicy } from "../../model/social";

export type PolicyScope = "global" | SocialPlatform;

/** The policy stored for a scope, without inheritance. Empty for a platform that inherits. */
export function readScope(policies: SocialPolicies, scope: PolicyScope): SocialPolicy {
  return scope === "global" ? policies.global : (policies.platforms[scope] ?? {});
}

/** The value that applies in a scope after inheritance. */
export function effectiveForScope(policies: SocialPolicies, scope: PolicyScope): SocialPolicy {
  return scope === "global" ? policies.global : effectiveSocialPolicy(policies, scope);
}

export function writeScope(
  policies: SocialPolicies,
  scope: PolicyScope,
  next: SocialPolicy,
): SocialPolicies {
  if (scope === "global") return { ...policies, global: next };
  const platforms: SocialPolicies["platforms"] = { ...policies.platforms };
  if (Object.keys(next).length) platforms[scope] = next;
  else delete platforms[scope];
  return { ...policies, platforms };
}

/** Agent of the scope as stored: undefined means "not set here" (inherits for a platform). */
export function scopeAgent(policies: SocialPolicies, scope: PolicyScope): SocialAgent | undefined {
  return readScope(policies, scope).agent;
}

/** The policy with its agent replaced, or removed when `agent` is undefined (inherit again). */
export function withAgent(policy: SocialPolicy, agent: SocialAgent | undefined): SocialPolicy {
  const { agent: _previous, ...rest } = policy;
  return agent ? { ...rest, agent } : rest;
}
