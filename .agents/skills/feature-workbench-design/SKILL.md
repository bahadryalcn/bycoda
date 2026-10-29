---
name: feature-workbench-design
description: Workbench clarity inventory for structural pane boundaries, main/project menus, session statuses, Servers/SSH, composer context, transcript activity, provider subagents, background commands, titles, badges, local feedback and shared UI. Read before broad workbench simplification or visual repair.
---

# Workbench design and clarity

## H4 Explorer/content follow-up, 2026-10-28

The second H4 packet implements Explorer/file editor/preview consumers; its full
surface checklist and acceptance limits are in
`temp/local/2026-10-28-explorer-content-impl/handoff.json`. Sidebar's keyed root,
workspace/session separation and stored layout remain intact. Source-only,
uncommitted baseline `4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`; no audit closure,
build, installation or runtime acceptance is implied. Test edilmedi per nightly
RULES.md. H6 owns sessions Markdown and H5 owns Git/diff consumers.

## H4 implementation, 2026-10-28

Uncommitted on `main`, baseline `c03fa98d4819494a53ebfa61ff74320105bd05fc`.
Sidebar/TitleBar pane edges consume the theme's panel/border roles. Sidebar,
ProjectRail, TitleBar, recents, recovery, rail headers and SurfaceTabs consume
the existing ActionHost/InlineAction contract. Detailed session titles lead;
expanded folders do not imply selection. Main/project menus retain action IDs,
native routing and permission gates through public menu adapters.
Counts, warnings and dirty-file state remain independent of action reveal.

Per-surface scope, source fingerprints, dependencies and morning checks:
`temp/local/2026-10-28-h4-workbench/handoff.json`. Source implementation only;
test edilmedi. RULES.md owner instruction postpones tests, fixtures, screenshots
and native checks; only one final `pnpm check:web:fast` is permitted.
Explorer/Git redesign and Servers/SSH remain separate owners. Shared text inset
actions and ActionHost long-press presentation remain H1 dependencies. No build,
installation, release or runtime acceptance is implied. User guide:
`docs/guides/workbench.md`.

## Purpose and keywords

Make the current task, content, actions and execution location immediately
understandable. Compact tools/lists and more open reading/forms share one product
language. Fewer decorative boxes must retain clear structural and interaction
boundaries. Keywords: clarity, hierarchy, border, card, copy, composer footer,
subagent sheet, background script, activity, title, badge, density, clutter.

Read `docs/reference/DESIGN.md`, `ui-design-system.md`, `arc-ui.md` and
`ui-component-catalog.md` under `docs/reference/`. This card coordinates the
cross-feature presentation scope; the existing chat-composer, sessions-sidebar,
projects, managed-workspaces and tasks-goals cards retain lifecycle ownership.

Inventory inspected 2026-10-27 at baseline
`0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`, dirty shared `main`. Search roots:
`src/app/shell/`, `src/app/workspace/layout/`, `src/features/sessions/`,
`src/features/workspace/`, `src/features/workspaces/`, `src/features/tasks/`,
`src/shared/ui/`, `src/styles/`, `tests/browser/`. Source inventory is not a
claim that the dirty source is installed or every candidate is a defect.

## Surface inventory and completeness checklist

Audit status describes evidence; every runtime repair below remains pending.
All paths are repository-relative.

| Surface / source                                                                                                                                 | Audit evidence                                      | Repair and acceptance                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pane structure: `src/app/shell/ProjectRail.tsx`, `Sidebar.tsx`, `TitleBar.tsx`                                                                   | Owner screenshots + source                          | Pending: distinct resting pane/resize boundaries; expanded/compact/hidden.                                                       |
| Folder/session rows: `Sidebar.tsx`, `sessionList.css`                                                                                            | Owner screenshots + source                          | Pending: expanded/selected/drop-target distinction, title-first hierarchy, persistent density.                                   |
| Titles: `src/features/sessions/model/session.ts:847`, sidebar and title bar consumers                                                            | Owner screenshots + source                          | Pending: useful generated title across tabs/recents/recovery/attention; preserve user names.                                     |
| Counts/status: sidebar rows and `src/shared/ui/Badge.tsx`, Arc badge adapter                                                                     | Owner screenshots + source                          | Pending: named populations, quieter historical states, explicit approval/failure recovery.                                       |
| Attention: `src/features/sessions/ui/LiveAgentsPreview.tsx`                                                                                      | Owner screenshots + source                          | Pending: distinct summary/list purpose; preserve cross-project navigation and relocation.                                        |
| Global footer: `src/app/shell/UsageFooter.tsx`, `UsageProviderChip.tsx`, `WorkspaceControls.tsx`, `src/app/workspace/layout/WorkspaceFooter.tsx` | Owner screenshots + source                          | Pending: quota/app/conversation grouping and separate refresh targets.                                                           |
| Writing/context: `src/features/sessions/ui/Composer.tsx`, `ComposerTips.tsx`, `ContextMeter.tsx`, `ModelPicker.tsx`                              | Owner screenshots + source                          | Pending: clear writing/help/context hierarchy, model/account/effort, informational meters.                                       |
| Workspace state: `src/features/workspace/ui/WorkspacePicker.tsx`, `src/features/workspaces/ui/WorkspaceCreationStatus.tsx`                       | Owner screenshots + source                          | Pending: understandable exclusions/blockers; retain exact identity, retry and current-checkout recovery.                         |
| Existing-chat and queue/recovery: `src/features/sessions/ui/SessionPane.tsx`, `Composer.tsx`                                                     | Source only                                         | Pending: blocking questions, activity, queue and input hierarchy; no unknown-delivery auto-resend.                               |
| Activity summary: `src/features/sessions/ui/ActivityDock.tsx`, `src/features/sessions/model/activityDock.ts`                                     | Source only                                         | Pending: agent/command semantics, stop errors/localization; optional figure decision recorded below.                             |
| Transcript and inline agents: `src/features/sessions/ui/AgentTranscript.tsx`, `chat-controls.css`                                                | Source only                                         | Pending: one meaningful containment per level, bounded command summaries, request/result/history identity.                       |
| Tool inspection: `src/features/sessions/ui/ToolInspectionPanel.tsx`, `src/features/sessions/model/toolInspection.ts`                             | Source only                                         | Pending: shared detail anatomy; preserve JSON/diff/truncation/copy and historic data.                                            |
| Agent sheet/relay: `src/features/sessions/ui/SubagentSheet.tsx`, `SubagentSheet.module.css`, `useSubagentRelay.ts`                               | Source only                                         | Pending: dominant reading region, compact local input, honest accepted/unconfirmed/rejected delivery and copy timing.            |
| Background command details: `CommandDetails` inside `SubagentSheet.tsx`                                                                          | Source only                                         | Pending: operation/status/cwd/output hierarchy and local actions; command lifecycle remains distinct.                            |
| Host task preview: `src/features/tasks/ui/TaskSessionSheet.tsx`, `TasksView.tsx`                                                                 | Source only                                         | Pending: conversation/result versus operational blocks; retain Open in Sessions and target identity.                             |
| Shared controls/theme: `src/shared/ui/`, `src/styles/`                                                                                           | Representative source review + mechanical inventory | Pending: source-owner consolidation and representative consumers; candidate counts are not accepted migrations.                  |
| Quick/specialized/Inbox composers and remaining feature screens                                                                                  | Source-indexed / no supplied captures               | Pending: per-feature source/capture expansion before implementation acceptance. Native mobile remains a separate implementation. |

