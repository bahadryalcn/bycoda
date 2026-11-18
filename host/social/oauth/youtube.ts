import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";
import { YOUTUBE_READ_SCOPE } from "../../../src/integrations/social/youtube-analytics";

export const youtubeOAuth: OAuthPlatformConfig = {
  platform: "youtube",
  enabled: true,
  authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: () => "https://oauth2.googleapis.com/token",
  scopeSeparator: " ",
  // The selected operations request Analytics or monetary scopes on demand.
  // Channel identity and Analytics reports also require the Data API read scope.
  extraScopes: (_accountType, current) =>
    current.includes(YOUTUBE_READ_SCOPE) ? [] : [YOUTUBE_READ_SCOPE],
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
  async identity({ http }, { credential, token }) {
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
    const scopes =
      typeof token.scope === "string" ? [...new Set(token.scope.split(/\s+/).filter(Boolean))] : [];
    return { candidates, scopes };
  },
};
