import type { SocialAccount, SocialPlatform } from "../../features/social/model/social";
import { SOCIAL_API_ACCOUNT_TYPES } from "../../features/social/model/social";
import { browserOperations, X_BROWSER_OPERATIONS } from "./browserCapabilities";
import {
  CAPABILITY_OPERATIONS,
  NOT_YET,
  NOT_YET_OPERATIONS,
  SOCIAL_DOCUMENTS,
  type CapabilityOperation,
  type CapabilityRequirement,
  type OperationRequirements,
  type PlatformCapabilities,
  type SocialCapability,
} from "./capabilities/shared";
import { facebookCapabilities } from "./capabilities/facebook";
import { instagramCapabilities } from "./capabilities/instagram";
import { linkedinCapabilities } from "./capabilities/linkedin";
import { redditCapabilities } from "./capabilities/reddit";
import { snapchatCapabilities } from "./capabilities/snapchat";
import { telegramCapabilities } from "./capabilities/telegram";
import { tiktokCapabilities } from "./capabilities/tiktok";
import { whatsappCapabilities } from "./capabilities/whatsapp";
import { X_BROWSER_SCOPES, xCapabilities } from "./capabilities/x";
import { youtubeCapabilities } from "./capabilities/youtube";

export { SOCIAL_DOCUMENTS, X_BROWSER_OPERATIONS, X_BROWSER_SCOPES };
export type { CapabilityOperation, CapabilityRequirement, OperationRequirements, SocialCapability };

const PLATFORM_TABLES: Record<
  SocialPlatform,
  (type: SocialAccount["accountType"]) => PlatformCapabilities
> = {
  x: xCapabilities,
  instagram: instagramCapabilities,
  facebook: facebookCapabilities,
  linkedin: linkedinCapabilities,
  youtube: youtubeCapabilities,
  tiktok: tiktokCapabilities,
  snapchat: snapchatCapabilities,
  whatsapp: whatsappCapabilities,
  telegram: telegramCapabilities,
  reddit: redditCapabilities,
};

const MIXED_INBOX_PLATFORMS: readonly SocialPlatform[] = ["x", "instagram", "facebook"];
const BROWSER_READ_OPERATIONS: readonly CapabilityOperation[] = [
  "poll",
  "inbox.read",
  "comments.read",
];
const BROWSER_READ_REASON =
  "Bounded visible web snapshots only. The sender identity and recognized layout must be verified; missing data is reported as unavailable rather than an empty inbox.";
const BROWSER_ACTION_REASON =
  "Uses the connected web account and the existing approval queue. Identity, recipient and persisted platform acknowledgement are required; uncertain outcomes are held for review.";
const BROWSER_NO_RECIPE =
  "No automated browser adapter is enabled for this platform/operation. Owner-assisted navigation is available separately.";
const X_BROWSER_NO_RECIPE =
  "No automated browser adapter is enabled for this X operation. Encrypted Chat and arbitrary discovery are unavailable.";

const isNotYet = (operation: CapabilityOperation): boolean =>
  (NOT_YET_OPERATIONS as readonly string[]).includes(operation);

/** Selecting polling requests both read products. Existing grants may enable either channel independently. */
export function platformRequirements(
  platform: SocialPlatform,
  type: SocialAccount["accountType"],
): OperationRequirements {
  const requirements: OperationRequirements = { ...PLATFORM_TABLES[platform](type).api };
  if (MIXED_INBOX_PLATFORMS.includes(platform)) {
    requirements.poll = {
      ...requirements.poll,
      scopes: [
        ...new Set(
          [requirements["comments.read"], requirements["inbox.read"]].flatMap(
            (item) => item.scopes,
          ),
        ),
      ],
      reason:
        "Read permitted comments and/or private messages. Each channel requires its own API permissions; unavailable channels are skipped.",
    };
  }
  return requirements;
}

/**
 * Browser capability comes from the recipe operations and the connection state only. Stored
 * pseudo-scopes are not consulted, so older browser accounts never show API scope names.
 */
