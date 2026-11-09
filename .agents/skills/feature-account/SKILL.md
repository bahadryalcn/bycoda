---
name: feature-account
description: "Change the optional bycoda account on the desktop: browser sign-in with PKCE, the OS-keychain token custody, device registration, the Account screen, the offline account cache and the anonymous-statistics switch. The account API contract belongs to packages/account-contracts; local active time belongs to the activity feature; the server is not in this repository."
---

# Desktop account

The account is optional. The app works fully signed out and sign-in is never required.
Native code in `src-tauri/src/account/` owns the Clerk OAuth application flow, the refresh
token (OS credential store only), refresh and revocation, and device facts. The UI in
`src/features/account/` owns the state machine, the non-secret cache, device registration,
the contract client with the `X-Bycoda-Device` header and the Account screen. The shared PKCE
and loopback primitives live in `src-tauri/src/oauth_loopback.rs` and are also used by
messaging browser sign-in. Host and mobile have no part in this feature.

## Source starts

- Native: `src-tauri/src/account.rs` (module root), `account/config.rs` (build-time endpoints and
  public client id), `flow.rs` (browser sign-in, one active flow), `session.rs` (token custody),
  `tokens.rs` (discovery, exchange, refresh, revoke), `keychain.rs`, `device.rs`,
  `commands.rs` (Tauri commands `account_*`, registered in `src-tauri/src/lib.rs`).
- UI model: `src/features/account/model/` (`accountController.ts` orchestrates,
  `accountState.ts` is the pure state machine, `accountCache.ts` the expiring cache,
  `accountClient.ts`, `accountNative.ts`, `accountMock.ts`, `accountPrivacy.ts`, `anonymousStats.ts`,
  `notificationSettingsModel.ts`, `supportTicket.ts`, `announcementFeed.ts`, `feedback.ts`, `feedbackDialog.ts`), hooks in `hooks/`,
  screen in `ui/AccountScreen.tsx` (tabs incl. `AccountSupport.tsx`; `FeedbackDialog.tsx`, opened by `openFeedbackDialog()`; `AccountNews.tsx` in Notifications).
- Public surface for other features: `src/features/account/index.ts`
  (`useAccountContext`, `isAnonymousStatsEnabled`, `AccountScreen`, `AnnouncementNotices`).
- Contract: `packages/account-contracts` (read-only for this feature).

## Workflow

1. Decide the owner: token or flow behavior is Rust; what the user sees and the API calls are TypeScript.
2. Change `account/*.rs` pure functions and their `*_tests.rs` first; keep I/O at the edges
   so refresh classification, state checks and timeouts stay testable offline.
3. Keep the `AccountNative` type in `accountNative.ts` and the command signatures in
   `commands.rs` identical.
4. New strings go through `t()` and into every locale catalog.
5. Run the focused checks below; live sign-in needs a configured Clerk client id.

## Preserve

- Tokens never leave Rust: the refresh token lives in the OS credential store, the access
  token only in memory, and the UI receives a short-lived access token per call. No token
  in files, logs, errors, the cache or the UI state.
- Sign-in is a public PKCE S256 client on `http://127.0.0.1:<random port>/callback`; a
  callback with another `state` is ignored, and the flow has a timeout and a cancel that
  frees the port.
- A rejected refresh token ends the session and is forgotten; an unreachable service keeps it.
- Signing out forgets tokens and the cached account view only. Sessions, projects, drafts
  and settings are never touched; the per-account device id survives sign-out.
- The account cache is non-secret, validated on read and trusted for seven days offline.
- Organizations are an extension point: `organizations` is always empty and the UI renders
  nothing for an empty list. No team features.
- Feedback carries only the typed message, kind, rating and, if ticked, version/OS context.
- Support tickets carry only what the user typed (subject, category, message); a failed or
  rate-limited send keeps the draft. Announcements are fetched only while signed in, never while
  offline, and a dismissal is remembered per id on this computer.
- No request carries session content, prompts, code, paths or project names.
- Anonymous statistics are off until the user says yes. The choice is `{ choice: on | off | null, decidedAt }`
  (`null` = never asked; the old boolean key migrates: true is yes, false is not asked). Every user
  is asked once: first-run onboarding step, or `StatsConsentNotice` (non-blocking, at most three
  showings, then off). `model/anonymousStats.ts` sends the strict contract `AnonymousPing` at most
  once per local day with a random, never regenerated install id; no token, no device header,
  silent failures, nothing when off, not asked or the API URL (from `account_status`, needs no
  sign-in) is missing. The switch lives in Account → Privacy & data and, for guests, Settings → Privacy.
- No deployment value (client id, issuer, API or portal URL) is hard-coded. They come from
  build-time variables (`BYCODA_*`, staging as `BYCODA_STAGING_*`, `BYCODA_ACCOUNT_ENV`
  selector, frontend `VITE_BYCODA_ACCOUNT_PORTAL_URL`); a missing value for the selected
  environment is `not_configured` and the app runs as a guest. Release builds ignore runtime
  endpoint overrides. Portal links come from `model/accountPortal.ts` and hide when unset.
  The variable list lives in the account guide and `.env.example`.

## Focused checks

- `cargo test --lib -- account:: oauth_loopback messaging::oauth` in `src-tauri/`.
- `pnpm exec vitest run src/features/account`, `pnpm exec tsc-rs --noEmit --fast`.
- Development without a backend: `VITE_BYCODA_ACCOUNT_MOCK=1`.

## References

- User behavior: [account guide](../../../docs/guides/account.md).
- Shared sign-in primitives and the messaging flow: [feature-messaging](../feature-messaging/SKILL.md).
- Structure rules: [code structure](../../../docs/reference/code-structure.md).