No new Host RPC, tool, Rust command, persistence key or execution authority was
introduced by this audit. Existing workspace/relay/task permission and recovery
contracts remain owned by their feature cards. `BackgroundSessionDialog.tsx`
was excluded from active UI defects because no production caller was found;
confirm an entrypoint before migrating it. Crews and provider subagents are not
interchangeable features.

## Owner decisions

Source: T3 Code thread `0567326f-aade-4baa-89f3-b44c6256ae9e`, 2026-10-27.

- "Kompakt araçlar, ferah içerik (önerim)"
- "Daha az kutu ve kenarlık (önerim)"
- Additional reading choice: "Kısa özet, ayrıntılar açılır (önerim)"
- Additional activity choice: "Tek sade durum göstergesi; figür isteğe bağlı (önerim)"
- Clarification: "Ayrım yerleri filan daha net olması gerekiyor."
- Problem evidence: "bu chat ekranının altını bile anlamıyorum bazen."
- Sequence: "İlk olarak tüm eksikliklerim,izzi componentlerdeki sıkıntıları hataları kötü yerleri yeni anlayışımızı netleştirdikten sonra düzeltmemiz gerekiyor"
- Inline visual replies plan: "tamam bunuda planımıza ekle ozaman bende o sırada diğer ekranları ve gene ekranlarıda atayım"
- Scoped menu/Servers audit: "İlk olarak bu 2 alan üzerinde audit çıkar subagentlar ile"
- SSH tab report: "mouse whell e tıkladığımda kapatmıyor bile hiç bir yardımcı yok"

The later clarification makes clear boundaries a requirement while preserving
the earlier preference against decorative containment. It does not authorize
removing functionality, forcing new appearance defaults or bypassing gates.

## Behavior to preserve

Preserve draft/attachment/model/provider/account/effort ownership, custom values,
stored density/fonts/scale/layout, meaningful labels, native focus/keyboard/drag,
permission/approval gates, real async pending and duplicate guards, execution
identity, historical output, cancellation, retry and recovery. Keep excluded local
changes visible in understandable language. Unknown delivery must not auto-resend;
relay acceptance must not be presented as confirmed delivery. Keep independent
agent drafts, exact commands/copy and complete result/history access.

## Checks and visual scenarios

Before source work, check live claims and recent feature history; this card is
not a concurrency lock. Migrate shared owners and affected consumers together.
Run focused behavior checks after relevant source changes. For visual-only
changes, use actual captures rather than source-shape tests.

- Light/dark at 1280/800 for all affected surfaces, plus short relay panes and
  narrow container controls; open the captures and fix observed defects.
- Expanded/compact/hidden navigation; all session row densities; 0/1/many
  working/failed/approval/done states; long Turkish titles/branches and attachments.
- New/existing/current/new-worktree/removed workspace; remote and older Host;
  checking/failure/retry/excluded changes; Send/Queue/Steer/Stop and retained drafts.
- Running/done/failed/stopped agent and command; output-empty/streaming/truncated;
  prompt/result/history; JSON/diff; relay blocked/unconfirmed/rejected; copy/stop
  pending/failure/retry; pane resize, keyboard focus return and reduced motion.
- Existing browser entrypoints: `compact-navigation.spec.ts`,
  `session-usability.spec.ts`, `group-menu.spec.ts`,
  `project-workspace-navigation.spec.ts`, `session-recovery.spec.ts`,
  `subagent-relay.spec.ts`, `chat-artifacts.spec.ts` under `tests/browser/`.
- Existing unit families: ActivityDock/activityDock, SubagentSheet/navigation,
  useSubagentRelay, ToolInspectionPanel/toolInspection, TaskSessionSheet and Badge.

## Known blockers and evidence limits

Supplied captures cover empty chat and two navigation configurations, not live
agent/script/queue states. Screenshot inclusion of current source is UNKNOWN;
the visible workspace-base hash is not an app build stamp. Read-only build status
reported installed app waiting/unknown and responsive Host 0.6.92 with unknown
source identity. No current-build visual acceptance is claimed.

Live feature-claim RPC was not exposed in this T3 session. Session/Git state was
inspected; a prior local read-only claim query found no matching reservation.
No cross-machine lock was acquired. Preserve concurrent ButtonGroup/footer,
sidebar, Host and mobile work.

## Handoff references

Design clarification and audit delivered locally, uncommitted on baseline
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Product implementation remains
pending. Do not present this card or the dirty docs as a completed UI migration.

Local register: `temp/local/2026-10-27-workbench-audit/AUDIT.md` (34 findings).
Evidence: `temp/verification/2026-10-27-workbench-audit/`; single source detector
returned `[]`, with no runtime/contrast acceptance. Existing source inventory
indexed 329 production source/style files in sessions/shared/tasks; it is not
329 individually verified components. Build inclusion remains UNKNOWN.

## Focused main/project menu and Servers audit

Owner scope on 2026-10-27: audit these two areas first with native subagents;
do not implement product UI in this phase. Three read-only reviews inspected
all 14 supplied images and corresponding sources. Register:
`temp/local/2026-10-27-menu-servers-audit/AUDIT.md`.

The focused register has 11 NAV, 14 SVR and 7 SSH records. Eight NAV entries
confirm/refine prior SH findings; NAV01 adds a recovery-specific badge consumer.
Do not add these 32 records to the earlier 34 as a unique-defect total. The
initial 17-surface table retains its original scope; the extension is below.

