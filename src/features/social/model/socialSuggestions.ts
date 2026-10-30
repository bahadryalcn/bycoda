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

/** At most this many contacts per `contacts.suggestTags` request (the Host enforces it). */
export const CONTACT_TAG_REQUEST_MAX = 100;
/** At most this many suggested tags per contact, each at most this long. */
export const CONTACT_TAG_PER_CONTACT_MAX = 5;
export const CONTACT_TAG_MAX_LENGTH = 40;
/** A contact's total tag list is capped by the Host's contact validation. */
export const CONTACT_TAGS_MAX = 30;

/**
 * One import row (not saved yet) the model should label. `ref` is the caller's own key and comes
 * back unchanged; it carries no meaning to the Host. Consent, opt-out and eligibility are never part
 * of a row.
 */
export type ContactTagRow = {
  ref: string;
  name: string;
  platformId?: string;
  profileUrl?: string;
  language?: string;
  tags?: string[];
};

/**
 * `contacts.suggestTags` input: owner-only, scoped to one account and one project the account has
 * draft access to. Exactly one of `contactIds` (saved contacts of that account and project) or `rows`
 * (parsed import rows) is given. Free `instructions` and every contact value are quoted to the model
 * as untrusted data.
 */
export type ContactTagInput = {
  accountId: string;
  projectId: string;
  contactIds?: string[];
  rows?: ContactTagRow[];
  /** At most 2000 characters. */
  instructions?: string;
};

export type ContactTagSuggestion = {
  tag: string;
  reason: string;
  /** No contact of this project carries the tag yet, so accepting it introduces a new label. */
  isNew: boolean;
};

export type ContactTagProposal = {
  /** The saved contact's id, or the row's `ref`. */
  ref: string;
  name: string;
  currentTags: string[];
  /** Only tags the contact does not carry yet; never empty (contacts with nothing to add are omitted). */
  tags: ContactTagSuggestion[];
  /** Existing segments of this project the contact would match once it carries every proposed tag. */
  segments: { id: string; name: string }[];
};

/**
 * The answer: a draft only. It never changes consent, opt-out or eligibility and stores nothing; the
 * owner applies accepted tags through `contacts.import` (rows) or `contacts.upsert` (saved contacts).
 */
export type ContactTagResult = {
  accountId: string;
  projectId: string;
  proposals: ContactTagProposal[];
  /** Refs the model had nothing to add for. */
  unchangedRefs: string[];
  notes: string[];
  agent: SocialAgent;
  draftOnly: true;
};
