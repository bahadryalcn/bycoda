import type { SocialAgent, SocialPublishingSchedule, SocialRule } from "./social";

/**
 * Host AI bridges that only PROPOSE. `plans.suggest`, `rules.simplify` and `facts.suggest` are
 * owner-only, read-only operations: they store nothing, send nothing and activate nothing. The
 * owner reviews the proposal and accepts it through the existing manual save path
 * (`publishing-plans.create` -> saved paused, `automations.create` -> saved paused,
 * `profiles.save` -> owner-saved facts). Each call carries a client request id, so a retry
 * after an unclear result returns the first answer instead of asking the model again.
 */

/** `plans.suggest` input. `campaignIds` optionally narrows the pool the model may choose from. */
export type PlanSuggestInput = {
  accountId: string;
  projectId: string;
  campaignIds?: string[];
  /** Free owner wording, quoted to the model as data. At most 2000 characters. */
  instructions?: string;
};

/** A paused publishing-plan draft the existing plan dialog can load. */
export type PlanSuggestion = {
  accountId: string;
  projectId: string;
  name: string;
  /** Ordered pool: a subset of the account's eligible campaigns, each used at most once. */
  campaignIds: string[];
  schedule: SocialPublishingSchedule;
  rationale: string;
  /** Eligible campaigns the proposal left out, with the reason. */
  excluded: { campaignId: string; reason: string }[];
  /** Pool entries that are not owner-approved for publication yet (the plan needs them approved). */
  unapprovedCampaignIds: string[];
  /** Open questions the model could not answer from the provided data. */
  questions: string[];
  agent: SocialAgent;
  requiresOwnerActivation: true;
};

/** `rules.simplify` input. `ruleIds` optionally limits the review to some of the account's rules. */
export type RuleSimplifyInput = {
  accountId: string;
  projectId: string;
  ruleIds?: string[];
  instructions?: string;
};

/** The fields `automations.create` reads (always saved paused). */
export type RuleDraft = Pick<
  SocialRule,
  "name" | "accountId" | "projectId" | "mode" | "trigger" | "topics" | "dailyLimit" | "stopWords" | "answers"
> & { agent?: SocialAgent };

export type RuleChangeField = "name" | "mode" | "topics" | "dailyLimit" | "stopWords" | "answers";

/** Computed by the Host from the stored rule and the validated proposal, never taken from the model. */
export type RuleChange = { field: RuleChangeField; before: unknown; after: unknown };

export type RuleSimplifyProposal = {
  ruleId: string;
  ruleName: string;
  /** Narrowing edits only: never a more permissive mode, higher limit, more topics, fewer stop words or new answers. */
  proposed: RuleDraft;
  changes: RuleChange[];
  reason: string;
};

export type RuleSimplifySuggestion = {
  accountId: string;
  projectId: string;
  proposals: RuleSimplifyProposal[];
  /** Reviewed rules the model would leave as they are. */
  unchangedRuleIds: string[];
  notes: string[];
  agent: SocialAgent;
  requiresOwnerActivation: true;
};

/** `facts.suggest` input. The source text is quoted to the model as untrusted data. */
export type FactSuggestInput = {
  accountId: string;
  projectId: string;
  /** Where the text came from (for the fact's source line), at most 200 characters. */
  sourceLabel: string;
  /** At most 20000 characters. */
  sourceText: string;
};

/** One candidate fact. It is NOT verified: only the owner's save of the product knowledge makes it so. */
export type FactCandidate = {
  /** Temporary id, valid only inside this answer. */
  id: string;
  topic: string;
  text: string;
  /** A passage of the source text that supports the fact; the Host checks it occurs in the source. */
  quote: string;
  /** Set when the project already has a verified fact with the same text. */
  duplicateOfFactId?: string;
};

export type FactSuggestResult = {
  accountId: string;
  projectId: string;
  sourceLabel: string;
  suggestions: FactCandidate[];
  /** Model statements dropped because the source text does not support them. */
  skipped: number;
  agent: SocialAgent;
  verified: false;
};