| Extension surface                            | Source owners                                                                                                                                    | Audit / repair state                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Main/project rails, Sessions tabs and counts | `src/app/shell/ProjectRail.tsx`, `Sidebar.tsx`, `LastSessionsSection.tsx`; shared Badge/Button owners                                            | Supplied images + source inspected; runtime repair pending.                                                              |
| Recovery and status detail                   | `src/app/shell/SessionRecoveryControl.tsx`, `SessionRecoveryPanel.tsx`, `session-recovery.css`; `src/features/sessions/ui/LiveAgentsPreview.tsx` | Count/label variants, state vocabulary, detail/touch route and attention population documented; repair pending.          |
| Servers collection and filters               | `src/features/connections/ui/ServersView.tsx`, `ServersView.css`, `ServerItem.tsx`, `ServerStatus.tsx`                                           | List/grid/filter/Add supplied; empty/failed/bulk/narrow states need rendered acceptance.                                 |
| Server purpose/detail and identity editing   | `ServersConnectionTools.tsx`, `ServerOrganization.tsx`, `SshServerEditor.tsx`, `SshIdentityField.tsx` under connections/ui                       | Detail/Quick connect supplied; other purposes and validation/recovery source-inspected or inventoried.                   |
| SSH settings/import                          | `src/features/connections/ui/SshSettings.tsx`, `TermiusImportDialog.tsx`                                                                         | Keys supplied; Known hosts/import/generate pending/error and import stages need captures.                                |
| SSH terminal tabs and persistence            | `src/features/connections/ui/ServersTerminalWorkspace.tsx`, `ServerTerminalSession.tsx`, `ServerTerminalRestoreControls.tsx`                     | Middle-handler absence, active-close navigation, lifecycle and close-policy differences sourced; no live session closed. |
| Shared terminal lifecycle/help               | `src/features/terminal/ui/TerminalView.tsx`, `TerminalTools.tsx`, `ProjectTerminalDock.tsx`; `src/features/terminal/model/terminalClose.ts`      | Ordinary-terminal close guard and existing middle-click route compared; help exists but has discovery gaps.              |

T3 reference direction: compact markers and contextual session details with
keyboard/focus/touch equivalents. Do not copy fixed yellow colors or call
Recovered sessions Settled: their meanings differ. Preserve approval/error
actionability and the true population named by each count.

Before SSH gestures are extended, resolve deliberate close policy for foreground
or unknown work. Use the same close path for X/middle button, preserve exact
terminal identity, adjacent selection, PTY/restore cleanup and explicit reconnect.
Do not label a tab Connected just because it exists or a plain SSH entry healthy
because its type is SSH. Never use a real connection/key/trust mutation to test.

Reuse menu browser fixtures plus `servers.spec.ts`, `servers-management.spec.ts`,
`servers-workspace.spec.ts`, `ssh-key-binding.spec.ts`, `server-recovery.spec.ts`
under `tests/browser/`, and corresponding Servers/SSH/terminal unit families.
Known hosts, import, forwarding, automation, Files/SFTP and security-review states
retain their own contracts and need actual state captures before acceptance.

Source inclusion remains UNKNOWN: read-only build status found app waiting and
responsive Host 0.6.92 with unknown source identity. No tests, product build,
install, live interaction or product-source change was performed by this audit.

## Social media redesign extension

The owner supplied 14 social screenshots on 2026-10-27 and delegated choosing a
suitable redesign approach. Read `.agents/skills/feature-social-media/SKILL.md`
before social UI work. Its source-backed 36-record audit and task-oriented brief
live under `temp/local/2026-10-27-social-redesign/`. Preserve the distinct content,
approval, scheduling, activation, dispatch and delivery contracts while recomposing
the presentation. No product migration is claimed by these documents.

The one-date Job details example establishes a general rule now in DESIGN.md:
ordinary short facts stay inline; optional diagnostic disclosure must contain
meaningful extra information. Preserve visible failures/uncertainty/recovery.

## Planned capability: inline visual replies

The owner requested T3-style HTML/SVG visual output inside chat on 2026-10-27.
Keep this capability separate from the 34 existing presentation findings and
17 audited surfaces. Additional general and chat screenshots will expand the
visual audit; the initial inventory is not whole-product acceptance.

Existing reusable source: `src/features/files/ui/HtmlPreview.tsx` and
`src-tauri/src/html_preview.rs`. Current chat attachments intentionally display
HTML as source in `src/features/sessions/ui/AttachmentFilePreview.tsx`; the
transcript `Block` in `src/features/sessions/model/session.ts` has no distinct
inline HTML-artifact field. No agent-facing preview/publish pipeline was found
in the inspected Host/harness/session sources.

Target work: typed conversation-owned artifact snapshots, agent preview/publish
operations, authorized local/remote assets, dedicated inline sandboxed rendering,
theme and content-height integration, full-screen viewing, reload/persistence
and local loading/failure/retry. Preserve ordinary attachment behavior and use
shared controls/overlay ownership. Cover desktop, connected-machine and mobile
paths explicitly; Tauri-only file preview does not establish all-client support.

T3 reference: `docs/user/html-renders.md`, `apps/server/src/htmlRender/HtmlRender.ts`
and `apps/web/src/components/chat/HtmlRenderFrame.tsx` in `pingdotgg/t3code`.
Local execution/acceptance checklist:
`temp/local/2026-10-27-workbench-audit/PLAN.md`.
Status: requested/planned, not implemented or runtime-verified.

## Notes redesign extension

Owner added Notes on 2026-10-27 and selected the newer default:
"Tek düzenlenebilir belge varsayılan olsun (önerim)". Preserve Source/Split,
retained choices, explicit Save, drafts, Markdown and project grouping. Feature
inventory and acceptance ownership: `.agents/skills/feature-notes/SKILL.md`.
Two native reviews inspected all three supplied captures; the local register has
18 records (13 visual/source, five source-only), not 18 reproduced runtime bugs:
`temp/local/2026-10-27-notes-redesign/AUDIT.md`. Selected default and proposed
composition: `temp/local/2026-10-27-notes-redesign/REDESIGN.md`.
Product implementation remains pending; adjacent session/mobile surfaces are
inventoried and require separate rendered acceptance.

## Conversation tools redesign extension

Owner added five Conversation tools captures on 2026-10-27. Confirmed choices:
"Genişte görünür sekmeler, darda açılır seçim (önerim)" and
"Proje sunucuları önde, diğer süreçler açılır (önerim)". Retain all listeners,
uncertain associations, only-Logs/dock/window paths and real target/operation gates.
Source inventory: `.agents/skills/feature-conversation-tools/SKILL.md`.
Three native reviews plus parent shell review produced 26 scoped records
(15 visual/source, 11 source-only), not 26 runtime reproductions. Register/brief:
`temp/local/2026-10-27-conversation-tools-redesign/`. Product migration pending;
mobile and live Host/device acceptance remain separate from the concept.

