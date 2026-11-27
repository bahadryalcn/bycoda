import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { exact, hash, str } from "../core/social-helpers";
import type { SocialPrincipal, SocialService } from "../social";
import type { PlatformBrowserSessions } from "../social-browser-platforms";
import {
  parseLinkedInMemberProfileUpdate,
  readLinkedInMemberProfile,
  updateLinkedInMemberProfile,
  type LinkedInMemberProfileSection,
  type LinkedInMemberProfileUpdate,
} from "../social-browser-linkedin-member-profile";
import {
  LINKEDIN_PROFILE_OWNER_SECTIONS,
  linkedInProfileDestination,
  type LinkedInProfileOwnerSection,
} from "../social-browser-linkedin-services";
import {
  linkedInNetworkAction,
  linkedInReadNetwork,
  type LinkedInNetworkAction,
  type LinkedInNetworkList,
} from "../social-browser-linkedin-connections";
import {
  linkedInGroupAction,
  linkedInReadGroups,
  type LinkedInGroupAction,
} from "../social-browser-linkedin-groups";
import {
  linkedInPrepareArticle,
  parseLinkedInArticleDraft,
} from "../social-browser-linkedin-creator";

type LinkedInBrowserRead =
  | { operation: "member.read"; section: LinkedInMemberProfileSection }
  | { operation: "profile.destination"; section: LinkedInProfileOwnerSection }
  | { operation: "inbox.destination" }
  | { operation: "network.list"; kind: LinkedInNetworkList }
  | { operation: "groups.list" };

type LinkedInBrowserWrite = { requestId: string } & (
  | { operation: "member.update"; patch: LinkedInMemberProfileUpdate }
  | { operation: "article.prepare"; draft: ReturnType<typeof parseLinkedInArticleDraft> }
  | { operation: "network.write"; kind: LinkedInNetworkAction; targetId: string }
  | ({ operation: "groups.write" } & LinkedInGroupAction)
);

export type LinkedInBrowserManagement = { accountId: string } & (
  | LinkedInBrowserRead
  | LinkedInBrowserWrite
);

const confirmWrite = (input: Record<string, unknown>, fields: string[]) => {
  exact(input, ["accountId", "operation", "confirm", "requestId", ...fields]);
  if (
    input.confirm !== "CONFIRM_LINKEDIN_BROWSER_WRITE" ||
    typeof input.requestId !== "string" ||
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(input.requestId)
  )
    throw new SocialPlatformError("denied");
  return input.requestId;
};

export function parseLinkedInBrowserManagement(
  input: Record<string, unknown>,
): LinkedInBrowserManagement {
  const accountId = str(input.accountId, "account id", 300);
  const { operation, section, kind } = input;
  switch (operation) {
    case "member.read":
      exact(input, ["accountId", "operation", "section"]);
      if (section === "headline" || section === "about") return { accountId, operation, section };
      break;
    case "member.update": {
      const requestId = confirmWrite(input, ["patch"]);
      return {
        accountId,
        operation,
        requestId,
        patch: parseLinkedInMemberProfileUpdate(input.patch),
      };
    }
    case "article.prepare": {
      const requestId = confirmWrite(input, ["draft"]);
      return { accountId, operation, requestId, draft: parseLinkedInArticleDraft(input.draft) };
    }
    case "profile.destination": {
      exact(input, ["accountId", "operation", "section"]);
      const destination = LINKEDIN_PROFILE_OWNER_SECTIONS.find(
        (candidate) => candidate === section,
      );
      if (destination) return { accountId, operation, section: destination };
      break;
    }
    case "inbox.destination":
    case "groups.list":
      exact(input, ["accountId", "operation"]);
      return { accountId, operation };
    case "network.list":
      exact(input, ["accountId", "operation", "kind"]);
      if (kind === "connections" || kind === "invitations.received" || kind === "invitations.sent")
        return { accountId, operation, kind };
      break;
    case "network.write": {
      const requestId = confirmWrite(input, ["kind", "targetId"]);
      if (
        kind !== "invite" &&
        kind !== "accept" &&
        kind !== "ignore" &&
        kind !== "withdraw" &&
        kind !== "follow" &&
        kind !== "unfollow"
      )
        break;
      const targetId = str(input.targetId, "LinkedIn member id", 130);
      if (!/^web:linkedin:in:[a-z0-9_-]{1,100}$/.test(targetId))
        throw new SocialPlatformError("denied");
      return { accountId, operation, requestId, kind, targetId };
    }
    case "groups.write": {
      const requestId = confirmWrite(
        input,
        kind === "post" ? ["kind", "groupId", "text"] : ["kind", "groupId"],
      );
      const groupId = str(input.groupId, "LinkedIn group id", 50);
      if (!/^web:linkedin:group:[1-9]\d{0,19}$/.test(groupId))
        throw new SocialPlatformError("denied");
      if (kind === "join") return { accountId, operation, requestId, kind, groupId };
      if (kind === "post")
        return {
          accountId,
          operation,
          requestId,
          kind,
          groupId,
          text: str(input.text, "group post", 3000),
        };
      break;
    }
  }
  throw new SocialPlatformError("unsupported");
}

