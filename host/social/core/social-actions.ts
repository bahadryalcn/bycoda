import type { AutonomyAction } from "../../../src/features/social/model/autonomy";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { DecisionService } from "../../decision-models/decision-types";
import type { SecretValueStore } from "../../secrets/secret-store";
import type { SocialAudienceStore } from "../store/social-audience-store";
import type { SocialPrincipal } from "../social";
import type { SocialServiceApi } from "./social-service-api";

export type SocialActionContext = {
  service: SocialServiceApi;
  store: SocialAudienceStore;
  now: () => number;
  principal: SocialPrincipal;
  operationId: string;
  /** Decision-model service from the Host composition; undefined when no model is configured. */
  decisions?: DecisionService;
  /** Host vault for email credentials; undefined makes every email action refuse before sending. */
  emailSecrets?: SecretValueStore;
};

export type SocialActionSpec = {
  readOnly: boolean;
  ownerOnly: boolean;
  /** Exposed as an AI tool. */
  tool?: boolean;
  autonomy?: AutonomyAction;
  run: (ctx: SocialActionContext, input: Record<string, unknown>) => Promise<unknown>;
};

export type SocialActionModule = Record<string, SocialActionSpec>;

/**
 * Names handled by the SocialService.dispatch switch (and its `action ===` checks). Registry
 * actions must not reuse them, because the switch would shadow them without an error.
 * Guarded by social-actions.test.ts against the source.
 */
export const SOCIAL_LEGACY_ACTIONS: readonly string[] = [
  "accounts.assistantGrant",
  "accounts.create",
  "accounts.disconnect",
  "accounts.executor",
  "accounts.grants",
  "accounts.list",
  "accounts.pause",
  "automations.activate",
  "automations.create",
  "automations.pause",
  "campaigns.approve",
  "campaigns.approveReviewed",
  "campaigns.create",
  "campaigns.pause",
  "campaigns.preview",
  "campaigns.schedule",
  "campaigns.status",
  "capabilities.get",
  "comments.draft",
  "comments.send",
  "contacts.history",
  "contacts.import",
  "contacts.optout",
  "contacts.search",
  "contacts.suggestTags",
  "contacts.upsert",
  "drafts.approve",
  "drafts.read",
  "drafts.update",
  "execution.enable",
  "execution.stop",
  "facts.suggest",
  "inbox.list",
  "inbox.polling",
  "inbox.sync",
  "jobs.archive",
  "jobs.archive-status",
  "jobs.cancel",
  "jobs.retry",
  "jobs.status",
  "media.quarantine",
  "media.status",
  "messages.draft",
  "messages.send",
  "plans.suggest",
  "policy.get",
  "policy.save",
  "policy.saveReviewed",
  "profiles.save",
  "programs.features",
  "programs.media-preview",
  "publishing-plans.activate",
  "publishing-plans.create",
  "publishing-plans.list",
  "publishing-plans.pause",
  "publishing-plans.update",
  "replies.draft",
  "replies.send",
  "replies.suggest",
  "rules.simplify",
  "segments.create",
  "snapshot",
  "thread.assign",
  "thread.page",
  "thread.read",
  "workspace.snapshot",
];

/** Builds the action map. Throws on a duplicate name or a name the built-in switch already owns. */
export function socialActionRegistry(modules: SocialActionModule[]): Map<string, SocialActionSpec> {
  const registry = new Map<string, SocialActionSpec>();
  for (const module of modules)
    for (const [name, spec] of Object.entries(module)) {
      if (SOCIAL_LEGACY_ACTIONS.includes(name) || name.startsWith("programs."))
        throw new Error(`Social action ${name} collides with a built-in operation.`);
      if (registry.has(name)) throw new Error(`Social action ${name} is registered twice.`);
      registry.set(name, spec);
    }
  return registry;
}

/** A registered action whose behavior is not built yet. Its flags are final; run always rejects. */
export function plannedSocialAction(
  flags: Pick<SocialActionSpec, "readOnly" | "ownerOnly" | "tool">,
): SocialActionSpec {
  return {
    ...flags,
    run: async () => {
      throw new SocialPlatformError("unsupported");
    },
  };
}

/** Exact input fields accepted by each campaign program operation (owner or AI tool). */
export const PROGRAM_OPERATION_FIELDS: Record<string, string[]> = {
  "programs.list": ["projectId"],
  "programs.status": ["id", "before"],
  "programs.configure": ["id", "config", "expectedRevision"],
  "programs.generate": ["id"],
  "programs.preview-schedule": ["config"],
  "programs.suggest": ["config", "instructions"],
  "programs.activate": ["id", "expectedRevision", "confirm"],
  "programs.pause": ["id"],
  "programs.cancel": ["id"],
  "programs.approve": ["id", "occurrenceId", "accountId", "expectedRevision", "confirm", "steps"],
  "programs.edit": ["id", "occurrenceId", "accountId", "expectedRevision", "variant"],
  "programs.regenerate": ["id", "occurrenceId", "accountId"],
  "programs.reschedule": ["id", "occurrenceId", "scheduledAt"],
  "programs.resume-image": ["id", "occurrenceId", "accountId"],
  "programs.bulk-edit": ["id", "expectedRevision", "link"],
};
