import type { Suppression } from "../../../src/features/social/model/outreach";
import type { SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { suppress, unsuppress } from "../autonomy/suppression";
import { isEmailAddress } from "../email/email-message";
import { channelInput, optionalStr, pageInput, platformInput } from "./outreach-input";

/**
 * A platform handle: the object the client sends ({platform, platformId}) or the AI tool's
 * "<platform>:<platformId>" string.
 */
function parseHandle(
  value: unknown,
): { platform: ReturnType<typeof platformInput>; platformId: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return {
      platform: platformInput(object.platform),
      platformId: str(object.platformId, "platform ID", 200),
    };
  }
  const text = str(value, "handle", 300);
  const colon = text.indexOf(":");
  if (colon < 1) throw new Error("Handle must be platform:platformId.");
  return {
    platform: platformInput(text.slice(0, colon)),
    platformId: str(text.slice(colon + 1), "platform ID", 200),
  };
}

/** Reasons an owner or AI may record. "deleted" is written only by the person-deletion path. */
function suppressionReason(value: unknown): Suppression["reason"] {
  if (value === "manual" || value === "bounce" || value === "complaint" || value === "opt_out")
    return value;
  throw new Error("Invalid suppression reason.");
}

/** Suppressions block every channel or one channel for a person, a platform handle or an email. */
export const suppressionActions: SocialActionModule = {
  "suppressions.list": {
    readOnly: true,
    ownerOnly: false,
    run: async (ctx, input) => {
      exact(input, ["cursor", "limit"]);
      return await ctx.store.listSuppressions(pageInput(input));
    },
  },
  "suppressions.add": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["personId", "handle", "email", "channel", "reason"]);
      const personId = optionalStr(input.personId, "person", 200);
      if (personId !== undefined && !(await ctx.store.getPerson(personId)))
        throw new Error("Person not found.");
      const handle = parseHandle(input.handle);
      const email = optionalStr(input.email, "email", 254);
      if (email !== undefined && !isEmailAddress(email)) throw new Error("Invalid email address.");
      if (personId === undefined && handle === undefined && email === undefined)
        throw new Error("Name a person, a handle or an email.");
      const channel =
        input.channel === undefined || input.channel === "all"
          ? "all"
          : channelInput(input.channel);
      const reason = input.reason === undefined ? "manual" : suppressionReason(input.reason);
      return await suppress(
        { audience: ctx.store, now: ctx.now },
        {
          ...(personId !== undefined ? { personId } : {}),
          ...(handle !== undefined ? { handle } : {}),
          ...(email !== undefined ? { email } : {}),
          channel,
          reason,
          source: ctx.principal.actorId,
        },
      );
    },
  },
  "suppressions.remove": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, ["suppressionId"]);
      return {
        removed: await unsuppress(
          { audience: ctx.store },
          str(input.suppressionId, "suppression", 200),
        ),
      };
    },
  },
};
