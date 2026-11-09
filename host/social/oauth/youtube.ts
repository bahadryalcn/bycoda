import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";

export const youtubeOAuth: OAuthPlatformConfig = {
  platform: "youtube",
  enabled: true,
  authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: () => "https://oauth2.googleapis.com/token",
  scopeSeparator: " ",
  extraScopes: () => ["https://www.googleapis.com/auth/youtube.readonly"],
  authorizeParams: () => ({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }),
  clientIdParam: "client_id",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(youtubeOAuth, runtime, account, credential),
  async identity({ http }, { credential }) {
    const { value } = await http.request(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50",
      credential.accessToken,
    );
    const candidates = (value.items ?? []).map(
      (channel: { id: string; snippet?: { title?: string } }) => ({
        id: String(channel.id ?? ""),
        name: String(channel.snippet?.title ?? "YouTube channel"),
        credential,
      }),
    );
    if (candidates.length !== 1)
      throw new Error(
        "OAuth must identify exactly one selected YouTube channel. Reauthorize for the intended channel.",
      );
    return { candidates };
  },
};