function browserCapabilities(account: SocialAccount, now: number): SocialCapability[] {
  const supported = browserOperations(account) as readonly string[];
  const notes = PLATFORM_TABLES[account.platform](account.accountType).browser;
  const source = SOCIAL_DOCUMENTS[account.platform];
  const expired = account.expiresAt !== undefined && account.expiresAt <= now;
  return CAPABILITY_OPERATIONS.map((operation): SocialCapability => {
    const row = { operation, scopes: [] as string[], source };
    if (isNotYet(operation) && !supported.includes(operation))
      return {
        ...row,
        status: "unsupported",
        reason: NOT_YET[operation as keyof typeof NOT_YET].reason,
        reasonCode: "unsupported.not_yet",
      };
    if (!supported.includes(operation))
      return {
        ...row,
        status: "unsupported",
        reason: account.platform === "x" ? X_BROWSER_NO_RECIPE : BROWSER_NO_RECIPE,
        reasonCode: "browser.no_recipe",
      };
    if (expired)
      return {
        ...row,
        status: "expired",
        reason: "The browser session expired. Sign in again and verify its saved identity.",
        reasonCode: "browser.session_expired",
      };
    if (!account.connected || !account.accessApproved)
      return {
        ...row,
        status: "pending",
        reason: "Sign in and verify this account's isolated browser session on its executor host.",
        reasonCode: "browser.reconnect",
      };
    return {
      ...row,
      status: "available",
      reason:
        notes[operation as keyof typeof notes] ??
        (BROWSER_READ_OPERATIONS.includes(operation) ? BROWSER_READ_REASON : BROWSER_ACTION_REASON),
      reasonCode: "browser.ready",
    };
  });
}

function apiCapabilities(account: SocialAccount, now: number): SocialCapability[] {
  const requirements = platformRequirements(account.platform, account.accountType);
  const apiType = (SOCIAL_API_ACCOUNT_TYPES[account.platform] as readonly string[]).includes(
    account.accountType,
  );
  const expired = account.expiresAt !== undefined && account.expiresAt <= now;
  return CAPABILITY_OPERATIONS.map((operation): SocialCapability => {
    const requirement: CapabilityRequirement = requirements[operation];
    let status: SocialCapability["status"] = "available";
    let reason = requirement.reason;
    let reasonCode = "api.ready";
    const missing =
      operation === "poll" && MIXED_INBOX_PLATFORMS.includes(account.platform)
        ? ![requirements["comments.read"], requirements["inbox.read"]].some(
            (read) =>
              !read.unsupported && read.scopes.every((scope) => account.scopes.includes(scope)),
          )
        : requirement.scopes.some((scope) => !account.scopes.includes(scope));
    if (isNotYet(operation) && requirement.unsupported) {
      status = "unsupported";
      reasonCode = "unsupported.not_yet";
    } else if (!apiType) {
      status = "unsupported";
      reason =
        "This account type uses a browser session. Choose the appropriate business, bot, professional or Page account for the official API.";
      reasonCode = "api.account_type_unsupported";
    } else if (requirement.unsupported) {
      status = "unsupported";
      reasonCode = requirement.reasonCode ?? "unsupported.platform";
    } else if (expired) {
      status = "expired";
      reason = "OAuth token expired. Reconnect this account.";
      reasonCode = "api.token_expired";
    } else if (!account.connected || !account.accessApproved || missing) {
      status = "pending";
      reason = `Waiting for OAuth scopes/API access: ${requirement.scopes.join(", ") || "platform subscription"}. ${reason}`;
      reasonCode = `${account.platform}.${operation}.api_required`;
    }
    if (
      account.platform === "linkedin" &&
      operation === "media" &&
      account.accountType === "member"
    ) {
      status = "unsupported";
      reason =
        "This adapter supports one to four organization images. Member write-only tokens cannot verify Images API readiness; video is not implemented.";
      reasonCode = "unsupported.platform";
    }
    if (account.platform === "x" && operation === "webhook") {
      status = "pending";
      reason =
        "Account Activity webhook product/subscription must be configured separately; use permitted polling.";
      reasonCode = "x.webhook.external_setup";
    }
    if (account.platform === "x" && operation === "search") {
      status = "unsupported";
      reason =
        "Search exists in approved X API products, but external discovery is not implemented by this adapter. Local contacts.search is available.";
      reasonCode = "unsupported.platform";
    }
    if (["instagram", "facebook"].includes(account.platform) && operation === "webhook") {
      status = "pending";
      reason =
        "A signed receiver is implemented. App callback verification, review and account subscription still need external configuration; use permitted polling.";
      reasonCode = `${account.platform}.webhook.external_setup`;
    }
    return {
      operation,
      status,
      reason,
      reasonCode,
      scopes: requirement.scopes,
      source: SOCIAL_DOCUMENTS[account.platform],
    };
  });
}

export function accountCapabilities(account: SocialAccount, now = Date.now()): SocialCapability[] {
  return account.connection === "browser"
    ? browserCapabilities(account, now)
    : apiCapabilities(account, now);
}
