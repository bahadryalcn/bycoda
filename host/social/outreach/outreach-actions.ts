import { emailActions } from "../email/email-actions";
import type { SocialActionModule } from "../core/social-actions";
import { sequenceActions } from "./outreach-sequence-actions";
import { suppressionActions } from "./outreach-suppression-actions";

/** Sequences, enrollments, suppressions and email accounts (Phase 4B). */
export const outreachActions: SocialActionModule = {
  ...sequenceActions,
  ...suppressionActions,
  ...emailActions,
};