## Terminal readability extension

Owner added terminal light/dark/readability on 2026-10-27. Two native source
reviews and parent checks produced 11 scoped records (two visual/source, nine
source-only), not 11 runtime reproductions. Inventory:
`.agents/skills/feature-terminal/SKILL.md`; register/repair:
`temp/local/2026-10-27-terminal-readability/`.

Repair effective canvas/contrast policy independently of typography across
project/file/dedicated/SSH terminals. Nominal light/dark palette calculations
are not actual glyph acceptance. Preserve shared themes, user font/zoom/spacing,
raw PTY bytes, ANSI/TUI meaning, private/SSH identity and active processes.
No new global font default, always-dark mode or shell-prompt rewrite selected.
Real renderers/themes/custom surfaces and native/mobile checks remain pending.

## Jira Inbox/board redesign extension

Owner added Jira list/board, repeated continuation and card-detail report on
2026-10-27. Selected "Kaydırırken kontrollü yükleme (önerim)" and
"Sağda ayrıntı paneli (önerim)". Wide right/narrow back detail and user-demand
continuation retain no-background-sync/visibility/rank/draft boundaries.
Inventory: `.agents/skills/feature-inbox-jira/SKILL.md`; register/brief:
`temp/local/2026-10-27-jira-redesign/`. Two native reviews plus parent found
15 scoped records (six V+S, eight S, one isolated mechanism/source), not 15 live
reproductions. Source has a detail aside; pointer capture activation, read-depth
continuity and capped List transport need real fixes, not visual-only controls.
Product migration remains pending; isolated input proof is not installed/live Jira.

## GitHub Inbox/review redesign extension

Owner added mixed GitHub issue/PR list and Code screenshot on 2026-10-27.
Two native source reviews plus parent verification produced17 scoped records
(six V+S, eleven S), across16 surface/state families; no runtime reproduction
claim. Inventory: `.agents/skills/feature-inbox-github/SKILL.md`; register/brief:
`temp/local/2026-10-27-github-redesign/`. Visible type/state, honest loaded/filter/
read scopes, deliberate draft/selection ownership and wider Code with grouped
controls/scalable file navigation are proposals. Reuse existing auto diff,
checks/evidence/repair and exact-head/native permission guards. No new GitHub
grouping/default/polling or live operation selected. Shared Inbox/diff consumers
and native/mobile boundaries remain in coverage; product migration pending.

## General Search redesign extension

Owner added general Search on2026-10-27 and selected
"Kısa arama penceresi; sonuç geldikçe genişlesin (önerim)". Preserve dialog-first
context, explicit page/restore and retained query/type/filters; compact opening
grows to a stable bounded result region. Two native reviews plus parent source
checks:10 records (one V+S/nine S),14 coverage families. Inventory:
`.agents/skills/feature-search/SKILL.md`; register/brief:
`temp/local/2026-10-27-search-redesign/`. Scope truth, category boundaries, active
identity/input accessibility, full destination recovery and local/native/index/
lock completeness require real fixes. No new recents/history store, role filter,
source/engine or indexing default delivered. Product migration pending; concept
and source review are not installed/native/Host/mobile acceptance.

## Recovered sessions redesign extension

Owner added recovery dialog on2026-10-27. Two native reviews plus parent checks:
nine scoped records (two V+S/seven S),13 surface/state families. Inventory:
`.agents/skills/feature-session-recovery/SKILL.md`; register/brief:
`temp/local/2026-10-27-session-recovery-redesign/`. Compact readable recovery,
explicit all/matching/selected scopes, full identity/alias search and distinct
chat opening/chat layout/list cleanup are proposals. Preserve history and
running work; no automatic restart or default change selected. Partial opens,
opened-but-save-failed, dismiss/read failures and eligible remote-alias count
need real source repairs. Do not double-count the earlier navigation-count
theme as a unique product total. Product migration/native/Host/mobile acceptance
pending; existing navigation-only fixture does not prove actual recovery.

## Crew UI/UX audit extension

Owner added six Crew captures on 2026-10-27 and clarified "Her iki alan" for
member identity and action-button icons. Three native read-only reviews plus
parent source/capture checks produced 18 scoped records (five V+S, 13 S), across
20 surface/state families. Inventory: `.agents/skills/feature-crews/SKILL.md`;
register/brief: `temp/local/2026-10-27-crews-redesign/`.

Compact Team/Working settings/Work composition, clear responsibility/candidate
identity, retained nested drafts/picks, fixed eligibility versus auto ranking,
cost-unit/budget truth, saved-team versus frozen-run context and direct attention/
session controls are proposals. Missing member icon slots and reported action
visibility use separate paths. Eight nonempty wrapper SVGs and six shared unit
checks do not establish installed Crew visibility. Real list/get omit full request
data expected by the fixture/UI; a scoped bounded detail contract is necessary
before promising full content. Preserve existing permission/execution/deletion/
delivery gates and current mobile counterparts. Product migration, actual Crew
theme/size/state/Host/native/installed/device acceptance remain pending.

## Settings Policies audit extension

Owner began supplying Settings screens individually on 2026-10-27 and named
Policies/general cleanup and unclear bottom About. Two captures, one native
read-only contract review and parent checks: six scoped records (three V+S,
three S), ten surface/state families. Inventory: `.agents/skills/feature-settings/SKILL.md`;
register/brief: `temp/local/2026-10-27-settings-policies-audit/`.

About currently holds document-language/offline/fallback help, pushed to the
sidebar bottom. Contextual relocation, a clearer reading track and optional
heading orientation are proposals. Keep full bundled legal content, dates,
license, reader scrolling, local language/defaults and exact Settings reveal IDs.
Narrow visual/keyboard mismatch and late mail-error ownership need source repairs.
Three unit tests pass (Markdown mocked); empty static scan is not rendered/native
acceptance. Actual installed/source inclusion UNKNOWN. Existing mobile legal
privacy/terms/help routes differ from desktop. Other Settings pages remain to be
audited; no global About/disclosure removal, policy/consent change or product
implementation/build/install/release is delivered by this extension.

## Settings Skills audit extension

