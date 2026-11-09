import { refreshWithRefreshToken, type OAuthPlatformConfig } from "./oauth-platform";

export const linkedinOAuth: OAuthPlatformConfig = {
  platform: "linkedin",
  enabled: true,
  authorizeUrl: () => "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: () => "https://www.linkedin.com/oauth/v2/accessToken",
  scopeSeparator: " ",
  extraScopes: (accountType) => [
    "openid",
    "profile",
    ...(accountType === "organization" ? ["rw_organization_admin"] : []),
  ],
  clientIdParam: "client_id",
  tokenClientAuth: "body",
  clientSecretRequired: true,
  pkce: false,
  // shortcut: refresh runs only when LinkedIn returns a refresh_token for this app; whether it does is not verified live. Without one the account is reconnected by its owner.
  refresh: (runtime, account, credential) =>
    refreshWithRefreshToken(linkedinOAuth, runtime, account, credential),
  checkResource(accountType, resourceId) {
    if (accountType === "organization" && (!resourceId || !/^\d+$/.test(resourceId)))
      throw new Error("Supply the LinkedIn organization ID; OAuth will verify the admin role.");
  },
  async identity({ http, config }, { credential, resourceId }) {
    const { value } = await http.request(
      "https://api.linkedin.com/v2/userinfo",
      credential.accessToken,
    );
    if (resourceId) {
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
            item.organization === `urn:li:organization:${resourceId}`,
        )
      )
        throw new Error("LinkedIn organization admin role was not verified.");
      return {
        candidates: [
          {
            id: `urn:li:organization:${resourceId}`,
            name: `LinkedIn organization ${resourceId}`,
            credential,
          },
        ],
      };
    }
    return {
      candidates: [
        {
          id: `urn:li:person:${String(value.sub ?? "")}`,
          name: String(value.name ?? "LinkedIn member"),
          credential,
        },
      ],
    };
  },
};
