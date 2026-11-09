# Provider setup and limits

- Email: presets for Gmail, Outlook/Hotmail, Yahoo, iCloud and custom IMAP/SMTP.
  `config.auth` is `password`, `google` (Gmail or custom) or `microsoft` (Outlook or
  custom); Gmail defaults to `google`, with an app password as the fallback. Google
  sign-in is browser OAuth (authorization code + PKCE, loopback redirect, XOAUTH2,
  scope `https://mail.google.com/`, restricted: public release needs Google
  verification and CASA). The client comes from `BYCODA_GOOGLE_CLIENT_ID` /
  `BYCODA_GOOGLE_CLIENT_SECRET` (build or runtime env) or the card's advanced fields;
  the client secret is sent with the sign-in start only and never stored. Yahoo and
  iCloud need an app password when 2-step verification is on. Microsoft accounts sign in with device-code OAuth (XOAUTH2) and need an Outlook-scoped
  token (`IMAP.AccessAsUser.All`, `SMTP.Send`). Only INBOX is scanned, newest messages
  first, so older conversations and sent copies are not shown.
- Slack: browser sign-in (PKCE, redirect `https://bycoda.codes/oauth/slack/` relaying to `http://localhost:47213/callback`, user token
  scopes) is primary; a workspace-installed bot token (`xoxb-`) is the fallback. Both use
  channels, groups, im and mpim read/history scopes, `users:read` and `chat:write`; the
  newest credential replaces the other. A bot sees only conversations it was added to.
  The client ID comes from `BYCODA_SLACK_CLIENT_ID` or the card's advanced field and is
  not stored. `SLACK_APP_MANIFEST` in the Slack module holds the scope list.
- Discord: a bot token plus explicit channel IDs. Reading message text needs the
  Message Content privileged intent. Direct messages are not listed (REST only, no
  gateway). Replies never ping anyone.
- Microsoft Teams: device-code OAuth with Graph `Chat.ReadWrite`, `User.Read` and
  `offline_access`. Requires an Entra public-client app registration with public client
  flows allowed; its client ID comes from `BYCODA_MICROSOFT_CLIENT_ID` at build time or
  the card's advanced field. Work tenants may require admin consent.
