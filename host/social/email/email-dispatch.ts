import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { EmailAccount, OutreachChannel } from "../../../src/features/social/model/outreach";
import type { SendTarget } from "../autonomy/suppression";
import type { SecretValueStore } from "../../secrets/secret-store";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { buildOutreachEmail, emailAddressFor } from "./email-message";
import { deliverEmail } from "./email-sender";
import { readEmailSecret } from "./email-secrets";
import type { EmailDeps, EmailSendResult } from "./email-types";

/** Global stops for every external send, including owner-initiated email. */
export async function assertSendingAllowed(
  setting: (key: string) => Promise<string | undefined>,
): Promise<void> {
  if ((await setting("stopped")) === "true") throw new Error("Social sending is stopped.");
  if ((await setting("sending")) !== "true")
    throw new Error("External sending is off. Turn it on before sending.");
}

/**
 * Sends one email to one person. Order: IYS refusal, suppression (second check, the caller
 * checks first), message build (unsubscribe required), then delivery. Nothing is sent before
 * the suppression check passes.
 */
export async function sendEmailToPerson(input: {
  account: EmailAccount;
  person: SocialPerson;
  secrets: SecretValueStore | undefined;
  subject: string;
  body: string;
  idempotencyKey?: string;
  deps?: EmailDeps;
  assertSendable: (target: SendTarget, channel: OutreachChannel) => Promise<void>;
}): Promise<EmailSendResult> {
  if (input.person.commercialConsent?.iys === "rejected")
    throw new Error("Recipient refused commercial messages (IYS).");
  const address = emailAddressFor(input.person);
  if (!address) throw new Error("Person has no email address.");
  await input.assertSendable({ personId: input.person.id, email: address }, "email");
  const message = buildOutreachEmail(
    input.account,
    address,
    input.subject,
    input.body,
    input.idempotencyKey,
  );
  const secret = await readEmailSecret(input.secrets, input.account);
  return await deliverEmail(input.account, secret, message, input.deps);
}

/** Interaction and stage update after an email left the Host. Only a new person moves to "contacted". */
export async function recordOutboundEmail(
  store: SocialAudienceStore,
  person: SocialPerson,
  accountId: string,
  subject: string,
  at: number,
  id: string,
): Promise<void> {
  await store.addInteraction({
    id,
    personId: person.id,
    accountId,
    platform: "email",
    kind: "email",
    direction: "outbound",
    text: subject.slice(0, 200),
    at,
  });
  if (person.stage === "new")
    await store.putPerson({ ...person, stage: "contacted", updatedAt: at });
}
