/** Audience model: people, handles, lists, capture rules and interaction history. React-free. */
import type { SocialPlatform } from "./social";
import type { CaptureSource, InteractionKind } from "../../../integrations/social/audience-types";

export type { CaptureSource, InteractionKind } from "../../../integrations/social/audience-types";

export type PersonStage =
  | "new"
  | "contacted"
  | "replied"
  | "interested"
  | "customer"
  | "closed"
  | "opted_out";

/** One platform identity of a person. `contactId` links to the existing per-account SocialContact. */
export type ContactHandle = {
  accountId: string;
  platform: SocialPlatform;
  platformId: string;
  contactId: string;
  username?: string;
  profileUrl?: string;
};

export type ContactEmail = {
  address: string;
  source: "public_profile" | "import" | "manual" | "inbound";
  verified: boolean;
};

export type SocialPerson = {
  id: string;
  name: string;
  handles: ContactHandle[];
  emails: ContactEmail[];
  tags: string[];
  notes: string;
  stage: PersonStage;
  score?: { value: number; reason: string; at: number };
  source: InteractionKind | "manual" | "import" | "migration";
  language?: string;
  projectIds: string[];
  /** Consent is informational only; outreach permission comes from the autonomy policy (owner D2). */
  consent: { basis: "none" | "inbound" | "explicit" | "imported"; evidence?: string; at?: number };
  /** Turkish commercial message approval (IYS) for recipients in Turkey. */
  commercialConsent?: { iys: "unknown" | "approved" | "rejected"; checkedAt?: number };
  createdAt: number;
  updatedAt: number;
};

export type Interaction = {
  id: string;
  personId: string;
  accountId: string;
  platform: SocialPlatform | "email";
  kind: InteractionKind;
  /** Post, thread or message identifier. */
  ref?: string;
  text?: string;
  at: number;
  direction: "inbound" | "outbound";
};

/**
 * Filter semantics match saved segments: `tags` requires every listed tag,
 * `language` is an exact match, `platforms` and `sources` match any listed value.
 */
export type AudienceFilter = {
  tags?: string[];
  language?: string;
  platforms?: SocialPlatform[];
  stages?: PersonStage[];
  minScore?: number;
  query?: string;
  sources?: InteractionKind[];
};

export type SocialList = {
  id: string;
  name: string;
  kind: "static" | "dynamic";
  filter?: AudienceFilter;
  projectIds: string[];
  system?: "commenters";
  createdAt: number;
};

export type CaptureRule = {
  id: string;
  name: string;
  enabled: boolean;
  source: CaptureSource;
  filter: {
    keywords?: string[];
    language?: string;
    minFollowers?: number;
    sentiment?: "positive" | "neutral" | "negative";
  };
  targetListId: string;
  action?: { kind: "tag"; tag: string } | { kind: "enroll"; sequenceId: string };
  system?: "commenters";
  createdAt: number;
};
