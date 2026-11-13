import { hasControlCharacters } from "../../../shared/lib/controlCharacters";
export { socialCharacterCount, socialLimit } from "./socialLimits";
import { isRemoteProvider } from "../../connections/model/protocol";
import {
  SOCIAL_PLATFORMS,
  type SocialAgent,
  type SocialPolicies,
  type SocialPolicy,
  type SocialPlatform,
} from "./social";
export const SOCIAL_LIMIT_FIELDS = [
  "maxContentCharacters",
  "maxCommentCharacters",
  "maxMessageCharacters",
] as const;
export const DEFAULT_SOCIAL_POLICIES: SocialPolicies = {
  global: {},
  platforms: {},
};
export function parseSocialAgent(raw: unknown): SocialAgent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a valid AI agent.");
  const agent = raw as Record<string, unknown>;
  if (
    Object.keys(agent).some(
      (key) => !["provider", "model", "providerAccountId", "modelSettings"].includes(key),
    ) ||
    !isRemoteProvider(agent.provider)
  )
    throw new Error("Unsupported social AI agent.");
  if (
    agent.model !== undefined &&
    (typeof agent.model !== "string" ||
      agent.model.length > 200 ||
      hasControlCharacters(agent.model, false))
  )
    throw new Error("Invalid social AI model.");
  if (
    agent.providerAccountId !== undefined &&
    (typeof agent.providerAccountId !== "string" ||
      !agent.providerAccountId.trim() ||
      agent.providerAccountId.length > 512 ||
      hasControlCharacters(agent.providerAccountId, false))
  )
    throw new Error("Invalid social AI account.");
  const settings = agent.modelSettings;
  if (
    settings !== undefined &&
    (!settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      Object.keys(settings).length > 20 ||
      Object.entries(settings).some(
        ([key, value]) =>
          !key ||
          key.length > 64 ||
          hasControlCharacters(key, false) ||
          typeof value !== "string" ||
          value.length > 128 ||
          hasControlCharacters(value, false),
      ))
  )
    throw new Error("Invalid social AI model settings.");
  return {
    provider: agent.provider,
    ...(typeof agent.model === "string" && agent.model.trim() ? { model: agent.model.trim() } : {}),
    ...(typeof agent.providerAccountId === "string"
      ? { providerAccountId: agent.providerAccountId.trim() }
      : {}),
    ...(settings ? { modelSettings: { ...(settings as Record<string, string>) } } : {}),
  };
}
function parsePolicy(raw: unknown): SocialPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid social policy.");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["agent", ...SOCIAL_LIMIT_FIELDS].includes(key)))
    throw new Error("Unsupported social policy field.");
  const policy: SocialPolicy = {};
  if (value.agent !== undefined) policy.agent = parseSocialAgent(value.agent);
  for (const field of SOCIAL_LIMIT_FIELDS)
    if (value[field] !== undefined) {
      if (
        !Number.isSafeInteger(value[field]) ||
        Number(value[field]) < 1 ||
        Number(value[field]) > 20_000
      )
        throw new Error(
          "Character limits must be whole numbers between 1 and 20000; omit to inherit.",
        );
      policy[field] = Number(value[field]);
    }
  return policy;
}
export function parseSocialPolicies(raw: unknown): SocialPolicies {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid social policies.");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["global", "platforms"].includes(key)))
    throw new Error("Unsupported social settings.");
  if (!value.platforms || typeof value.platforms !== "object" || Array.isArray(value.platforms))
    throw new Error("Invalid platform overrides.");
  const platforms: SocialPolicies["platforms"] = {};
  for (const [platform, policy] of Object.entries(value.platforms)) {
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform))
      throw new Error("Unsupported social platform.");
    platforms[platform as SocialPlatform] = parsePolicy(policy);
  }
  return { global: parsePolicy(value.global), platforms };
}
/**
 * Precedence (B29): a rule's own agent beats the platform override, which beats the global value.
 * Unset keys inherit; a platform override never silently replaces a rule's agent.
 */
export function effectiveSocialPolicy(
  policies: SocialPolicies,
  platform: SocialPlatform,
  agent?: SocialAgent,
): SocialPolicy {
  return {
    ...policies.global,
    ...policies.platforms[platform],
    ...(agent ? { agent } : {}),
  };
}
