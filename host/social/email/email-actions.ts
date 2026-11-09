import { randomUUID } from "node:crypto";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, finite, str, url } from "../core/social-helpers";
import { readAutonomyPolicy, policyDay } from "../autonomy/autonomy-policy";
import { withinWorkingHours } from "../../../src/features/social/model/autonomy";
import type { SecretValueStore } from "../../secrets/secret-store";
import { pageInput } from "../outreach/outreach-input";
import { isEmailAddress } from "./email-message";
import { assertSendingAllowed, recordOutboundEmail, sendEmailToPerson } from "./email-dispatch";
import { parseEmailSecret, verifyEmailAccount } from "./email-sender";
import { emailSecretRef, readEmailSecret } from "./email-secrets";

const EMAIL_KINDS: readonly EmailAccount["kind"][] = ["smtp", "resend", "postmark"];

/** Email credentials live in the host vault. The host passes it as `emailSecrets` (see email-secrets.ts). */
function emailSecretStore(ctx: SocialActionContext): SecretValueStore {
  const secrets = (ctx as SocialActionContext & { emailSecrets?: SecretValueStore }).emailSecrets;
  if (!secrets) throw new Error("Email credentials are not available on this host.");
  return secrets;
}

function optionalEmailSecrets(ctx: SocialActionContext): SecretValueStore | undefined {
  return (ctx as SocialActionContext & { emailSecrets?: SecretValueStore }).emailSecrets;
}

async function requireEmailAccount(ctx: SocialActionContext, id: string): Promise<EmailAccount> {
  const account = await ctx.store.getRecord("email-account", id);
  if (!account) throw new Error("Email account not found.");
  return account;
}

export const emailActions: SocialActionModule = {
  "email.accounts.list": {
    readOnly: true,
    ownerOnly: false,
    run: async (ctx, input) => {
      exact(input, ["cursor", "limit"]);
      return await ctx.store.listRecords("email-account", pageInput(input));
    },
  },
  "email.accounts.save": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, [
        "id",
        "kind",
        "from",
        "name",
        "host",
        "port",
        "secure",
        "unsubscribeUrl",
        "secret",
      ]);
      const existing =
        input.id === undefined
          ? undefined
          : await requireEmailAccount(ctx, str(input.id, "email account", 200));
      if (!EMAIL_KINDS.includes(input.kind as EmailAccount["kind"]))
        throw new Error("Invalid email provider.");
      const kind = input.kind as EmailAccount["kind"];
      const from = str(input.from, "sender address", 254);
      if (!isEmailAddress(from)) throw new Error("Invalid sender address.");
      const name = str(input.name, "name", 120);
      // The unsubscribe link is mandatory: every outbound email carries it.
      const unsubscribeUrl = url(input.unsubscribeUrl, "unsubscribe link");
      const smtp = kind === "smtp";
      if (
        !smtp &&
        (input.host !== undefined || input.port !== undefined || input.secure !== undefined)
      )
        throw new Error("Host, port and secure apply to SMTP only.");
      if (input.secure !== undefined && typeof input.secure !== "boolean")
        throw new Error("Invalid secure flag.");
      const host = smtp ? str(input.host, "SMTP host", 253) : undefined;
      const port = smtp ? finite(input.port, "SMTP port", 1, 65535) : undefined;
      const secure = smtp && typeof input.secure === "boolean" ? input.secure : undefined;
      const id = existing?.id ?? randomUUID();
      if (input.secret !== undefined) {
        const secrets = emailSecretStore(ctx);
        const value = str(input.secret, "secret", 1000);
        // SMTP logs in as the sender address with the secret as password; HTTP providers take it as the API key.
        const raw = smtp ? { user: from, pass: value } : { apiKey: value };
        await secrets.set(
          emailSecretRef(id),
          JSON.stringify(parseEmailSecret(kind, JSON.stringify(raw))),
        );
      } else if (!existing || existing.kind !== kind || (smtp && existing.from !== from)) {
        throw new Error(
          "Enter the provider secret again: it is needed for a new provider or sender address.",
        );
      }
      const account: EmailAccount = {
        id,
        kind,
        from,
        name,
        ...(host !== undefined ? { host } : {}),
        ...(port !== undefined ? { port } : {}),
        ...(secure !== undefined ? { secure } : {}),
        unsubscribeUrl,
        createdAt: existing?.createdAt ?? ctx.now(),
      };
      return await ctx.store.putRecord("email-account", id, account);
    },
  },
  "email.accounts.remove": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      exact(input, ["accountId"]);
      const id = str(input.accountId, "email account", 200);
      const secrets = emailSecretStore(ctx);
      const removed = await ctx.store.deleteRecord("email-account", id);
      if (removed) await secrets.delete(emailSecretRef(id));
      return { removed };
    },
  },
  "email.accounts.test": {
    readOnly: false,
    ownerOnly: false,
    run: async (ctx, input) => {
      exact(input, ["accountId"]);
      const account = await requireEmailAccount(ctx, str(input.accountId, "email account", 200));
      await verifyEmailAccount(account, await readEmailSecret(optionalEmailSecrets(ctx), account));
      return { ok: true };
    },
  },
  "email.send": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    autonomy: "email",
    run: async (ctx, input) => {
      exact(input, ["emailAccountId", "personId", "subject", "body"]);
      const account = await requireEmailAccount(
        ctx,
        str(input.emailAccountId, "email account", 200),
      );
      const personId = str(input.personId, "person", 200);
      const subject = str(input.subject, "subject", 200);
      const body = str(input.body, "body", 20000);
      await assertSendingAllowed((key) => ctx.service.setting(key));
      const at = ctx.now();
      const aiCaller = ctx.principal.kind !== "owner";
      if (aiCaller) {
        const decision = await ctx.service.authorizeAutonomous({
          accountId: account.id,
          action: "email",
          principal: ctx.principal,
        });
        if (decision.mode !== "autonomous")
          throw new Error("Autonomous email is not enabled for this account.");
        const policy = await readAutonomyPolicy(ctx.store, account.id);
        if (!withinWorkingHours(policy, at))
          throw new Error("Outside the working hours of this account.");
      }
      const person = await ctx.store.getPerson(personId);
      if (!person) throw new Error("Person not found.");
      const result = await sendEmailToPerson({
        account,
        person,
        secrets: optionalEmailSecrets(ctx),
        subject,
        body,
        assertSendable: (target, channel) => ctx.service.assertSendable(target, channel),
      });
      if (aiCaller)
        await ctx.store.incrementCounter(
          account.id,
          "email",
          policyDay(await readAutonomyPolicy(ctx.store, account.id), at),
        );
      await recordOutboundEmail(ctx.store, person, account.id, subject, at, randomUUID());
      return { sent: true, messageId: result.messageId };
    },
  },
};
