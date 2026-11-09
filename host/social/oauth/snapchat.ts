import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";

const PUBLIC_PROFILE_UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export const snapchatOAuth: OAuthPlatformConfig = {
  platform: "snapchat",
  enabled: true,
  authorizeUrl: () => "https://accounts.snapchat.com/login/oauth2/authorize",
  tokenUrl: () => "https://accounts.snapchat.com/login/oauth2/access_token",
  scopeSeparator: " ",
  extraScopes: (_accountType, current) =>
    current.includes("snapchat-profile-api") ? [] : ["snapchat-profile-api"],
  clientIdParam: "client_id",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(snapchatOAuth, runtime, account, credential),
  async identity({ http, now }, { credential, scopes }) {
    const { value } = await http.request(
      "https://businessapi.snapchat.com/v1/public_profiles/my_profile",
      credential.accessToken,
    );
    const profile = value.public_profile;
    if (
      value.request_status !== "SUCCESS" ||
      typeof profile?.id !== "string" ||
      !PUBLIC_PROFILE_UUID.test(profile.id)
    )
      throw new Error("Snapchat did not verify an API Public Profile UUID.");
    if (!scopes.includes("snapchat-profile-api"))
      throw new Error("OAuth did not grant the profile permission.");
    credential.expiresAt ??= now() + 60 * 60_000;
    return {
      candidates: [
        {
          id: String(profile?.id ?? ""),
          name: String(profile?.display_name ?? ""),
          credential,
        },
      ],
    };
  },
};
