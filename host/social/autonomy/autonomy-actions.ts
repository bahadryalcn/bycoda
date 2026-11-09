import { str, exact } from "../core/social-helpers";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import {
  hasAutonomousLevel,
  parseAutonomyInput,
  readAutonomyPolicy,
  saveAutonomyPolicy,
} from "./autonomy-policy";

/**
 * Who may touch a policy. An email account (keyed by its own id, see email/email-actions.ts) has no
 * social grants; only the owner reads or writes it. Social accounts use the account checks.
 */
async function checkPolicyAccount(ctx: SocialActionContext, accountId: string, read: boolean) {
  if (await ctx.store.getRecord("email-account", accountId))
    return ctx.service.owner(ctx.principal);
  if (read) return await ctx.service.access(ctx.principal, accountId, "read");
  await ctx.service.account(accountId);
}

/** Per-account autonomy policy: read for any principal with account read, write owner-only. */
export const autonomyActions: SocialActionModule = {
  "autonomy.get": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["accountId"]);
      const accountId = str(input.accountId, "account");
      await checkPolicyAccount(ctx, accountId, true);
      return await readAutonomyPolicy(ctx.store, accountId);
    },
  },
  "autonomy.set": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, ["accountId", "policy", "confirm"]);
      const accountId = str(input.accountId, "account");
      await checkPolicyAccount(ctx, accountId, false);
      const current = await readAutonomyPolicy(ctx.store, accountId);
      const patch = parseAutonomyInput(input.policy, current);
      if (
        hasAutonomousLevel({ ...current, levels: patch.levels }) &&
        input.confirm !== "ENABLE_AUTONOMY"
      )
        throw new Error("Explicit confirmation ENABLE_AUTONOMY is required for autonomous levels.");
      return await saveAutonomyPolicy(
        ctx.store,
        accountId,
        patch,
        ctx.principal.actorId,
        ctx.now(),
      );
    },
  },
};
