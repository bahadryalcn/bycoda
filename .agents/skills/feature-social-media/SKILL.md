---
name: feature-social-media
description: Social media task/workflow inventory for accounts, capabilities, project grants, campaigns, AI programs, drafts, inbox, audience, publishing plans, reply rules, sending controls, activity, approval and delivery truth. Read before social UI redesign or workflow changes.
---

# Social media tasks and presentation

## Purpose and scope

Help the user prepare content, review its exact consequence, handle incoming
conversations, configure recurring work and understand actual outcomes. Keep
account ownership, project grants, platform capability, consent and approval
distinct. Keywords: social, campaign, program, draft, post, inbox, audience,
contact, plan, rule, send, job, delivery, disclosure, AI settings, permissions.

Read `docs/reference/DESIGN.md`, desktop UI/Arc guidance and
`.agents/skills/feature-workbench-design/SKILL.md`. Source baseline inspected
2026-10-27: dirty shared `main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`.
Search roots: `src/features/social/`, `host/social.ts`, related `host/social-*`,
`tests/browser/social*`, shared UI and existing theme owners. Inspect recent
history/live feature claims before editing; this card is not a reservation.

## Surface inventory and audit completeness

The 14 owner captures and 36 findings are recorded in
`temp/local/2026-10-27-social-redesign/AUDIT.md`. Completed below means source/
supplied-image audit only; no product migration is marked complete.

| Family                                                                  | Actual UI / source owners                                                                                                                      | Audit / implementation state                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Computer/project shell, Host status, navigation and account actions     | `src/features/social/ui/SocialView.tsx`, `RetainedSocialPanel.tsx`, `useSocialWorkspaceFilter.ts`                                              | Supplied/source audit complete; UI migration pending.                                                      |
| Account connection, registration/recovery and capability/grant detail   | Inline account UI in `SocialView.tsx`; `SocialBrowserWorkspace.tsx`, `SocialAuthority.tsx`, `SocialRegistrationReview.tsx`, `socialShared.tsx` | Account/capability supplied; connection/registration error states need later captures.                     |
| AI/content policies and scope                                           | `SocialPolicySettings.tsx`, `SocialSetupEditor.tsx`; `src/features/social/model/socialPolicy.ts`                                               | Settings supplied; dirty/conflict/inheritance/provider/error checks pending.                               |
| Manual campaign collection/editor/check/review/schedule and brand facts | `SocialCampaigns.tsx`, platform publishing/media fields                                                                                        | Partial-sent detail supplied; manual editor/media-rich review require captures.                            |
| AI program creation/target generation/review/activation                 | `SocialPrograms.tsx`; `src/features/social/model/socialProgram.ts`                                                                             | First step supplied; later/incomplete/generated/active states source-inspected or inventoried.             |
| Drafts and bulk preparation                                             | `SocialDrafts.tsx`, `SocialBulkComposer.tsx`, `socialBulk.ts`                                                                                  | Source audit; populated batch/draft states need captures.                                                  |
| Inbox, threads, local reply and paged operation/contact history         | `SocialInbox.tsx`, `SocialHistoryPage.tsx`                                                                                                     | Empty Inbox supplied; populated/failed-save/stale selection states need captures.                          |
| People, segments, import and reply-rule editor                          | `SocialManagement.tsx`, `SocialMultiSelect.tsx`                                                                                                | Empty People/rules and rule form supplied; populated/consent/import/advanced modes need captures.          |
| Ordered publishing plans and scheduling                                 | `SocialPublishingPlans.tsx`                                                                                                                    | Creation supplied; stale revision, finite pool, completed prefix and activation states need acceptance.    |
| Sending state/polling and history                                       | `SocialSendingControls.tsx`, `SocialHistory.tsx`; `social-workspace.css`, `social-controls.css`, `social-programs.css`, `social.css`           | Sending/history supplied; real failure/uncertainty/receipt/platform-preparation states remain source-only. |

Paths without a prefix in the table are under `src/features/social/ui/`.
`src/features/social/model/social.ts`, `socialQuery.ts`, `socialWorkspace.ts`
and `socialContext.ts` in the UI own shared snapshot/query/selection contracts.
Do not copy one account format across all platforms or erase provider-specific
media, visibility, consent, processing and connection restrictions.

Host execution/authorization remains in `host/social.ts` SocialService and its
existing related services. Verified operation names include
`campaigns.approveReviewed`, `campaigns.schedule`, `programs.activate`,
`policy.get`, `drafts.approve`, `replies.send`, `messages.send`, `comments.send`,
`jobs.cancel` and `jobs.retry`. Approval/scheduling/dispatch are not aliases.
No new Host RPC, Rust command, stored entity or mobile runtime was introduced by
this audit. Existing local/remote Host ownership remains authoritative.

## Owner decisions

