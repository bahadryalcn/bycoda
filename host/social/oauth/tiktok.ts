import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";

export const tiktokOAuth: OAuthPlatformConfig = {
  platform: "tiktok",
  enabled: true,
  authorizeUrl: () => "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: () => "https://open.tiktokapis.com/v2/oauth/token/",
  scopeSeparator: ",",
  // TikTok optional scopes must already exist on this Login Kit app.
  extraScopes: (_accountType, current) =>
    [
      ...(current.includes("user.info.basic") ? [] : ["user.info.basic"]),
      ...(process.env.BYCODA_SOCIAL_TIKTOK_PROFILE_APPROVED === "true"
        ? ["user.info.profile"]
        : []),
      ...(process.env.BYCODA_SOCIAL_TIKTOK_STATS_APPROVED === "true" ? ["user.info.stats"] : []),
      ...(process.env.BYCODA_SOCIAL_TIKTOK_UPLOAD_APPROVED === "true" ? ["video.upload"] : []),
    ].filter((scope) => !current.includes(scope)),
  clientIdParam: "client_key",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(tiktokOAuth, runtime, account, credential),
  async identity({ http, now }, { credential, scopes }) {
    const { value } = await http.request(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      credential.accessToken,
    );
    const profile = value.data?.user;
    if (!scopes.includes("user.info.basic"))
      throw new Error("OAuth did not grant the profile permission.");
    if (typeof profile?.open_id !== "string" || !profile.open_id)
      throw new Error("TikTok account identity could not be verified.");
    credential.expiresAt ??= now() + 60 * 60_000;
    return {
      candidates: [
        {
          id: String(profile?.open_id ?? ""),
          name: String(profile?.display_name ?? ""),
          credential,
        },
      ],
    };
  },
};
