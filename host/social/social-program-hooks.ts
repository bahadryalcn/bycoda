import type {
  SocialAccount,
  CampaignVariant,
  PublicFact,
  SocialAgent,
  SocialJob,
  SocialPolicy,
} from "../../src/features/social/model/social";
import type {
  SocialOccurrence,
  SocialProgram,
  ProgramTarget,
} from "../../src/features/social/model/socialProgram";

export type ProgramHooks = {
  account: (id: string) => SocialAccount | Promise<SocialAccount>;
  validateAccount: (id: string, needsMedia: boolean) => void | Promise<void>;
  policy: (id: string, agent?: SocialAgent) => SocialPolicy | Promise<SocialPolicy>;
  facts: (projectId: string, ids: string[]) => PublicFact[] | Promise<PublicFact[]>;
  pool: (
    id: string,
    accountId: string,
    projectId: string,
  ) => CampaignVariant | Promise<CampaignVariant>;
  validateVariant: (v: CampaignVariant, partial?: boolean) => void | Promise<void>;
  prepareMedia: (v: CampaignVariant) => CampaignVariant | Promise<CampaignVariant>;
  enqueue: (
    p: SocialProgram,
    o: SocialOccurrence,
    t: ProgramTarget,
  ) => SocialJob | Promise<SocialJob>;
  job: (id: string) => SocialJob | Promise<SocialJob>;
  cancelJob: (id: string) => void | Promise<void>;
  dispatchTimes: (
    programId: string,
    accountId: string,
    since: number,
  ) =>
    | {
        lastAt: number;
        recent: number[];
      }
    | Promise<{
        lastAt: number;
        recent: number[];
      }>;
  accountQueued: (accountId: string) => boolean | Promise<boolean>;
  media: (
    bytes: Uint8Array,
    actorId: string,
  ) => Promise<{
    uploadId: string;
    url?: string;
  }>;
  running: () => boolean | Promise<boolean>;
};