Owner added Skills copy/mode/state report and three captures on 2026-10-27.
Two native read-only reviewers plus parent: eight records (five V+S, three S),
14 families. Card: `.agents/skills/feature-skills/SKILL.md`; register/brief:
`temp/local/2026-10-27-settings-skills-audit/`.
Copy/focus refresh clears broad lists/policies; no explicit browser reload or
copy-induced draft loss established. Scope reads/errors/pending to their target
while preserving loaded data. True Edit/Preview/Split, read-only raw access,
honest load/save state and single policy-off presentation are proposals; no new
default or remote edit grant. Preserve owner inspection/agent restrictions, disk
conflict checks, native replace/delete confirmation, safe copy limits and invocation
metadata. 54 focused mock/source tests pass; product/native/live machine/mobile
acceptance pending. Audit only; no live write, build/install/release.

## Settings MCP audit extension

Owner added two captures and selected infinite scroll on 2026-10-27. Two native
read-only reviews plus parent: 11 scoped records (four V+S, seven S), 16 families.
Card `.agents/skills/feature-mcp/SKILL.md`; register/brief:
`temp/local/2026-10-27-settings-mcp-audit/`.
Current paging is local slicing, so reveal cached matches near active list end
without repeated network/health/auth. Compact connection/topic/grant-history
composition remains proposed. Preserve exact identity, scope/status truth, stale
rows and local-only outgoing versus incoming local-Host context. Correct pending
identity, CLI tone/provenance, expiry and grant capability meaning without adding
permissions. 25 focused tests pass, static scan []; actual UI/native/Host/installed/
device acceptance pending. No config/token/credential/live operation or source
implementation/build/install/release delivered by this audit.

## Settings Limits & Budgets audit extension

Owner added six captures on2026-10-27 and selected both shared summary and common
local budget. Two native read-only reviewers plus parent: ten records (four V+S,
six S),18 families. Card `.agents/skills/feature-usage/SKILL.md`; register/brief:
`temp/local/2026-10-27-settings-limits-budgets-audit/`.
Compact overview/accounts/form/history are proposed; current table caps100 but
does not use shared table's >200 virtual bound. Fix Limits-only filter/All time,
freshness/target/refresh and draft lifetime. Do not add percentages or overlapping
budget usage; existing workspace=group. New common local scope requires real
model/read/storage/dispatch work, no configured ceiling/action/default selected.
Preserve unknown/privacy/pre-dispatch/recovery and separate Host/mobile coverage.
24 focused tests pass, static scan []; no product/live provider/budget/send,
build/install/release or actual native/device acceptance delivered.

## Settings Usage analytics audit extension

Owner added eight captures on2026-10-27; existing functions are broadly useful,
refinement requested. Two native read-only reviews plus parent: ten records
(five V+S, five S),18 families. Overview/Projects/Time analysis register and repair
brief: `temp/local/2026-10-27-settings-usage-analytics-audit/`; maintained inventory
extends `.agents/skills/feature-usage/SKILL.md`. U07/U08 reuse the earlier Limits
audit and selected common summary/local budget; no duplicated unique total.

Refine sparse charts/time layout, dense short tables and metric/context hierarchy.
Repair unknown-share semantics, cost qualifier during comparison, account label
precedence, truncated duration coverage, grouping state and dynamic chart names.
Preserve exact data/source/CSV/privacy and configured account colors; no blind
model alias merging or provider quota pooling.32 focused tests pass, static[];
actual changed product/native/device acceptance pending. Audit/design only; no
product/live provider/budget/send/build/install/release operation delivered.

## Settings Providers audit extension

Owner added three captures on2026-10-27, requesting model enable/use management,
settings hierarchy/layout, icons and CLI update improvements. Three native
read-only reviews plus parent:13 records (three V+S,nine S,one R+S),20 families.
Card `.agents/skills/feature-providers/SKILL.md`; register/repair brief:
`temp/local/2026-10-27-settings-providers-audit/`.

Clarify global/project defaults versus machine-wide account/model policy;
explain last-model fallback without removing one guard alone. Repair unsaved
storage truth, inheritance reset, catalog source/freshness, account refresh/pending
ownership, stale update success, false model-refresh success and binary-modal
late callback risk. Compact fields/model list and prioritize actionable CLI rows.
166 tests/14 files pass; source10-glyph structure check and static[] are not
installed pixel/root-cause proof. Preserve all credentials/model IDs/capabilities,
async recovery, native update verification and concurrent staged/shared UI work.
Audit only; no app, live provider/account/CLI/model write or build/install/release.

## Settings Chat and prompt-library audit extension

Owner added two Settings > Chat captures on2026-10-27 and requested less clutter,
with a template-menu suggestion. Three native read-only reviews plus parent:
12 records (four V+S,eight S),18 families. Card
`.agents/skills/feature-chat-settings/SKILL.md`; register/repair:
`temp/local/2026-10-27-settings-chat-audit/`.

Propose compact topic order and locally collapsed optional help, template menu
opening a searchable collection/selected editor, independent effective defaults.
Preserve all settings, explicit Save, draft/conflict/read recovery, template/SSH
identity/review, search deep links, Voice locality and recovery/send gates.
Repair continuation sync/save truth, template read/validation/draft lifetime,
voice job/Locate ownership and inherited text-action capability.315 tests pass,
static[]; no changed product/manager/native/installed/audio acceptance. Prior
Voice routing fix and concurrent staged work retained. Audit only, no source or
actual preference/template/voice/SSH/provider/build/install/release operation.

## Settings Crews collections audit extension

Owner added three wide/light Settings Crew/library/profile captures on2026-10-27,
requesting less vertical growth and nearer actions. Two native read-only reviews
plus parent:10 new Settings records (three V+S,seven S),13 families. Extend existing
`.agents/skills/feature-crews/SKILL.md`; register/repair:
`temp/local/2026-10-27-settings-crews-audit/`.
Prior18-record Crew work/editor audit remains linked, not recounted/fixed here.

Propose compact collection views, bounded action/reading tracks and focused profile
editing, preserving all controls/search/copies/permissions. Repair refresh/context/
rail persistence state, profile dirty close/model validation/conflict and delete
concurrency semantics.19 existing model tests pass, static[]; actual changed
product/native/Host/installed/mobile acceptance pending. No source, real profile,
preference/run/Host or build/install/release/index operation delivered.

## Settings Archive audit extension

One wide/light owner Archive capture added2026-10-27, questioning the single-
preference accordion and long-page scaling. Two read-only reviewers plus parent:
11 records (two V+S,nine S),15 families. Card
`.agents/skills/feature-archive/SKILL.md`; register/repair:
`temp/local/2026-10-27-settings-archive-audit/`.
Compact scoped collections/search/bounded scroll and truthful sidebar mode proposed.
Preserve default-closed disclosure truth, actual archive-only semantics and all
restore/delete/privacy/dirty/busy/owner/folder guards. Fix data/filter/storage/
sibling state, false Deleted, unarchive pending and relocked project confirmation.
93 tests pass, static[]; no app/source/preference/record/Host/native operation or
actual changed UI/build/install/release acceptance delivered.

