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

## H7 source implementation, 2026-10-28

Supersedes audit-only implementation status for SOA01–12, SOC-C01–11 and
SOH01–13, not their runtime acceptance. Owner in current session
`28955f17-306b-4eee-b0e0-99d148ba36c3`, exact quote:
"Sosyal medya yeniden tasarımını uygula. Audit'i tekrarlama."
Package `2026-10-28-social-impl`; shared dirty main baseline
`4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`. Social sources were clean at start.
Source remains uncommitted; no build/install/release or installed inclusion.

- Accounts/shell/policy: named task destinations and peer Activity; the legacy
  Automations/history route shares one retained history owner. Account intent
  reaches content/history; project intent reaches verified facts without changing
  project authorization or the global filter. One capability representation
  groups common/other operations and keeps reasons/source. Identity, connection,
  platform support, project grants and approval remain separate. Settings names
  its computer and saved versus edited policy; No additional limit is qualified.
  Account/browser confirmed action success is separate from failed status reads.
- Content: one searchable Loaded content selector routes campaign:/program:
  identities to retained detail/composers, with honest partial-load/error/retry
  and visibility-controlled cached reads. Write/generate are task choices, not
  merged Host entities. AI changes are staged for readable review/application;
  concurrent configuration edits reject stale suggestions, exact structure is
  optional detail. Actual account grant/connection/format/media readiness and
  local step requirements are visible. Missing text-model health is not invented.
  Per-account fields stay mounted, required schedule/timezone is direct,
  existing target outcomes lead partially sent work and sent evidence stays
  immutable. Unsupported media previews retain exact properties. Draft/bulk
  recipients lead content and explicit approval adds the reviewed draft to the
  send queue; frozen batch/retry-only-failed behavior remains.
- Activity: compact dated rows and selected result, inline Created, optional
  meaningful diagnostics, direct error/uncertainty/recovery and full exact target/
  content/media/URL. Dispatch acceptance, delivery/read and platform processing
  remain distinct. Receipt failures are visible and never create another send.
  Current UI cancellation mirrors Host exclusions, including submitted Snapchat
  Spotlight/Facebook Reel, while Host remains authoritative. Contact event
  language is localized; recorded kinds/identifiers stay inspectable.
- Plans/replies/Inbox/People: bounded plan task editor with review and Save paused
  after schedule, retaining finite ordered pool/completed prefixes/revision
  activation. Rule account/project/verified-fact prerequisites precede optional
  AI overrides; facts detour closes/parks the form without discarding it. People
  empty states open the existing Add form or Import with JSON/1 MiB/permission
  explanation before file selection. Inbox owns polling state/control, local
  eligible refresh/clear actions, readable conversation identity and manual read
  retry; operation history no longer dominates the reading pane. Computer-wide
  sending remains a separate named control with original confirmation/stop gates.

No real platform/account/policy/credential/approval/send/retry/cancel operation
was executed. No Host/Rust/mobile/global shared control/theme change. Existing
service IDs, consent, expected revisions, exact reviewed content, platform
options, queued work and Host isolation remain authoritative. Missing en/tr keys
were appended only. Native subagents used disjoint source ownership; root
integrated shared feature presentation/CSS and independently reviewed changes.
Claims API unavailable; project sessions/clean Social starting state inspected.

Every record **test edilmedi**. RULES.md forbids suites, fixtures/dev servers and
screenshots tonight. Root ran one `pnpm exec tsc-rs --noEmit --fast` compiler
stage because check:web:fast also runs Vitest. One missing required inline prop
was corrected afterward with inline=false; no rerun or clean final pass claimed.
Morning acceptance: social suite/focused account/browser/policy/campaign/program/
draft/bulk/history/plan/rule/Inbox/People checks, light/dark 1280/800/narrow,
long data, keyboard/touch/reduced motion and partial/failed/uncertain states.
Update obsolete browser expectations that hide Created while preserving safety
assertions. Fake services only for mutations; native/installed/publication proof
remains separate.

Concrete API limits: Host does not serialize cancellation eligibility/reason
(`host/social.ts`, jobs.cancel); current frontend predicate mirrors it and needs
future shared authority to prevent drift. ProgramFeatures exposes image/provider
and account-format metadata, not text-model health; UI says health is checked at
generation. No unsupported readiness is claimed. Full 36-ID ledger, source
fingerprints, checks and next actions:
`temp/local/2026-10-28-social-impl/handoff.json`.

## VIS-007 daily-work and AI-assistant pass, 2026-10-30

Source: owner request in the 2026-10-29 UI refinement run (TODO `VIS-007`). Uncommitted
shared-checkout work; fixture evidence only (`temp/verification/vis-social/`), no live
provider/platform/account contact, no build or install.

