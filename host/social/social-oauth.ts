import { createHash, randomBytes } from "node:crypto";
import type {
  SocialAccount,
  SocialOperation,
  SocialPlatform,
} from "../../src/features/social/model/social";
import { platformRequirements } from "../../src/integrations/social/capabilities";
import { SocialHttp } from "../../src/integrations/social/adapter";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_API_ACCOUNT_TYPES,
  PROFILE_ONLY_PLATFORMS,
  TOKEN_PLATFORMS,
} from "../../src/features/social/model/social";
import type { SocialCredential } from "./social-credentials";
import type { SocialPrincipal, SocialService } from "./social";
import { OAUTH_PLATFORMS, enabledOAuthPlatform } from "./oauth/registry";
import type {
  OAuthCandidate,
  OAuthRuntime,
  OAuthTokenResponse,
  SocialOAuthConfig,
} from "./oauth/oauth-platform";

export type { SocialOAuthConfig } from "./oauth/oauth-platform";

type Flow = {
  accountId: string;
  platform: SocialPlatform;
  verifier: string;
  expiresAt: number;
  scopes: string[];
  status: "waiting" | "selection" | "connected" | "failed";
  candidates: OAuthCandidate[];
  error?: string;
  actorId: string;
  resourceId?: string;
};

export function socialOAuthConfigs(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<SocialPlatform, SocialOAuthConfig>> {
  const configs: Partial<Record<SocialPlatform, SocialOAuthConfig>> = {};
  for (const platform of SOCIAL_PLATFORMS.filter((id) => enabledOAuthPlatform(id))) {
    const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
    const clientId = env[`${prefix}CLIENT_ID`];
    const redirectUri = env[`${prefix}REDIRECT_URI`];
    if (!clientId || !redirectUri) continue;
    const parsed = new URL(redirectUri);
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== `/social/oauth/${platform}/callback` ||
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)))
    )
      throw new Error("Invalid social OAuth callback configuration.");
    configs[platform] = {
      clientId,
      redirectUri,
      clientSecret: env[`${prefix}CLIENT_SECRET`],
      approved: env[`${prefix}APPROVED`] === "1",
      graphVersion: env.BYCODA_SOCIAL_GRAPH_VERSION ?? "v25.0",
      linkedinVersion: env.BYCODA_SOCIAL_LINKEDIN_VERSION ?? "202609",
    };
  }
  return configs;
}
/** OAuth token exchange and account enumeration stay entirely inside the host. Per-platform rules live in ./oauth/. */
export class SocialOAuth {
  private flows = new Map<string, Flow>();
  constructor(
    private readonly social: SocialService,
    private readonly configs = socialOAuthConfigs(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {
    social.refreshCredential ??= async (account, credential) =>
      await this.refresh(account, credential);
  }

  private runtime(platform: SocialPlatform): OAuthRuntime {
    return {
      config: this.configs[platform],
      fetcher: this.fetcher,
      now: this.now,
      http: new SocialHttp(this.fetcher, this.now),
    };
  }

  async refresh(account: SocialAccount, credential: SocialCredential): Promise<SocialCredential> {
    const definition = enabledOAuthPlatform(account.platform);
    if (!definition?.refresh) throw new Error("This connection requires owner reconnection.");
    return await definition.refresh(this.runtime(account.platform), account, credential);
  }

  availability() {
    return Object.fromEntries(
      SOCIAL_PLATFORMS.filter((id) => !TOKEN_PLATFORMS.includes(id)).map((platform) => {
        const definition = OAUTH_PLATFORMS[platform];
        const config = this.configs[platform as SocialPlatform];
        const configured =
          !!definition?.enabled &&
          !!config &&
          (!definition.clientSecretRequired || !!config.clientSecret);
        return [
          platform,
          {
            configured,
            reason: !definition?.enabled
              ? "This platform's OAuth connection is not available on this host yet."
              : configured
                ? "App configuration present; OAuth, access review and account role still need verification."
                : "Host OAuth app client ID/secret and registered callback are missing.",
          },
        ];
      }),
    );
  }
  async begin(
    p: SocialPrincipal,
    accountId: string,
    resourceId?: string,
    operations: SocialOperation[] = ["publish"],
  ): Promise<{ url: string; expiresAt: number }> {
    const account = await this.social.accountForOAuth(p, accountId);
    if (
      !(SOCIAL_API_ACCOUNT_TYPES[account.platform] as readonly string[]).includes(
        account.accountType,
      )
    )
      throw new Error("This account type requires a browser session, not an API connection.");
    if (TOKEN_PLATFORMS.includes(account.platform))
      throw new Error("Use the host token connection for this account.");
    const profileOnly = PROFILE_ONLY_PLATFORMS.includes(account.platform);
    if (profileOnly) operations = [];
    const definition = enabledOAuthPlatform(account.platform);
    if (!definition)
      throw new Error("This platform's OAuth connection is not available on this host yet.");
    const config = this.configs[account.platform];
    if (!config || (definition.clientSecretRequired && !config.clientSecret))
      throw new Error(
        "Configure the platform OAuth app and registered callback on the host first.",
      );
    definition.checkResource?.(account.accountType, resourceId);
    for (const [key, flow] of this.flows)
      if (flow.expiresAt <= this.now() || flow.accountId === accountId) this.flows.delete(key);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const requirements = platformRequirements(account.platform, account.accountType);
    if (
      !Array.isArray(operations) ||
      (!operations.length && !profileOnly) ||
      operations.length > 11 ||
      operations.some(
        (operation) => !requirements[operation] || requirements[operation].unsupported,
      )
    )
      throw new Error("Choose supported OAuth operations for this account.");
    // Closed read permissions must not prevent an otherwise permitted login.
    const scopes = [...new Set(operations.flatMap((operation) => requirements[operation].scopes))];
    scopes.push(...definition.extraScopes(account.accountType, scopes));
    const flow: Flow = {
      accountId,
      platform: account.platform,
      verifier,
      expiresAt: this.now() + 10 * 60_000,
      scopes,
      status: "waiting",
      candidates: [],
      actorId: p.actorId,
      resourceId,
    };
    this.flows.set(state, flow);
    const auth = new URL(definition.authorizeUrl(config));
    auth.search = new URLSearchParams({
      [definition.clientIdParam]: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: scopes.join(definition.scopeSeparator),
      state,
      ...definition.authorizeParams?.(),
      ...(definition.pkce
        ? {
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
          }
        : {}),
    }).toString();
    return { url: auth.toString(), expiresAt: flow.expiresAt };
  }
  async status(p: SocialPrincipal, accountId: string) {
    await this.social.accountForOAuth(p, accountId);
    const flow = [...this.flows.values()].find(
      (item) =>
        item.accountId === accountId && item.actorId === p.actorId && item.expiresAt > this.now(),
    );
    return flow
      ? {
          status: flow.status,
          candidates: flow.candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
          })),
          error: flow.error,
        }
      : { status: "idle", candidates: [] };
  }
  async select(p: SocialPrincipal, accountId: string, candidateId: string) {
    await this.social.accountForOAuth(p, accountId);
    const flow = [...this.flows.values()].find(
      (item) =>
        item.accountId === accountId &&
        item.actorId === p.actorId &&
        item.expiresAt > this.now() &&
        item.status === "selection",
    );
    const candidate = flow?.candidates.find((item) => item.id === candidateId);
    if (!flow || !candidate) throw new Error("OAuth account selection expired or invalid.");
    const account = await this.connect(flow, candidate);
    return account;
  }
  async callback(platform: SocialPlatform, params: URLSearchParams): Promise<void> {
    const state = params.get("state") ?? "";
    const flow = this.flows.get(state);
    if (
      !flow ||
      flow.platform !== platform ||
      flow.status !== "waiting" ||
      flow.expiresAt <= this.now()
    )
      throw new Error("OAuth state is invalid or expired.");
    // Consume state before network I/O to reject replay/concurrent callbacks.
    flow.status = "failed";
    try {
      const code = params.get("code");
      if (!code || params.has("error")) throw new Error("OAuth authorization was not completed.");
      const definition = enabledOAuthPlatform(platform)!;
      const config = this.configs[platform]!;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        [definition.clientIdParam]: config.clientId,
        ...(definition.pkce ? { code_verifier: flow.verifier } : {}),
        ...(config.clientSecret && definition.tokenClientAuth === "body"
          ? { client_secret: config.clientSecret }
          : {}),
      });
      const response = await this.fetcher(definition.tokenUrl(config), {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(definition.tokenClientAuth === "basic" && config.clientSecret
            ? {
                Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
              }
            : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error("OAuth token exchange failed. Check the host app configuration.");
      const result = (await response.json()) as OAuthTokenResponse;
      if (!result.access_token) throw new Error("OAuth returned no access token.");
      const lifetime =
        Number(result.expires_in) > 0
          ? Number(result.expires_in)
          : definition.fallbackExpiresInSeconds;
      const credential: SocialCredential = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        ...(lifetime !== undefined ? { expiresAt: this.now() + lifetime * 1000 } : {}),
      };
      // Requested permissions are not evidence of granted permissions.
      let scopes =
        typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
      if (
        Array.isArray(result.permissions) &&
        result.permissions.every((value) => typeof value === "string")
      )
        scopes = result.permissions;
      flow.scopes = scopes;
      const identity = await definition.identity(
        { ...this.runtime(platform), config },
        { credential, token: result, scopes, resourceId: flow.resourceId },
      );
      if (identity.scopes) flow.scopes = identity.scopes;
      flow.candidates = identity.candidates;
      if (
        !flow.candidates.length ||
        flow.candidates.some(
          (candidate) => !candidate.id || !candidate.name || candidate.id.endsWith(":"),
        )
      )
        throw new Error("No eligible social identity was returned by OAuth.");
      // Owner chooses even a single candidate, making the final account identity reviewable.
      flow.status = "selection";
      delete flow.error;
    } catch (error) {
      flow.status = "failed";
      flow.candidates = [];
      flow.error =
        error instanceof Error && /^OAuth|^Instagram|^LinkedIn|^No eligible/.test(error.message)
          ? error.message
          : "OAuth verification failed. Check app access and account permissions.";
      throw new Error(flow.error);
    }
  }
  private async connect(flow: Flow, candidate: OAuthCandidate): Promise<SocialAccount> {
    const p: SocialPrincipal = {
      kind: "owner",
      actorId: flow.actorId,
      provider: "owner",
    };
    const old = await this.social.accountForOAuth(p, flow.accountId);
    if (old.platformId && old.platformId !== candidate.id)
      throw new Error(
        "Reconnect must preserve account identity. Create another account for a different identity.",
      );
    const account = await this.social.connectAccount(
      flow.accountId,
      {
        platformId: candidate.id,
        name: candidate.name,
        scopes: flow.scopes,
        accessApproved: this.configs[flow.platform]!.approved,
        instagramAccountType: candidate.instagramAccountType,
      },
      candidate.credential,
    );
    flow.status = "connected";
    flow.candidates = [];
    flow.verifier = "";
    return account;
  }
}
