---
name: feature-social-media
description: "Change Social accounts, content, inbox, plans, AI programs and activity while preserving policy, account/Host scope, drafts and explicit sending authority."
---

# Social media workflow changes

## When and scope

Use for Social product workflows and their Host operations. Distinguish platform support, account connection, project grant, machine sending policy and per-operation consent. UI restyling or a draft never grants send authority.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/social/ui/SocialView.tsx` and neighboring Content/Inbox/Plans/Accounts/Activity surfaces: workspace and workflow composition.
- `src/features/social/`: models, policy, bulk results, drafts and workflow state.
- `host/`: search the exact social operation name and provider route before changing account/policy/publishing behavior.
- `docs/integrations/social.md`, `docs/integrations/social-programs.md`: existing API/workflow contracts.

## Preserve

- Program interval jitter includes stable program identity; previews of saved programs use that same identity. Accepted occurrences and publication receipts retain their existing identity.
- Feature-only Codex discovery coalesces its original pending probe and briefly caches a cloned snapshot. Explicit refresh remains available; generation capability and actual image generation retain fresh checks and existing authority gates.
- Query relevant Social jobs through indexed scopes or explicit pages. Preserve exact receipt and pending/unknown identities; legacy full-history calls and durable evidence need explicit migration or archival contracts before eviction.
- Meta/LinkedIn comment polling requests an indexed two-publication Host page only after its original pending comment batch drains. Persist its exact job-key continuation with provider cursors; never replace legacy pending post IDs or turn connection changes into accepted inbox data.

- `host/social/social-credentials.ts` preserves encrypted vault bytes on read/decrypt/schema failures. Sync ciphertext and exclusive Windows key creation before acknowledging persistence; a failed save may be retried after repair but never authorizes replacing unreadable credentials with an empty vault.

- Keep Host/account/project/thread identity, isolated queries, stale-result rejection, retained panels and independent drafts across navigation.
- Project-independent Assistant account access is owner-granted per account and defaults to denied. Bind the real Room, Host, device, exact account and grant version; revoke or change invalidates issued access. Discovery exposes only read-granted account identity metadata. Account-scoped tools see only unassigned conversations on that account; personal drafts retain that account/thread and never use project facts.
- Account grant changes hold access denied while any retained voice generation is retired on its original device. Persist the requested permissions and held state across restart; retry needs signed exact-generation closure before the change commits.
- Personal replies still require owner review of the exact draft and the existing send, policy, capability, consent and uncertain-delivery gates. Assistant grants never approve or dispatch a send. Preserve platform restrictions on AI use and recheck draft identity, account and policy after waits.
- Capability, configured connection, verified account, project access, sending enabled and approval are distinct facts; preserve their effective-policy gates.
- Draft/AI suggestion/preview prepares content only. Sending, activating rules and changing consent require their existing explicit authority.
- Keep exact consequence review, media/context identity, idempotent request IDs, partial batch successes and uncertain-result recovery; never resend blindly.
- Preserve people/segments access, scheduling, campaigns/programs, reply rules and activity inspection when simplifying navigation.
- Public/browser/API modes and platforms differ. Do not advertise one adapter capability as universal provider support.
- YouTube API polling reserves a newest-thread read while historical pages or replies drain. Preserve the saved backlog cursor and bounded reply queue; repeated event IDs are deduplicated by Host ingest. A newest-page refresh is not complete reply-history coverage.

## Workflow

1. Map the requested workflow to its selected Host/account/project and actual operation/policy implementation.
2. Trace all editor/review/bulk/recurring entry points sharing the operation; keep local draft and per-target result state.
3. Exercise supported/unsupported, denied/allowed, failed/partial and ambiguous outcomes with isolated data; use existing policy tools before any authorized external write.

## Focused checks

Run affected Social suites, starting with `pnpm exec vitest run src/features/social/ui/SocialView.test.ts src/features/social/ui/SocialPolicySettings.test.ts` and changed draft/inbox/planning models.
Inspect populated/empty/long content, account switches during requests, recurring work, media review and partial bulk recovery. Provider mocks/fixtures do not establish live platform or send acceptance.

## Read when needed

- [Social integration](../../../docs/integrations/social.md) for account modes, APIs, project access and approvals.
- [AI programs](../../../docs/integrations/social-programs.md) when changing campaigns, models or scheduling.