- Landing: **Today** is the default destination (`SocialToday.tsx`, `useSocialToday.ts`,
  `model/socialAttention.ts`). Rows come only from section reads made for the view
  (`client.sectionSnapshot`, separate from the workspace cursor) and `programs.list`; a
  loading/failed read is named, never an all-clear. Account connection, platform
  authorization, pause and project access stay separate rows.
- Context: one header location for computer and project filter; a single connected
  computer is plain text, not a selector.
- AI assistant (`SocialAssistant.tsx`, `model/socialAssistant.ts`): reuses Host
  `programs.suggest` (stores nothing) and `programs.configure` (always saved paused, one
  idempotency request id per proposal, revision-bound for edits). Context is the selected
  computer/project/accounts with draft access, the saved brand voice and verified facts the
  owner keeps enabled, and the effective text agent from `policy.get`. Review shows what will
  be created or the changed fields, warns when review steps or facts were reduced, allows
  editing name/topic/description or discarding, and the accepted record opens in the existing
  campaign screen. Progress/stop-waiting/error/retry are local; activation, sending,
  credentials and approvals are untouched. No Host endpoint exists for AI-drafted plans,
  reply rules, reply suggestions, bulk edits or product-fact drafting, so those are not
  offered.
- Product knowledge (`ProductKnowledge.tsx`): summary row on the content screen; profile,
  brand voice and verified facts managed in their own dialog with drafts kept while closed;
  project intents open it in context.
- Contacts import: JSON only. Rows are mapped to the fields the Host reads, validated and
  previewed; invalid rows are skipped by the owner's choice before the atomic Host import;
  consent/eligibility never come from a file (`model/socialContactImport.ts`).
- Account disconnect uses the shared `ConfirmDialog`; the Host keeps the account entry,
  grants and history, removes the saved sign-in and pauses the account.
- Inbox shows one auto-refresh control; campaign post results lead only when something was
  dispatched or needs recovery.

## VIS 2026-10-30 (waves 5-7, uncommitted at time of writing)

- Owner-only, draft-only Host bridges (request-id idempotent, untrusted input quoted,
  never send/activate/change consent): `replies.suggest`, `plans.suggest`,
  `rules.simplify`, `facts.suggest`, `contacts.suggestTags` (`host/social.ts`,
  `host/social-suggestions.ts`, `host/social-generation.ts`; tests in
  `host/social*.test.ts`). Not in `SOCIAL_TOOLS`.
- Review UIs: `PlanSuggestion.tsx` (accept -> unsaved draft on Review step, saved
  paused by owner), `RuleSimplifyReview.tsx` (accept -> new paused rule; original
  untouched unless "Pause the original rule too"), `FactSuggestions.tsx` (accept ->
  draft row, verified only on save), `ContactTagSuggestions.tsx` (import draft or
  `contacts.upsert` tags only).
- Stepped plan/rule dialogs (shared `Stepper` + Modal footer slot via
  `SocialDialog`/`ComposerActions`); Content entries Write / Generate from a brief /
  Edit existing with a truthful context line; preview -> check -> approval -> next.
- Shared `ModelPicker` through `SocialModelField.tsx` (`presentation="field"`,
  inherit choice). React Compiler lint clean in `src/features/social`.
- Evidence: `temp/verification/vis-social*/`; social.spec 52/52 (private build).
  Live provider/platform and native app not exercised.

## UI standards round 2026-11-01 (uncommitted)

Round reference: owner request "tamam düzeltmelere başla lütfen hepsini" (2026-11-01, owner chat); primitives and rules in `docs/reference/ui-component-catalog.md` and `ui-design-system.md`. Source only, uncommitted on `main`; nothing built or installed.

Social (`src/features/social/**`), from `HANDOFF-w2-tools.md` (sub-agent F). Existing `social.spec.ts` was not run (off-limits).

- Done: blanket `input/textarea/select` rules removed from `social.css` and `social-programs.css`; status variables to `--ui-tone-*-fg`; `SocialView` header on `PaneHeader`; eleven `type="number"` fields to `NumberField`; date/time fields on `DateTimeField` in PlanSuggestion, ProgramSetupForm, CampaignComposer, SocialManagement and SocialHistory (explicit `Number.isFinite(startsAt)` submit guard); 17 `role="alert"` paragraphs to `InlineError`; `Notice kind="loading"` to `LoadingText`.
- Left: SocialView nav and automation-mode switchers stay buttons (unit tests assert `aria-current`; `social.spec.ts` uses `.social-tabs`); SocialBrowserWorkspace birth date stays a native date field (the picker pages month by month); ProgramDetailPanel reschedule needs a "Reschedule" button first; `socialShared.tsx` `createPortal` into the Modal footer/content slot.
- Unverified: `tests/browser/social.spec.ts` needs shared field selectors for time/datetime inputs; no screenshots or native run.
