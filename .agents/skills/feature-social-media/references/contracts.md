# Social contracts

Full invariant list for Social changes. The entry `../SKILL.md` keeps a summary; when a change
touches one of these rules, keep the rule's full meaning here.

## Preserve

- Autonomy: every action has a level (`suggest` default, `approve`, `autonomous`), set per account and action. Only the owner sets `autonomous`. The owner principal never takes the autonomy path. An AI principal at `autonomous` runs within daily limits, working hours, suppression, the AI stop and the global send stop. Platform limits and the capability check still apply.
- Suppression is the single send gate for every outbound path. Resolve the target before comparing it with suppression records. A new outbound path must call that gate, not a copy of it.
- Consent is informational data. Do not add a per-contact consent gate to outreach. Imports and list changes never grant consent.
- NEEDS_HUMAN: captcha, verification, suspicious-login and login screens are recognized and reported. No code path clicks, types or solves them, including the decision layer and the desktop layer. The desktop layer runs only when the owner is away on another computer and the step is not outreach.
- Browser windows are hidden by default; visibility is per account and owner-chosen. Live view stays capped and idle-stopped.
- Driver order: free official API first; browser only where no free API supports the operation, and only before a send is submitted. An uncertain API result is never retried through the browser.
- Program interval jitter includes stable program identity; previews of saved programs use that same identity. Accepted occurrences and publication receipts retain their existing identity.
- Feature-only Codex discovery coalesces its original pending probe and briefly caches a cloned snapshot. Explicit refresh remains available; generation capability and actual image generation retain fresh checks and existing authority gates.
- Query relevant Social jobs through indexed scopes or explicit pages. Preserve exact receipt and pending/unknown identities; legacy full-history calls and durable evidence need explicit migration or archival contracts before eviction.
- Meta/LinkedIn comment polling requests an indexed two-publication Host page only after its original pending comment batch drains. Persist its exact job-key continuation with provider cursors; never replace legacy pending post IDs or turn connection changes into accepted inbox data.
- `host/social/social-credentials.ts` preserves encrypted vault bytes on read/decrypt/schema failures. Sync ciphertext and exclusive Windows key creation before acknowledging persistence; a failed save may be retried after repair but never authorizes replacing unreadable credentials with an empty vault.
- Keep Host/account/project/thread identity, isolated queries, stale-result rejection, retained panels and independent drafts across navigation.
- Project-independent Assistant account access is owner-granted per account and defaults to denied. Bind the real Room, Host, device, exact account and grant version; revoke or change invalidates issued access. Discovery exposes only read-granted account identity metadata. Account-scoped tools see only unassigned conversations on that account; personal drafts retain that account/thread and never use project facts.
- Account grant changes hold access denied while any retained voice generation is retired on its original device. Persist the requested permissions and held state across restart; retry needs signed exact-generation closure before the change commits.
- Capability, configured connection, verified account, project access, sending enabled, autonomy level and approval are distinct facts. Preserve their effective-policy gates and reason codes; do not show one adapter capability as universal provider support.
- Draft, AI suggestion and preview prepare content only. Sending, activating rules or programs, and changing autonomy require their existing explicit authority. Session tools never hold owner-only operations (people delete/export, audience import, autonomy set, policy save, program activation, browser workflow methods).
- Keep exact consequence review, media/context identity, idempotent request IDs, partial batch successes and uncertain-result recovery; never resend blindly. Rate-limit retry exhaustion goes to review, not automatic resend.
- Recheck draft identity, account, policy and suppression after waits and before dispatch.
- Personal data: person delete and export are owner-only and go through the audience operations; delete keeps a minimal suppression record.
- YouTube API polling reserves a newest-thread read while historical pages or replies drain. Preserve the saved backlog cursor and bounded reply queue; repeated event IDs are deduplicated by Host ingest. A newest-page refresh is not complete reply-history coverage.