## Settings Inbox connection audit extension

Five owner captures added2026-10-27 for GitHub/GitLab/ADO/Jira/Linear Settings.
Card `.agents/skills/feature-inbox-settings/SKILL.md`; register and repair brief
under `temp/local/2026-10-27-settings-inbox-audit/`. Eleven records (three V+S/
eight S),14 families, two native read-only reviews plus root. Propose bounded
provider/form layout, nearby status/actions and separate saved/verified/draft/
discovery state. Preserve drafts, keyboard/search, native credential validation,
scope rules and desktop-owned Host/mobile authority. Fix saved/draft identity,
Jira roster epochs/retain/pending, shared error labels and persistence/sibling
truth.60 tests/seven suites pass, static[]; no product/live/credential/scope or
build/install/release operation. Actual changed-app/native acceptance pending.

## Settings Source Control audit extension, 2026-10-27

Five owner captures, explicit audit request;13 findings (three V+S/ten S),
17 connected Settings families, two native read-only reviews plus root. Card
`.agents/skills/feature-source-control/SKILL.md`; register/repair brief under
`temp/local/2026-10-27-settings-source-control-audit/`. Propose scoped compact
workspace collection/policy/Git preferences, bounded lists and nearby actions.
Preserve useful grouped advanced controls, full identity and separate managed/
ordinary lifecycle authority. Repair draft/freshness/validation/inheritance/
storage truth, publication unknowns, discovery/error states, remote ordinary
mutation routing and preference persistence.81 existing tests/nine suites pass,
static[]; no app/Git/index/worktree/policy/Host/build/install/release changes.
Actual changed UI/native/installed/mobile acceptance remains pending.

## Terminal Settings refinement, 2026-10-27

Two owner captures: retain the relatively coherent local/remote grouping and
refine its density/state.12 records (two V+S/ten S),14 families, two native
read-only reviews plus root. Card feature-terminal; register/repair brief under
`temp/local/2026-10-27-settings-terminal-audit/`. One local/local-sync authority,
compact remote refresh/recovery, contextual help and correct search targets.
Fix mirror/discovery/file-read/cache freshness, inventory empty truth, uncertain
save/read-back and fixture shared-file parity. Preserve native/Host/mobile
ownership/validation/compare guards and active PTYs/commands.7 existing tests/
two suites pass, static[]; no product/profile/live/build/install/release change.
Prior terminal output-readability audit remains separate; actual new UI/native/
installed/mobile acceptance pending.

## Workspace Settings layout audit, 2026-10-27

One owner capture,8 findings (one V+S/seven S),14 families, two native read-only
reviews plus root. Card `.agents/skills/feature-workspace-settings/SKILL.md`;
register/brief under `temp/local/2026-10-27-settings-workspace-audit/`. Bounded
deliberate file/editor and tool-visibility groups, ordered narrow layout and
separate local-Host experiment scope proposed. Preserve current controls absent
from image, platform conditions, active hidden work/drafts and exact Host gates.
Repair weaker Notes/File tabs/Format/Explorer subscriptions and scoped preference
save recovery; clarify Autosave/Notes/Working agents consequences.35 existing
tests/six suites pass, static[]; no product/preference/file/Host/live/build/
install/release changes. Actual new UI/native/mobile/installed checks pending.

## Privacy and security Settings audit, 2026-10-27

Two owner captures,12 records (two V+S/ten S),16 families, three native read-only
reviews plus root. Card feature-privacy-security; register/brief under
`temp/local/2026-10-27-settings-privacy-audit/`. Propose deliberate bounded
privacy/file and password/locking layout with nearby state/actions; clarify
protection configuration/current lock/visible count. Normal list already bounded;
authorized hidden collection needs bounded search/target-aware recovery while
retaining concealed names/count and explicit Settings restore. Fix unavailable
read/persistence/partial outcomes, busy-dialog truth, cooldown localization and
native file-status read-back/consent semantics. Preserve native/path/password/
race/authority gates; UI privacy is no disk-encryption promise.68 tests/11 suites
pass, static[]; no product/secret/group/file/consent/live/build/install/release
change. Actual new UI/native/mobile/installed acceptance pending.

## Keybindings and shared focus/filter audit, 2026-10-27

Four owner captures;14 records (three V+S/eleven S),18 surface/state families.
Card feature-keybindings; register/brief under
`temp/local/2026-10-27-settings-keybindings-audit/`. Root plus three read-only
native reviews cover capture/runtime, shared focus and representative filters.
Propose a bounded command/chord track, one composite focus owner, distinct
recording/pending/error, visible popup labels and explicit reset/query scope.
Keep keyboard focus; stacked decoration is not proof of multiple outlines or a
measured contrast failure. Quick composer durability/external sync is macOS-only
feature coverage; ordinary native partial outcomes/localization need repair.
Shared filter plan reviews10 desktop families plus native draft/Apply, not every
filter. Active state already exists; unify grammar, truthful count scope and View
separation without changing transaction/reset ownership. Preserve concurrent
ButtonGroup work.99 existing tests/six suites pass; source/mock/fixture inventory
and schematic are not actual new UI/native/installed acceptance. Audit only;
no product, shortcut, preference, OS, build/install/release change.

## Notifications Settings and request-sheet audit, 2026-10-27

Four owner captures;18 records (three V+S/fifteen S),22 surface/state families.
Card feature-notifications; register/brief under
`temp/local/2026-10-27-settings-notifications-audit/`. Root plus three read-only
native reviews. Propose bounded General/Projects composition, nearby identifying
context/mute/detail, compact schedule/help and clear permission/dependency truth.
Sheet/history already bounded/capped100 request arrivals; improve title/meta,
stable inspection/source-open, empty/clear/options and local approval outcomes.
Preserve private/hidden redaction, unresolved authority, mute/category/draft/
selection/expiry and popup timing. Repair durable/unavailable reads/writes,
permission freshness, taskbar retry and summary durability/relock visibility.
Cached summary gap is source risk, not demonstrated owner-data exposure.161
existing tests/20 suites pass with retained act warnings; no product or live
preference/OS/approval/Host/build/install/release changes. Actual new UI/native/
device/installed acceptance pending; schematic only.

## Appearance management audit, 2026-10-27

