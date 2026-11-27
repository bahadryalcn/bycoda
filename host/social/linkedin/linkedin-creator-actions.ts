import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";

/** This preview identifies the provider's owner-operated entry point for native content. */
export const linkedinCreatorActions: SocialActionModule = {
  "linkedin.creator.handoff": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["accountId", "format"]);
      const { format } = input;
      if (format !== "article" && format !== "newsletter")
        throw new SocialPlatformError("unsupported");
      const account = await ctx.service.access(
        ctx.principal,
        str(input.accountId, "account"),
        "read",
      );
      if (!account.connected || !account.platformId || account.platform !== "linkedin")
        throw new SocialPlatformError("denied");
      if (account.accountType === "member")
        return { state: "needs_human", format, url: "https://www.linkedin.com/feed/" };
      const page =
        /^(?:web:linkedin:company:([\w-]{1,100})|urn:li:organization:([1-9][0-9]{0,24}))$/.exec(
          account.platformId,
        );
      if (account.accountType !== "organization" || !page)
        throw new SocialPlatformError("unsupported");
      return {
        state: "needs_human",
        format,
        url: `https://www.linkedin.com/company/${page[1] ?? page[2]}/admin/`,
      };
    },
  },
};
