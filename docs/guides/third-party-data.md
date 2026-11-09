# Third-party services and data controls

Last updated: 9 November 2026

## Choose what you connect

The maintainer does not run a central store for your workspace content. If you create an optional bycoda account, limited account, device and active-time data is held as described in the privacy policy, with the providers listed in the next section. Connected services receive data when their features run and have their own rules. Consult the privacy and account settings for the actual provider, CLI, MCP server, custom endpoint or self-hosted service you use; this list is not exhaustive.

## bycoda account service providers

Only used if you create a bycoda account (or use the bycoda website). Our servers are in the European Union; several providers below are US companies, so data may be processed outside Turkey and the European Economic Area under their standard contractual terms (see the privacy policy, "Transfers abroad").

- Clerk (identity and sign-in): [privacy policy](https://clerk.com/legal/privacy).
- Cloudflare (network and security): [privacy policy](https://www.cloudflare.com/privacypolicy/).
- Hostinger (server hosting, EU): [privacy policy](https://www.hostinger.com/legal/privacy-policy).
- Expo (mobile push notifications): [privacy policy](https://expo.dev/privacy).
- Resend (transactional email): [privacy policy](https://resend.com/legal/privacy-policy).
- Our own mail server (Mailu on our Hostinger VPS): fallback delivery of the same transactional e-mails when Resend is unavailable, and receiving mail sent to bycoda.codes addresses.
- Umami (website statistics): self-hosted by the maintainer, cookieless; no third party receives the data.
- Sign-in with Google or GitHub: you authenticate with the provider, which shares your name, email address, profile picture and account identifier with Clerk, and never your password. They act under their own policies ([Google](https://policies.google.com/privacy), [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)). Disconnect them under Security at account.bycoda.codes or in the provider's account settings.
- Apple sign-in, where offered: [privacy policy](https://www.apple.com/legal/privacy/). Facebook sign-in, where offered: see the Meta link below.

## Provider privacy links

- OpenAI / Codex: [privacy policy](https://openai.com/policies/privacy-policy/).
- Anthropic / Claude: [privacy policy](https://www.anthropic.com/legal/privacy).
- Google / Gemini / YouTube: [privacy policy](https://policies.google.com/privacy).
- GitHub / Copilot / releases: [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- GitLab: [privacy statement](https://about.gitlab.com/privacy/).
- Atlassian / Jira: [privacy policy](https://www.atlassian.com/legal/privacy-policy).
- Linear: [privacy policy](https://linear.app/privacy).
- Microsoft / Azure DevOps: [privacy statement](https://privacy.microsoft.com/privacystatement).
- Meta / Facebook / Instagram: [privacy policy](https://www.facebook.com/privacy/policy/).
- X: [privacy policy](https://x.com/en/privacy).
- LinkedIn: [privacy policy](https://www.linkedin.com/legal/privacy-policy).

Provider policies and account configurations can change. bycoda does not set their retention, model-training practices, locations of processing or charges.

## Stop access and remove data

Stop relevant tasks and disconnect unused integrations. Revoke permissions or tokens in the service's account settings as well as disconnecting in bycoda. Google / YouTube authorization can be revoked through [Google account permissions](https://security.google.com/settings/security/permissions).

Social disconnection removes the local stored token and pauses the account. It retains account metadata and stored social records. The Social Audience screen can export one person's records as JSON and delete them; deletion keeps a minimal suppression record so the person is not contacted again. It does not delete posts, comments or videos already published, or revoke the provider's authorization by itself. Manage those through the platform. YouTube features use YouTube API Services and are subject to the [YouTube Terms of Service](https://www.youtube.com/t/terms).

Delete conversations and other records with their available controls. Hiding and archiving retain data. Local databases, webview preferences, diagnostic logs, provider CLI history and host copies are separate stores. Uninstalling does not guarantee their removal. For a complete reset, stop the application and host, back up required data and remove their application data, including bycoda.db and the social credential vault where present. Also review provider storage, other paired devices and backups. Removing application data can erase all local sessions and settings; do not delete project folders merely to reset application preferences.

Requests about information voluntarily shared with the maintainer can be sent to [info@bycoda.codes](mailto:info@bycoda.codes). The maintainer has no remote access to your devices and cannot erase your local data or third-party records on your behalf.