Three owner lower-page crops; full six-topic source scope.20 records (three V+S/
seventeen S),24 families; card feature-appearance and register/brief under
`temp/local/2026-10-27-settings-appearance-audit/`. Root plus three native read-only
reviews. Propose bounded topic/control/preview tracks with compact in-page
navigation, direct translucency and visible capability/reason, explicit reset
scope and real Empty/Conversation/project background treatment. Preserve native
CSS fallback, light opaque policy/dark values, custom/font/zoom/state guards,
image/live independence, worker/canvas performance and ambient versus executable
crew distinction. Repair durable/read/partial outcomes, macOS-only blur truth,
decode/worker recovery, project-only blur access and tab-animation synchronization.
153 existing tests/16 suites pass with Probe act warnings; native/GPU/installed
acceptance remains pending. No app/theme/image/preference/crew/OS/Host/index/
branch/build/install/release change; schematic only.

## General Settings audit, 2026-10-27

One owner capture;20 records (three V+S/seventeen S),22 families. Card
feature-general-settings; register/brief under
`temp/local/2026-10-27-settings-general-audit/`. Root plus three native read-only
reviews. Propose bounded balanced preference tracks, coherent lifecycle/power,
compact support/diagnostics and version/update/reference hierarchy. Preserve
valid language choices/drafts/native domains, window power ownership/close gates,
opt-in local trace, support entrypoints and legitimate source receipts. Repair
durable/effective/unknown/native outcomes, technical-language scope, local feedback,
shared updater progress and running/installed/restart truth. Preserve feed/install
authorization; no extra approval or update action in this audit.296 existing
tests/17 suites pass with Diagnostics act-environment warnings. Screenshot0.6.92
and source0.6.94 do not prove installed inclusion. No app/live setting/OS/trace/
clipboard/import/link/update/Host/index/branch/build/install/release change;
actual new UI/native/device/installed acceptance remains pending.

## Markdown preview and scroll ownership audit, 2026-10-27

One owner crop with two apparent bars; card feature-markdown-preview. Register/
brief under `temp/local/2026-10-27-markdown-scroll-audit/`:12 records (two V+S/
ten S),18 families, three native read-only reviews plus root. Retained hidden
Source's overview ruler can explicitly restore visibility/pointer interaction,
painting a viewport band and moving hidden scrollTop beside active Preview.
Source case confirmed; exact screenshot inclusion/reproduction unknown. Contain
inactive paint/hit testing, preserve editor lifetime/drafts/undo/selection and
clarify one real thumb versus diff ticks. Coordinate semantic scrollbar roles,
native overlays/high contrast/gestures, Skills sizing and localized Find focus.
Keep valid code/table inner scrolling, Notes Split owners and session textarea.
111 existing tests/15 suites pass; no actual CSS containment/native/installed
acceptance or product/content/preference/index/build/install/release change.

## Diff toolbar compact-icon extension, 2026-10-27

Owner requests icon presentation and audit addition for the remote.rs Working
Tree capture. Register/brief `temp/local/2026-10-27-diff-toolbar-audit/AUDIT.md`:
six records, two direct owners/eight routed families. Source2rem diff rows contain
a default Select with2.25rem minimum; no actual text-wrap mechanism established.
Propose compact shared Button icon trigger and checked DropdownMenu, nearby
navigation/count/expand actions and deliberate header hierarchy. Preserve tab
drag/close, three saved choices/automatic900px/actual layout constraints and
draft/caret/undo/focus. Include shared read-only Git/Inbox consumers and local/
sibling durable state. No product patch or actual UI/native/installed acceptance.

## Command details output audit, 2026-10-27

Owner conversation0567326f-aade-4baa-89f3-b44c6256ae9e, verbatim:

> command details da birşey gözükmüyor bunlarada bakabiliriz.

This upgrades the earlier CommandDetails source-only inventory with one owner PNG
and a dedicated data-flow audit. Card feature-command-details; register/brief
`temp/local/2026-10-27-command-details-audit/`:12 records (two V+S/ten S),16
families; root plus two native read-only reviews. The screenshot's gh watch step
redirects stdout/stderr, so Running silence is plausible and does not prove loss.
No screenshot command was executed. Details reads provider blocks, not an independent PTY.

Separate source cases: raw Codex deltas use replacement detail semantics; core
detail cap lacks completeness flag; exact inspection/output precedence differs
from full inspector; remote full-block loading is not wired to sheet; Claude
watcher hides persistent/final read failures. Reconcile availability/lifecycle/
provenance, pinned-bottom reading and operation-local Copy/navigation outcomes.
Do not globally append snapshot detail, infer shell suppression/process liveness,
invent command timing, poll arbitrary paths or auto-rerun. Preserve safe task-tail
guards, capability/call-ID Stop, current live block lookup and nonmodal focus.
Existing copy-timing record is extended here, not declared newly fixed.

339 existing tests/10 suites pass; provider children/output reads are mocked.
Actual provider/Host/native/remote hydration/Stop/clipboard/reader and changed
UI1280/800 light/dark/narrow/mobile/installed acceptance remain unverified. Source
snapshots include concurrent provider/Host work. No product/live/index/branch/
build/install/release change; richer command metadata remains a contract proposal.

## Selection menus and accent-role extension, 2026-10-27

Owner's two selection-menu crops and suspected accent failure are recorded in
`temp/local/2026-10-27-selection-accent-audit/AUDIT.md`:10 records (two V+S/eight
S),14 families, root plus two native read-only reviews. Appearance and composer
cards own dependencies. Normal Composer Send/steer uses neutral primary despite
Appearance's accent promise; Quick composer opts into accent. Picker state and
same/sibling application are connected, so blue DOM selection/gray action hover
is not proof of persistence failure. Keep explicit role ownership across text
selection, hover/focus/on/status and native/editor/terminal layers.

Propose compact one-surface selection actions with all capabilities retained,
range-identity async ownership, action-specific local errors and reachable short
viewport content without self-scroll dismissal. Six direct menu callers and11
SurfaceSelection routed files include UnifiedDiffView. Preserve Notes/context,
quote preparation, guarded draft translation/apply, keyboard/range/native focus,
reduced motion and existing overlay roles. No global recolor, new default or live
AI/send/note operation is adopted. Audit only; actual computed UI/native/contrast/
installed acceptance pending, no product/build/install/release change.

135 existing tests/13 suites pass with retained fixture native-invoke/remote/
skill-policy and act diagnostics. No computed theme/selection proof is inferred.

## Git sidebar/panel audit extension, 2026-10-27

`temp/local/2026-10-27-git-panel-audit/AUDIT.md` extends the whole-product plan
with12 records (five V+S/seven S),18 families and a compact static direction.
Source-control card owns the full preservation/acceptance inventory. This actual
Git panel scope is separate from Settings Source Control and diff-toolbar work.

