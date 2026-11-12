---
name: feature-messaging
description: "Use when changing email, Slack, Discord and Teams accounts and messages. Not for work-item accounts; see feature-inbox-settings."
---

# Messaging integrations

Messaging lets a user connect several messaging accounts, read their recent
conversations in the Inbox Messages source and reply from bycoda. Native code in
`src-tauri/src/messaging/` owns credentials, provider protocols and sending; the UI in
`src/features/messaging/` owns the Messages view; Settings > Integrations
(`src/features/settings/ui/integrations/`) owns account setup. Host and mobile have no
messaging surface yet.

## Source starts

- Native: `src-tauri/src/messaging.rs` (module root), `src-tauri/src/messaging/commands.rs`
  (Tauri commands and dispatch), `src-tauri/src/messaging/store.rs` (accounts and secret files), `src-tauri/src/messaging/types.rs`
  (shared shapes), one module per provider (`src-tauri/src/messaging/email`, `slack`, `discord`, `src-tauri/src/messaging/teams`) and
  `src-tauri/src/messaging/microsoft.rs` (device-code OAuth shared by Teams and Outlook mail), `src-tauri/src/messaging/oauth.rs` (browser
  sign-in for Gmail and Slack).
- UI contract: `src/features/messaging/model/messagingTypes.ts`, `src/features/messaging/model/messagingApi.ts`; public
  exports in `src/features/messaging/index.ts`.
- Offered providers: `src/features/messaging/model/messagingProviders.ts`
  (`ENABLED_MESSAGING_PROVIDERS`) gates Settings cards, search, the Inbox connect menu and
  the Messages provider filter; paused providers keep their code and saved accounts. Paused
  email presets live in `emailPresets.ts`.
- Messages view: `src/features/messaging/ui/`, hooks in `src/features/messaging/hooks/`,
  mounted from `src/features/inbox/ui/InboxView.tsx` as a source tab.
- Settings: `src/features/settings/ui/integrations/` (`BrowserSignIn.tsx` and
  `MicrosoftDeviceSignIn.tsx` run the sign-in flows), search entries in
  `src/features/settings/model/integrationsSettingsIndex.ts`.

## Workflow

1. Change a shape in `types.rs` and `messagingTypes.ts` together; both are the contract.
2. Add provider behaviour behind the five provider functions (`normalize_config`,
   `verify`, `list_threads`, `thread_messages`, `reply`); keep pure mapping functions
   separate from HTTP or socket I/O so tests stay offline.
3. Run the focused checks below; live provider behaviour needs a real test account.

## Preserve

- Secrets (passwords, bot tokens, OAuth tokens) stay native. The UI sees account views,
  threads and plain-text messages only; errors never echo a secret.
- Saving validates before writing. A failed save keeps the previous account, secret
  and the user's draft; an empty secret field on edit keeps the stored value.
- Sign-in tokens (Microsoft device flow, browser sign-in) are read, not consumed, until an
  account save succeeds; the UI only passes the finished handle as `authHandle`. The UI
  opens the browser sign-in URL with `openExternal` and cancels a pending handle on
  cancel or unmount.
- Reading never changes server state: IMAP uses EXAMINE and BODY.PEEK; no read markers.
- Replies are explicit user actions. One `requestId` per draft dedupes retries natively.
- Message bodies are plain text; HTML is converted natively and never rendered.
- Thread ids are validated before they reach URLs or IMAP commands.
- Every network call has a deadline; rate limits are honoured once when short.
- Messages refresh only while the view is visible and the window is focused.

## Focused checks

- `cargo test -p bycoda --lib messaging::`
- `pnpm exec vitest run src/features/messaging src/features/settings/ui/integrations src/features/inbox`
- `node scripts/i18n/check-locales.mjs`

## References

- [Provider setup and limits](references/providers.md) when changing auth, scopes or
  provider limits.
- [Inbox settings](../feature-inbox-settings/SKILL.md) for the work-item provider cards
  that share the Integrations section.
