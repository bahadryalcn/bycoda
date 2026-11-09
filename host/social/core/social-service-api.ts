import type { AiAction, AutonomyAction } from "../../../src/features/social/model/autonomy";
import type { OutreachChannel } from "../../../src/features/social/model/outreach";
import type {
  SocialAccount,
  SocialAudit,
  SocialContact,
  SocialDraft,
  SocialJob,
  SocialOperation,
  SocialPermission,
  SocialPolicy,
  SocialRule,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialAdapter, SocialInbound } from "../../../src/integrations/social/adapter";
import type { AutonomyDecision } from "../autonomy/autonomy-gate";
import type { SendTarget } from "../autonomy/suppression";
import type { SocialPrincipal } from "../social";
import type { SocialCredential } from "../social-credentials";
import type { SocialTextGenerator } from "../social-generation";

/** A send without a draft asks the autonomy gate for its decision (see autonomy-gate.ts). */
export type AutonomousRequest = {
  accountId: string;
  action: AutonomyAction;
  principal: SocialPrincipal;
};

/**
 * Narrow Host surface for Social action modules. SocialService implements it with the
 * same signatures and behavior as its methods; new modules must not reach past it.
 * sendDraft applies the autonomy and suppression gates itself (P3-3); optOut suppresses the person.
 */
export interface SocialServiceApi {
  account(id: string): Promise<SocialAccount>;
  /** The stored contact, or undefined. Carries no principal: callers check access themselves. */
  contact(id: string): Promise<SocialContact | undefined>;
  /** The stored thread, or undefined. Carries no principal: callers check access themselves. */
  thread(id: string): Promise<SocialThread | undefined>;
  /** Runs any registered or built-in operation through the same gates as the UI and AI tools. */
  call(
    principal: SocialPrincipal,
    method: string,
    input: Record<string, unknown>,
    requestId?: string,
  ): Promise<unknown>;
  /** The effective policy (agent, limits) for an account, optionally with a rule override. */
  policy(account: SocialAccount, rule?: SocialRule): Promise<SocialPolicy>;
  /** Model access for AI text. Absent when no text model is configured on this host. */
  generateText?: SocialTextGenerator;
  /** Throws before anything leaves the Host when the target is suppressed on this channel. */
  assertSendable(target: SendTarget, channel: OutreachChannel): Promise<void>;
  /** Queue-time autonomy decision for a send without a draft (see autonomy-gate.ts). */
  authorizeAutonomous(input: AutonomousRequest): Promise<AutonomyDecision>;
  recordAiAction(action: AiAction): Promise<void>;
  accounts(p: SocialPrincipal): Promise<SocialAccount[]>;
  access(
    p: SocialPrincipal,
    accountId: string,
    permission: SocialPermission,
  ): Promise<SocialAccount>;
  owner(p: SocialPrincipal): void;
  adapterFor(account: SocialAccount): SocialAdapter;
  credentialFor(accountId: string): Promise<SocialCredential | undefined>;
  capability(account: SocialAccount, operation: SocialOperation): void;
  createDraft(
    p: SocialPrincipal,
    action: string,
    input: Record<string, unknown>,
  ): Promise<SocialDraft>;
  sendDraft(
    p: SocialPrincipal,
    id: string,
    plural: string,
    operationId: string,
  ): Promise<SocialJob>;
  upsertContact(p: SocialPrincipal, input: Record<string, unknown>): Promise<SocialContact>;
  optOut(contact: SocialContact): Promise<SocialContact>;
  /** Clears name, tags, profile URL, language and history of a contact. Owner-only callers check first. */
  eraseContact(contact: SocialContact): Promise<SocialContact>;
  /** Owner only. Moves a job waiting for a person (review, needs_human) back to the queue. */
  requeueForHuman(p: SocialPrincipal, jobId: string): Promise<SocialJob>;
  ingest(accountId: string, events: SocialInbound[]): Promise<number>;
  writeJob(job: SocialJob): Promise<SocialJob>;
  audit(
    principal: SocialPrincipal,
    action: string,
    operationId: string,
    accountId?: string,
    outcome?: SocialAudit["outcome"],
    value?: unknown,
  ): Promise<void>;
  setting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
}
