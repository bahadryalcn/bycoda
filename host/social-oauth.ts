import { createHash, randomBytes } from "node:crypto";
import type {
  SocialAccount,
  SocialOperation,
  SocialPlatform,
} from "../src/features/social/model/social";
import { platformRequirements } from "../src/integrations/social/capabilities";
import { SocialHttp } from "../src/integrations/social/adapter";
import {
  SOCIAL_PLATFORMS,
  PROFILE_ONLY_PLATFORMS,
  TOKEN_PLATFORMS,
} from "../src/features/social/model/social";
import type { SocialCredential } from "./social-credentials";
import type { SocialPrincipal, SocialService } from "./social";

export type SocialOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  approved: boolean;
  graphVersion: string;
  linkedinVersion: string;
};
type Candidate = { id: string; name: string; credential: SocialCredential };
type Flow = {
  accountId: string;
  platform: SocialPlatform;
  verifier: string;
  expiresAt: number;
  scopes: string[];
  status: "waiting" | "selection" | "connected" | "failed";
  candidates: Candidate[];
  error?: string;
  actorId: string;
  resourceId?: string;
};
export function socialOAuthConfigs(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<SocialPlatform, SocialOAuthConfig>> {
  const configs: Partial<Record<SocialPlatform, SocialOAuthConfig>> = {};
  for (const platform of SOCIAL_PLATFORMS.filter((id) => !TOKEN_PLATFORMS.includes(id))) {
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
/** OAuth token exchange and account enumeration stay entirely inside the host. */
export class SocialOAuth {
  private flows = new Map<string, Flow>();
  constructor(
    private readonly social: SocialService,
    private readonly configs = socialOAuthConfigs(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {
    social.refreshCredential ??= (account, credential) => this.refresh(account, credential);
  }
  async refresh(account: SocialAccount, credential: SocialCredential): Promise<SocialCredential> {
    const config = this.configs[account.platform];
    if (
      !config ||
      !credential.refreshToken ||
      !["x", "youtube", "tiktok", "snapchat"].includes(account.platform)
    )
      throw new Error("This connection requires owner reconnection.");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      [account.platform === "tiktok" ? "client_key" : "client_id"]: config.clientId,
      ...(account.platform !== "x" && config.clientSecret
        ? { client_secret: config.clientSecret }
        : {}),
    });
    const response = await this.fetcher(
      account.platform === "x"
        ? "https://api.x.com/2/oauth2/token"
        : account.platform === "tiktok"
          ? "https://open.tiktokapis.com/v2/oauth/token/"
          : account.platform === "snapchat"
            ? "https://accounts.snapchat.com/login/oauth2/access_token"
            : "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(account.platform === "x" && config.clientSecret
            ? {
                Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
              }
            : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Account refresh failed. Reconnect the account.");
    const result = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (
      !result.access_token ||
      !Number.isFinite(result.expires_in) ||
      Number(result.expires_in) <= 0
    )
      throw new Error("Account refresh returned invalid credentials.");
    if (result.scope) {
      const scopes = [...new Set(result.scope.split(/[ ,]+/).filter(Boolean))].sort();
      if (JSON.stringify(scopes) !== JSON.stringify([...account.scopes].sort()))
        throw new Error("Account scopes changed. Reconnect and review its permissions.");
    }
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? credential.refreshToken,
      expiresAt: this.now() + Number(result.expires_in) * 1000,
    };
  }
  availability() {
    return Object.fromEntries(
      SOCIAL_PLATFORMS.filter((id) => !TOKEN_PLATFORMS.includes(id)).map((platform) => {
        const config = this.configs[platform as SocialPlatform];
        const configured = !!config && (platform === "x" || !!config.clientSecret);
        return [
          platform,
          {
            configured,
            reason: configured
              ? "App configuration present; OAuth, access review and account role still need verification."
              : "Host OAuth app client ID/secret and registered callback are missing.",
          },
        ];
      }),
    );
  }
  begin(
    p: SocialPrincipal,
    accountId: string,
    resourceId?: string,
    operations: SocialOperation[] = ["publish"],
  ): { url: string; expiresAt: number } {
    const account = this.social.accountForOAuth(p, accountId);
    if (TOKEN_PLATFORMS.includes(account.platform))
      throw new Error("Use the host token connection for this account.");
    const profileOnly = PROFILE_ONLY_PLATFORMS.includes(account.platform);
    if (profileOnly) operations = [];
    const config = this.configs[account.platform];
    if (!config || (account.platform !== "x" && !config.clientSecret))
      throw new Error(
        "Configure the platform OAuth app and registered callback on the host first.",
      );
    if (account.accountType === "organization" && (!resourceId || !/^\d+$/.test(resourceId)))
      throw new Error("Supply the LinkedIn organization ID; OAuth will verify the admin role.");
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
    if (account.platform === "tiktok" && !scopes.includes("user.info.basic"))
      scopes.push("user.info.basic");
    if (account.platform === "snapchat") scopes.push("snapchat-profile-api");
    if (account.platform === "instagram") scopes.push("instagram_business_basic");
    if (account.platform === "x") scopes.push("offline.access");
    if (account.platform === "youtube")
      scopes.push("https://www.googleapis.com/auth/youtube.readonly");
    if (account.platform === "facebook") scopes.push("pages_show_list");
    if (account.platform === "linkedin")
      scopes.push(
        "openid",
        "profile",
        ...(account.accountType === "organization" ? ["rw_organization_admin"] : []),
      );
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
    const endpoint =
      account.platform === "x"
        ? "https://x.com/i/oauth2/authorize"
        : account.platform === "instagram"
          ? "https://www.instagram.com/oauth/authorize"
          : account.platform === "facebook"
            ? `https://www.facebook.com/${config.graphVersion}/dialog/oauth`
            : account.platform === "youtube"
              ? "https://accounts.google.com/o/oauth2/v2/auth"
              : account.platform === "tiktok"
                ? "https://www.tiktok.com/v2/auth/authorize/"
                : account.platform === "snapchat"
                  ? "https://accounts.snapchat.com/login/oauth2/authorize"
                  : "https://www.linkedin.com/oauth/v2/authorization";
    const auth = new URL(endpoint);
    auth.search = new URLSearchParams({
      [account.platform === "tiktok" ? "client_key" : "client_id"]: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: scopes.join(
        account.platform === "instagram" ||
          account.platform === "facebook" ||
          account.platform === "tiktok"
          ? ","
          : " ",
      ),
      state,
      ...(account.platform === "youtube"
        ? {
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: "true",
          }
        : {}),
      ...(account.platform === "x"
        ? {
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
          }
        : {}),
    }).toString();
    return { url: auth.toString(), expiresAt: flow.expiresAt };
  }
  status(p: SocialPrincipal, accountId: string) {
    this.social.accountForOAuth(p, accountId);
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
    this.social.accountForOAuth(p, accountId);
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
      const config = this.configs[platform]!;
      const endpoint =
        platform === "x"
          ? "https://api.x.com/2/oauth2/token"
          : platform === "instagram"
            ? "https://api.instagram.com/oauth/access_token"
            : platform === "facebook"
              ? `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`
              : platform === "youtube"
                ? "https://oauth2.googleapis.com/token"
                : platform === "tiktok"
                  ? "https://open.tiktokapis.com/v2/oauth/token/"
                  : platform === "snapchat"
                    ? "https://accounts.snapchat.com/login/oauth2/access_token"
                    : "https://www.linkedin.com/oauth/v2/accessToken";
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        [platform === "tiktok" ? "client_key" : "client_id"]: config.clientId,
        ...(platform === "x" ? { code_verifier: flow.verifier } : {}),
        ...(config.clientSecret && platform !== "x" ? { client_secret: config.clientSecret } : {}),
      });
      const response = await this.fetcher(endpoint, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(platform === "x" && config.clientSecret
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
      const result = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        permissions?: string[];
        user_id?: string;
      };
      if (!result.access_token) throw new Error("OAuth returned no access token.");
      const credential: SocialCredential = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        ...(Number(result.expires_in) > 0 || platform === "x"
          ? {
              expiresAt:
                this.now() +
                (Number(result.expires_in) > 0 ? Number(result.expires_in) : 7200) * 1000,
            }
          : {}),
      };
      const http = new SocialHttp(this.fetcher, this.now);
      // Requested permissions are not evidence of granted permissions.
      flow.scopes =
        typeof result.scope === "string" ? result.scope.split(/[ ,]+/).filter(Boolean) : [];
      if (
        Array.isArray(result.permissions) &&
        result.permissions.every((value) => typeof value === "string")
      )
        flow.scopes = result.permissions;
      if (platform === "x") {
        const { value } = await http.request(
          "https://api.x.com/2/users/me",
          credential.accessToken,
        );
        flow.candidates = [
          {
            id: String(value.data?.id ?? ""),
            name: String(value.data?.username ?? value.data?.name ?? ""),
            credential,
          },
        ];
      } else if (platform === "tiktok" || platform === "snapchat") {
        const { value } = await http.request(
          platform === "tiktok"
            ? "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name"
            : "https://businessapi.snapchat.com/v1/public_profiles/my_profile",
          credential.accessToken,
        );
        const profile = platform === "tiktok" ? value.data?.user : value.public_profile;
        const scope = platform === "tiktok" ? "user.info.basic" : "snapchat-profile-api";
        if (!flow.scopes.includes(scope))
          throw new Error("OAuth did not grant the profile permission.");
        flow.candidates = [
          {
            id: String(platform === "tiktok" ? (profile?.open_id ?? "") : (profile?.id ?? "")),
            name: String(profile?.display_name ?? ""),
            credential,
          },
        ];
        credential.expiresAt ??= this.now() + 60 * 60_000;
      } else if (platform === "instagram") {
        const { value } = await http.request(
          `https://graph.instagram.com/${config.graphVersion}/me?fields=user_id,username,account_type`,
          credential.accessToken,
        );
        if (
          value.account_type &&
          !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(value.account_type)
        )
          throw new Error("Instagram requires a professional account.");
        flow.candidates = [
          {
            id: String(value.user_id ?? value.id ?? ""),
            name: String(value.username ?? ""),
            credential,
          },
        ];
        // Short-lived Instagram tokens are conservatively expired if no TTL was supplied.
        credential.expiresAt ??= this.now() + 60 * 60_000;
      } else if (platform === "facebook") {
        const granted = await http.request(
          `https://graph.facebook.com/${config.graphVersion}/me/permissions`,
          credential.accessToken,
        );
        flow.scopes = (granted.value.data ?? [])
          .filter((item: { status: string }) => item.status === "granted")
          .map((item: { permission: string }) => item.permission);
        const { value } = await http.request(
          `https://graph.facebook.com/${config.graphVersion}/me/accounts?fields=id,name,access_token,tasks&limit=100`,
          credential.accessToken,
        );
        flow.candidates = (value.data ?? [])
          .filter(
            (page: { access_token?: string; tasks?: string[] }) =>
              page.access_token &&
              page.tasks?.some((task) =>
                ["CREATE_CONTENT", "MANAGE", "MODERATE", "MESSAGING"].includes(task),
              ),
          )
          .map((page: { id: string; name: string; access_token: string }) => ({
            id: page.id,
            name: page.name,
            credential: {
              ...credential,
              accessToken: page.access_token,
              refreshToken: undefined,
            },
          }));
      } else if (platform === "youtube") {
        const { value } = await http.request(
          "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50",
          credential.accessToken,
        );
        flow.candidates = (value.items ?? []).map(
          (channel: { id: string; snippet?: { title?: string } }) => ({
            id: String(channel.id ?? ""),
            name: String(channel.snippet?.title ?? "YouTube channel"),
            credential,
          }),
        );
        if (flow.candidates.length !== 1)
          throw new Error(
            "OAuth must identify exactly one selected YouTube channel. Reauthorize for the intended channel.",
          );
      } else {
        const { value } = await http.request(
          "https://api.linkedin.com/v2/userinfo",
          credential.accessToken,
        );
        if (flow.resourceId) {
          const { value: acl } = await http.request(
            "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
            credential.accessToken,
            {
              headers: {
                "LinkedIn-Version": config.linkedinVersion,
                "X-Restli-Protocol-Version": "2.0.0",
              },
            },
          );
          if (
            !(acl.elements ?? []).some(
              (item: { organization: string }) =>
                item.organization === `urn:li:organization:${flow.resourceId}`,
            )
          )
            throw new Error("LinkedIn organization admin role was not verified.");
          flow.candidates = [
            {
              id: `urn:li:organization:${flow.resourceId}`,
              name: `LinkedIn organization ${flow.resourceId}`,
              credential,
            },
          ];
        } else
          flow.candidates = [
            {
              id: `urn:li:person:${String(value.sub ?? "")}`,
              name: String(value.name ?? "LinkedIn member"),
              credential,
            },
          ];
      }
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
  private async connect(flow: Flow, candidate: Candidate): Promise<SocialAccount> {
    const p: SocialPrincipal = {
      kind: "owner",
      actorId: flow.actorId,
      provider: "owner",
    };
    const old = this.social.accountForOAuth(p, flow.accountId);
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
      },
      candidate.credential,
    );
    flow.status = "connected";
    flow.candidates = [];
    flow.verifier = "";
    return account;
  }
}