Source: T3 Code thread `0567326f-aade-4baa-89f3-b44c6256ae9e`, 2026-10-27.

- "Mesela Job details yazıyor accordion var tıklıyorum sadece oluşturulma tarihi var."
- "Zaten bunu direk yazsa daha az yer kaplıycak neden böyle olmuş ki."
- "Heryeri bu şekilde tamamen yeniden tasarlanıp yeni bir anlayışla yazılması gerekiyor bence ama sen uygun yola karar ver."

The owner delegates choice of a suitable redesign path. The selected target
below is agent design work under that instruction, not a fabricated owner quote
or a claim that the existing product has already migrated.

## Selected direction and migration map

Task-first destinations: Content, Inbox, Plans, Sends/Activity, Accounts and
Settings. People/segments remain a clearly named peer view within Inbox. Keep
computer-wide sending state visible and distinguish the project filter from
account/project grants and Host/platform policy.

One Prepare content entry supports writing, brief-based generation and prepared
content, while retaining separate campaigns/programs domain models. Use
content/brief → account variants → time/control → exact consequence review.
Existing/partially sent work leads with per-target results and valid next actions.

Activity uses compact dated operation rows and one readable detail region.
Created is inline. Diagnostic disclosure exists only when it adds meaningful
content. The model has no generic completed/cancelled timestamp; do not invent
one or rename Created/Dispatched to Sent/Cancelled. Dispatch acceptance,
recipient delivery/read and video processing/publication remain distinct.

Detailed target brief: `temp/local/2026-10-27-social-redesign/REDESIGN.md`.
Interactive prototype/evidence: `temp/verification/2026-10-27-social-redesign/`.
Prototype data is illustrative and has no live account/send connection.

## Behavior to preserve

- Host-isolated query/filter state, stale-result rejection, retained panels and
  independent unsaved drafts through Host/account/project/thread navigation.
- Separate platform support, account connection, project grants, contact consent,
  opt-out and send approval. A contact is not communication consent.
- Save draft without sending; exact-revision campaign approval then scheduling;
  program save-paused then confirmed revision-bound activation; reviewed draft
  snapshot approval followed by explicit reply/message/comment queueing.
- Content edits invalidate earlier review/approval. Preserve `expectedRevision`,
  frozen `reviewedDraft`, character/media checks and actual per-account variants.
- Idempotency, audit evidence, finite pool/completed prefixes, cooldowns, daily
  limits/stop phrases and paused/stop controls. Uncertain sends are not retried
  blindly; receipt failure must not create a new dispatch.
- Browser/OAuth registration review and connection recovery; distinguish action
  acceptance from a subsequent status-refresh failure, avoiding duplicate action.
- Keep local pending/duplicate guards, errors/retry and original inputs. Preserve
  policy inheritance, per-scope drafts and concurrent-update conflict handling.

## Checks and visual acceptance

Use existing unit families: SocialView, SocialPolicySettings,
SocialBrowserWorkspace, SocialCampaigns, SocialPrograms, SocialDrafts, socialBulk,
SocialHistory, SocialPublishingPlans, SocialInbox and SocialManagement; preserve
`host/social-delivery.test.ts` receipt evidence checks.

`tests/browser/social.spec.ts` covers history, plans, inbox and theme/large-text
fixtures. The old Created-hidden assertion at 2304-2311 encodes the presentation
being replaced; update it while preserving real behavior safeguards. Add focused
checks for browser action accepted/refetch failed, account-local navigation,
receipt failure under succeeded, and UI/Host cancellation eligibility parity.

Capture every affected family in light/dark at 1280/800, long translations,
keyboard/focus/touch and reduced motion. Include loading/empty/filtered/error,
saved/dirty/conflict, grant/capability blocks, invalid/incomplete steps, queued/
review/failed/cancelled/accepted/delivered/read/video-processing and partial results.
Use fake services/accounts for sends, approvals and cancellation. Keep fixture,
isolated Host, native, remote/mobile and installed acceptance separate.

## Known limits and coordination

Supplied screenshots are light-theme examples without verified current build
identity. Populated Inbox/People, manual editor, later AI steps, media-rich review,
bulk results, dirty/conflict and failed/uncertain dispatch remain unrendered here.
No product source, account operation, test/build/install or release was performed
by this audit/design phase. Current-source inclusion is UNKNOWN.

Live feature-claim RPC is not exposed in this T3 session; no cross-machine lock
was acquired. Preserve dirty shared checkout work and the separate menu/Servers
and inline-visual-reply plan items.

## Handoff references and proposals

Local uncommitted design/audit delivery on baseline
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. 36 findings and 10 surface
families are tracked; runtime migration is pending. No blanket backend rewrite,
new platform entitlement or real send is authorized by the visual direction.
Further capabilities beyond the preserved workflow remain separate proposals.