Reduce repeated header/action slabs; keep repository/checkout review scope,
branch and workspace/execution authority distinct. Match or label shell totals,
expose discovery recovery and explicit error Details, clarify sync destination/
incoming commits, and emphasize distinguishing paths. Retain existing SplitButton
independent states, all menus/filter/tree/multi-selection, drafts/cancellation,
conflict/recovery and guarded Git authority. Working4 is workspace agent activity,
not a Git count. Source races in generation/header commit and diagnostic feedback
are recorded for focused regression before layout migration.

Root plus two read-only native reviews; shared Sidebar/Button/Host work preserved.
Source main@d8bf868f/package0.6.94; screenshot inclusion unknown. Audit/source/mock
checks and schematic do not establish changed app/native/live/installed proof.
No product/Git/preference/build/install/release mutation or commit in this phase.
186 existing tests/15 suites pass with retained act-environment warnings;
new deferred-race coverage and actual application acceptance remain pending.

## Explorer root/header audit extension, 2026-10-27

Owner's full dark Explorer image and root-row crop are recorded in
`temp/local/2026-10-27-explorer-audit/AUDIT.md`: nine records (three V+S/six S),
16 families, root plus two native read-only reviews. New feature-explorer card
owns complete tree/action/routing inventory and preservation/acceptance boundaries.

Propose one compact root/tools header below the retained workspace tabs. The root
is already outside inner scrolling and owns collapse/select/context/drop/keyboard;
do not relocate it across rootRef or merge with Workspace selection mechanically.
Root can show worktree branch, not just project name. Shared tab centering rule
matches owner image despite text-left; repair owning alignment without changing
workspace tabs globally. Preserve cache/read guards, native menus, chunked large
folders and all file operations. Clarify excluded mode/retained hidden selection,
empty content, pending controls, clipboard result and saved-but-refresh-failed
recovery. Existing Sidebar gitRoot key limits reused-instance completion risk.

Source main@d8bf868f/package0.6.94; screenshot inclusion unknown. No product/file/
clipboard/Host/preferences/Git/build/install/release mutation. Existing checks
and static direction are bounded in the evidence ledger; actual app/native/live
acceptance remains pending. Coordinate concurrent Sidebar/shared/Host work.
159 existing tests/12 suites pass; two ChatFolderBrowser act-warning groups are
retained. No actual native/reader or live filesystem acceptance is inferred.

## Shared implementation closure tracker, 2026-10-27

Owner asks for one common TODO and a reliable way to know audits have closed.
Exact quote, thread0567326f-aade-4baa-89f3-b44c6256ae9e,2026-10-27/28 continuation:

> auditlerin kapandığını nasıl anlıycaz? Ortak bir todomu yapsan

Canonical view: `temp/local/2026-10-27-workbench-audit/TODO.md`, generated by
audit-tracker.mjs from AUDIT-REGISTER.json. AUDIT-CLOSURE.md defines acceptance;
HANDOFF-TEMPLATE.json and all six SESSION-* launch briefs use that protocol.

Inventory:36 current audit reports /520 source records, plus six foundation
milestones, five inline-visual capability steps, three acceptance tasks and20
shared-component family deliveries. The prior35/506 checkpoint is retained in
the tracker evidence history; the14 added CMP source/design records are not all
new unique defects.
Record count is not unique defect count. Screenshot inventory rows are excluded;
NAV/SH family relationships remain explicit. Guardrail/scope/coverage/capability
records retain their original meaning. Baseline audit tests/static schematics do
not initialize implementation closure. Initial OPEN means no accepted closure
evidence recorded here, not proof every candidate is still a defect.

One coordinator writes the canonical ledger. Workers report exact IDs, assigned
worktree/source identity, changed files, checks after change, actual UI/interaction
evidence, target inclusion, dependencies and blockers from their own checkout.
No shared-milestone auto-closure. CLOSED needs applicable scope/source/behavior/
visual/interaction/target/native-review acceptance; N/A needs reviewed rationale.
Installed and released flags stay separate. Missing native proof cannot become
PASS, but does not stop unrelated source packets. The ledger is not a live claim.

Tracker verification is under temp/verification/2026-10-27-ui-audit-tracker.
Synthetic validator checks never close canonical records. No application source,
installation, release or live operation is delivered by this tracker addition.

Six-session revision,2026-10-28, same owner thread, exact quote:

> 6 ya bölelim 6 session aynı anda ilerleteyim

Keep Sessions1–4 numbered as before. Session2 now owns core controls/inputs;
new Session5 owns generic overlays/menus. Session4 owns shell/main-project menus;
new Session6 owns Servers/SSH. Add FND-OVERLAYS and FND-SERVERS without closing
existing consumer records. Shared theme files stay with Session1, settings with
Session3. Preserve existing APIs so six bounded scopes can proceed concurrently.
Existing workers must reconcile the narrowed assignments before a second writer
edits transferred files. Updated plan/briefs do not launch top-level sessions.

## Dedicated shared component redesign,2026-10-28

Owner clarification requires component redesign as well as screen composition.
feature-shared-ui owns the source-backed contract and full public-module inventory:
temp/local/2026-10-28-shared-components-redesign/{AUDIT.md,REDESIGN.md,INVENTORY.md}.
Four source defects, eight design contracts, one API gap and one reference gap
remain distinct from20 family delivery tasks.69 public TSX modules are indexed;
not every leaf/state is reviewed/rendered. Use the existing real ControlSpecimen
and arc-controls fixture; no new library/gallery or second overlay system.
Session1 owns theme,2 core/data/text/reference,5 overlay/feedback/media. Screens
3/4/6 consume those roles/adapters. Shared CMP/UIF/screen acceptance never
auto-closes together. Existing concurrent Button/Badge work is preserved.

## Proposals

The two previous proposals were selected by the owner on 2026-10-27 and are now
design decisions: completed ordinary operations use a compact summary with details
on demand, and activity uses one simple state signal with the existing figure
optional. Their implementation is pending; active work, failure, approval and full
inspection remain visible/reachable. No additional proposal is adopted here.

## VIS 2026-10-29: collapsed rail

Delivered in source (uncommitted; unit and fixture evidence only):

- The collapsed rail shows the product logo, a merged top row, and icon-only entries (name as accessible name and tooltip, e.g. Inbox and Projects and groups).
- Search in the title bar is a ghost icon button without a field fill.
- Logo and merged top-row behaviour are recorded from the shell sub-agent report; not re-inspected beyond the compact-navigation fixture.
