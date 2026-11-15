/** Public Social contract for owner-attention notifications; exports stay explicit to preserve load isolation. */
export { SOCIAL_PLATFORM_NAMES } from "../model/social";
export type { SocialAccount, SocialPlatform } from "../model/social";
export type { SocialAccountRequest } from "../model/accountRequests";
export type { NeedsHumanItem } from "../model/socialActions";
export { accountNeedsSignIn } from "../model/accountSignIn";
export { socialClient } from "../model/socialClient";