/** All mutations are owner-confirmed, serialized with the account session and journaled before dispatch. */
export async function runLinkedInBrowserManagement(
  service: SocialService,
  principal: SocialPrincipal,
  input: LinkedInBrowserManagement,
  platforms: Pick<PlatformBrowserSessions, "withLinkedInBrowser">,
  assertAvailable: () => void,
) {
  const { accountId } = input;
  const writing = "requestId" in input;
  const account = await service.accountForBrowserManagement(principal, accountId, writing);
  if (account.platform !== "linkedin" || !account.connected || account.paused)
    throw new SocialPlatformError("denied");
  if (input.operation === "profile.destination") {
    await service.store.db.checkAuthorization();
    return linkedInProfileDestination(account.platformId, input.section);
  }
  if (input.operation === "inbox.destination") {
    await service.store.db.checkAuthorization();
    if (account.accountType === "organization")
      return {
        url: linkedInProfileDestination(account.platformId, "details").url,
        requiresOwner: true as const,
      };
    if (account.accountType === "member")
      return { url: "https://www.linkedin.com/messaging/", requiresOwner: true as const };
    throw new SocialPlatformError("unsupported");
  }
  const outbound = input.operation === "network.write" || input.operation === "groups.write";
  const epoch = await service.connectionReviewEpoch(principal, accountId);
  const verify = async () => {
    assertAvailable();
    const current = await service.accountForBrowserManagement(principal, accountId, writing);
    if (
      current.platform !== "linkedin" ||
      current.connection !== "browser" ||
      current.accountType !== "member" ||
      current.platformId !== account.platformId ||
      !current.connected ||
      current.paused ||
      current.executorId !== service.store.environmentId ||
      (await service.connectionReviewEpoch(principal, accountId)) !== epoch ||
      (outbound && (await service.setting("sending")) !== "true")
    )
      throw new SocialPlatformError("denied");
    await service.store.db.checkAuthorization();
  };
  if (!writing) {
    return platforms.withLinkedInBrowser(account, verify, async (ctx) => {
      const result =
        input.operation === "member.read"
          ? await readLinkedInMemberProfile(ctx, input.section)
          : input.operation === "network.list"
            ? await linkedInReadNetwork(ctx, input.kind)
            : await linkedInReadGroups(ctx);
      await verify();
      return result;
    });
  }

  // IDs are one-shot per account across desktop reload and Host restart. A lost
  // acknowledgement requires inspection even when LinkedIn accepted the operation.
  const attempted =
    "linkedin.browser.attempt:" + hash(JSON.stringify([accountId, input.requestId]));
  return platforms.withLinkedInBrowser(account, verify, async (ctx, limiter) => {
    const rejectRepeat = async () => {
      if (await service.setting(attempted)) throw new SocialPlatformError("unknown");
    };
    await rejectRepeat();
    const beforeSubmit = async (targetId?: string) => {
      await verify();
      await rejectRepeat();
      if (targetId)
        await service.assertSendable(
          { platform: "linkedin", platformId: targetId },
          input.operation === "network.write" ? "dm" : "comment",
        );
      await service.setSetting(attempted, "submitted");
    };
    if (input.operation === "member.update")
      return updateLinkedInMemberProfile(ctx, input.patch, () => beforeSubmit());
    if (input.operation === "article.prepare")
      return linkedInPrepareArticle(ctx, input.draft, () => beforeSubmit());
    const gate = {
      reserve: (id: string) => limiter.reserve(id),
      record: (id: string) => limiter.record(id),
      beforeSubmit: async (id: string, targetId: string) => {
        const expected = input.operation === "network.write" ? input.targetId : input.groupId;
        if (id !== accountId || targetId !== expected) throw new SocialPlatformError("denied");
        await beforeSubmit(targetId);
      },
    };
    return input.operation === "network.write"
      ? linkedInNetworkAction(ctx, input, gate)
      : linkedInGroupAction(ctx, input, gate);
  });
}
