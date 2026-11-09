import type { SocialHttp } from "../../../src/integrations/social/adapter";
import type { SocialService } from "../social";

/** Host-side dependencies shared by the per-platform token connection modules. */
export type TokenConnectionDeps = {
  social: SocialService;
  env: NodeJS.ProcessEnv;
  http: SocialHttp;
  now: () => number;
};

export type TokenAvailability = { configured: boolean; reason: string };

export type VerifiedTokenIdentity = {
  platformId: string;
  name: string;
  scopes: string[];
};
