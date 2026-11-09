import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";

export const xOAuth: OAuthPlatformConfig = {
  platform: "x",
  enabled: true,
  authorizeUrl: () => "https://x.com/i/oauth2/authorize",
  tokenUrl: () => "https://api.x.com/2/oauth2/token",
  scopeSeparator: " ",
  extraScopes: () => ["offline.access"],
  clientIdParam: "client_id",
  tokenClientAuth: "basic",
  clientSecretRequired: false,
  pkce: true,
  fallbackExpiresInSeconds: 7200,
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(xOAuth, runtime, account, credential),
  async identity({ http }, { credential }) {
    const { value } = await http.request("https://api.x.com/2/users/me", credential.accessToken);
    const id = String(value.data?.id ?? "");
    // A candidate without a numeric X user ID would be stored under an empty platform identity.
    if (!/^\d{1,25}$/.test(id))
      throw new Error("X identity could not be verified. Reconnect the account.");
    return {
      candidates: [
        {
          id,
          name: String(value.data?.username ?? value.data?.name ?? ""),
          credential,
        },
      ],
    };
  },
};
