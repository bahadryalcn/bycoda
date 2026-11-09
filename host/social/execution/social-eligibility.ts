import type {
  SocialAccount,
  SocialContact,
  SocialJob,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialServiceInternals } from "../core/social-internals";
import { UNASSIGNED_REVIEW } from "../core/social-helpers";

/** Send-time eligibility for one contact, thread and job kind. Throws the owner-visible reason. */
export function checkEligibility(
  s: SocialServiceInternals,
  account: SocialAccount,
  contact: SocialContact,
  kind: SocialJob["kind"],
  thread?: SocialThread,
  allowPersonal = false,
): void {
  if (contact.optedOut) throw new Error("Contact opted out. Pending outreach is stopped.");
  // Consent is recorded data only (owner decision D2): it never blocks a send. Opt-out and
  // suppression are enforced by assertSendable at the send and execution gates.
  if (kind === "message") s.capability(account, "message.start");
  if (kind === "reply") {
    if (thread?.replyAllowed === false)
      throw new Error("Platform does not permit replies to this comment thread.");
    if (
      !thread ||
      (!thread.projectId && !allowPersonal) ||
      (thread.reviewReason && !(allowPersonal && thread.reviewReason === UNASSIGNED_REVIEW)) ||
      !contact.replyEligible
    )
      throw new Error("Reply requires an eligible, assigned conversation.");
    s.capability(account, thread.kind === "message" ? "message.reply" : "reply");
    if (
      thread.kind === "message" &&
      account.connection !== "browser" &&
      (account.platform === "instagram" ||
        account.platform === "facebook" ||
        account.platform === "whatsapp") &&
      (!thread.replyUntil || thread.replyUntil <= s.now())
    )
      throw new Error("Platform response window expired.");
  }
  if (kind === "comment") {
    if (!contact.commentEligible) throw new Error("Comment eligibility is not established.");
    s.capability(account, "comment");
  }
}
