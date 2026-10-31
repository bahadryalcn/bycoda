---
name: feature-skills
description: "Skills management inventory for local/project/remote libraries, machine enable policy, invocation metadata, Markdown edit/preview/source, drafts/save/conflicts, creation, copy/import/export/overwrite, deletion, agent search/read and mobile composer access. Read before Skills UI or workflow changes."
---

# Skills

## Remote-policy refresh regression, 2026-11-01

Release-performance CI repair reproduced a stale restriction cache after remote
re-enable. Explicit `loadSkills({ refresh: true })` now requests fresh policy via
`skills.ts` and `skillPreferences.ts`; the revision fence prevents older in-flight
reads from restoring stale cache entries. Remote policy is not written to local
preferences, and failed authority reads remain closed. Catalog/preferences tests
passed 29/29, including re-enable, fresh-disable/offline and late-reader cases.
Evidence: `temp/verification/2026-11-01-host-test-efficiency/skill-catalog-fixed.json`.
Baseline main/cba4505fe; local uncommitted repair under the owner's instruction to
implement CI fixes without committing. This is mocked-transport/source evidence,
not a live remote-Host or installed-build acceptance claim.


Manage skill installation inventory, owner preferences and instruction documents
without losing drafts, machine identity or execution restrictions. Search terms:
Skills, SKILL.md, enabled, disabled, Manual only, Automatic only, invocation,
copy to another machine, import, export, frontmatter, Edit Preview Source Split.
This is distinct from source-code feature cards and from enabling a provider.

## Scope, identity and concurrency

Inventoried 2026-10-27 on dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Recent feature history inspected:
`29d534f9f`, `cf3944cfb`, `3419af022`, `0a6973a21`. Source is not an installed
build stamp. Three owner light captures have UNKNOWN inclusion.

T2 audit/design only: 14 surface/state families, eight records (five V+S, three S),
two native read-only reviews plus parent checks. Local register/design:
`temp/local/2026-10-27-settings-skills-audit/AUDIT.md` and REDESIGN.md. Evidence:
`temp/verification/2026-10-27-settings-skills-audit/EVIDENCE.md`.
Live feature-claim API unavailable; Git/worktree/native session state inspected.
This card is not a lock or cross-machine reservation. Preserve concurrent work,
especially Settings Voice/Policies and shared controls; one writer per file.

## Owner decisions and suggestions

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact owner quote:

> Copy to another machine diyince tamamen yeniliyor sayfayı filan bu tarz sıkıntılar da var. Edit preview source kısmı yerine edit preview split daha iyi olabilri gösterim olarakda düzeltilebilir stateler filan da daha iyi olabilir disabled olunca hem disabeld yazıyor hem swtich disabled durumda filan

Audit scope and a three-mode composition suggestion, not a selected new opening
default, remote editing grant or live copy/replace/install/deletion authorization.

## Surface inventory

Re-enumerate with `rg --files src/features/skills src/platform/tauri host src-tauri/src tests/browser mobile/src`;
search labels, skill_* commands, skills.search/read, bycoda:skills-change and
callers before changes. Source is partial across native/mobile/runtime boundaries,
not proof all flows were exercised.

| Surface                                                                              | Owning files                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings entry, header, search/reveal                                                | `src/features/settings/ui/SettingsView.tsx`; `src/features/settings/model/settings.ts`; feature-settings card                                                                       |
| Local/remote library, grouping, search/counts, row actions, policy, detail, feedback | `src/features/skills/ui/SkillsPage.tsx`; `SkillsPage.module.css`                                                                                                                    |
| Create/add and invocation picker                                                     | `src/features/skills/ui/SkillPicker.tsx`; `SkillPromptField.tsx`                                                                                                                    |
| Metadata-aware preview                                                               | `src/features/skills/ui/SkillDocumentPreview.tsx`; `src/features/sessions/ui/MarkdownDocumentPreview.tsx`; `SurfaceSelection.tsx`                                                   |
| Raw edit/source/shared view mode                                                     | `src/features/notes/ui/NoteMarkdownEditor.tsx`; `src/features/sessions/ui/AgentMarkdown.tsx`; `MarkdownModeToggle.tsx`                                                              |
| Discovery, disabled preferences, cache/catalog                                       | `src/features/skills/model/skills.ts`; `skillPreferences.ts`; `skillCatalog.ts`; `machineSkills.ts`; `cliCommands.ts`                                                               |
| Copy and deletion routing                                                            | `src/features/skills/model/transferSkill.ts`; `deleteSkill.ts`; `src/features/connections/model/remoteCommands.ts`                                                                  |
| IPC contracts                                                                        | `src/platform/tauri/fs.ts`; `src/integrations/harness/core/skillPolicy.ts`                                                                                                          |
| Host storage/transport/policy                                                        | `host/skills.ts`; `host/skill-policy.ts`; `host/workspace-commands.ts`; `host/app-skills.ts`; `host/harness-skills.ts`                                                              |
| Agent tools                                                                          | `host/conversation-tools.ts` provides `skills.search` and `skills.read` schemas; installation inventory is not an install/enablement permission                                     |
| Native commands and dispatch                                                         | `src-tauri/src/skills.rs`; `src-tauri/src/lib.rs`; `src-tauri/src/remote.rs`                                                                                                        |
| Mobile consumer                                                                      | `mobile/src/features/workspace/use-composer-catalog.ts`: workspace.run/list_skills for composer suggestions; no dedicated Skills management route found in current source inventory |

Commands: `list_skills`, `skill_policy_get`, `skill_policy_set`, `skill_export`,
`skill_import`, `skill_delete`, `read_text_file`, `write_text_file`. Remote routing
uses `workspace.run` with exact machine/cwd. Change event `bycoda:skills-change`.
Do not invent a Skills-specific Host capability from these command names.

Translation families in `src/shared/i18n/locales/` and override catalogs include
Skills, Search skills, Edit, Preview, Source, Disabled, Manual only, Automatic
only, Invocation disabled, Copy to another machine, Copy to this computer,
Save or discard the draft before transferring, and operation/error/recovery copy.
Use actual t(...) calls; no assumed skills.* translation namespace.

## Behavior to preserve

- Distinguish installed inventory, owner enabled policy, invocation metadata and
  provider-native versus instruction-only restrictions. Owner machine off policy
  denies same names across provider sources for agent discovery/read/invocation;
  trusted owner management inspection does not enable or invoke a skill.
- Current Edit is raw Markdown and only local/owner-manageable; Preview renders
  the current draft; Source reads full raw text. Remote/managed sources retain
  raw access. YAML/frontmatter, body, support files and source identity survive.
- Name click opens local Edit; eye opens Preview. Keep both entry behaviors and
  their focus return. Missing opener falls back to filter; late reads are rejected.
- Save has duplicate guard, captures content, re-reads disk before write, rejects
  changed disk text and retains drafts on conflict/failure. It clears only the
  exact saved draft. This is a pre-write comparison, not atomic revision/CAS.
- In-section selection/preview preserve edits, creation stays mounted, query is
  retained. Draft state is component-local: leave/re-enter retention is an audit
  gap, distinct from broad collection refresh; no copy-induced loss established.
- Transfer blocks dirty drafts, uses exact source/machine identity and targets
  personal `.agents/skills/<name>`. SKILL_EXISTS requires native Replace consent
  before overwrite. Built-in/plugin namespaces remain protected.
- Full-directory copy validates listed source/path/duplicates and enforces
  200 files, 2 MiB/file and 8 MiB total, staging/rollback. Existing Host copy does
  not retain executable modes; copied is not installed/runnable acceptance.
- Delete uses native confirmation, path/source protections and duplicate guard;
  supporting files, disabled preference cleanup and catalog refresh remain owned
  by existing Host/native paths. No live deletion is needed for UI testing.

## Audit findings and proposed repairs

Shared reload after transfer/focus clears local/remote lists and refetches all
policies. No explicit browser document reload was found. Keep existing data during
target-scoped revalidation and preserve focus/scroll/selection/draft. Global
policy read errors currently leak into local detail action feedback; scope them
to their machine and distinguish confirmed copy from subsequent discovery failure.

Footer Saved is rendered even for loading/read failure. Use honest document state.
Off switch plus Disabled badge duplicates policy state, while disabled control
during saving, read-only source and invocation metadata have different meanings.
Compact title-first rows and detail action/reading tracks are design proposals.

Owner's Edit/Preview/Split suggestion needs actual paired raw/rendered panes with
one draft owner and read-only raw access, not a Source rename. Current shared
Markdown helper supports keyed preview/source only; give Split a deliberate owner
and check shared consumers if changing it. No new opening default selected.

## Checks and acceptance

Fresh audit baseline: SkillsPage.test.ts + transferSkill.test.ts +
SkillDocumentPreview.test.ts, 54 tests / three files pass; static Impeccable scan
of main UI/CSS/preview returns []. Mock commands and SSR/source checks do not prove
native confirmation, real copy, policy enforcement, filesystem rollback or device.

Existing coverage to inspect according to change: `src/features/skills/ui/SkillsPage.test.ts`,
`SkillPicker.test.ts`, `SkillPromptField.test.ts`, `SkillDocumentPreview.test.ts`;
`src/features/skills/model/transferSkill.test.ts`, `skills.test.ts`,
`skillPreferences.test.ts`, `skillCatalog.test.ts`, `cliCommands.test.ts`;
`host/skills.test.ts`, `host/skill-policy.test.ts`; Rust skill tests;
`tests/browser/settings-skills.e2e.ts` with existing Settings config/fixture.
No Host/Rust/browser/mobile suite run in this audit. Use meaningful focused
checks and isolated fake machines/data for implementation.

Real UI acceptance: every affected family at 1280/800 light/dark, narrow390,
long names/paths/translations, scale/zoom/reduced motion and keyboard/screen reader.
Cover copy/replace/focus/late reads, one/many offline/outdated machines, policy
unknown/error, dirty transfer guard, Save/read failure/conflict, draft leave/recover,
true Split/read-only/frontmatter, local action feedback and source-mode access.
Relative support assets need correct document/cwd context; don't assume current
text-only preview resolves them. Mobile composer policy/access is separate from
a future management UI and requires its own native/device acceptance.

## Evidence limits and handoff

Audit/card ready for review; product migration not started. Installed source
inclusion UNKNOWN. Native dialogs/opener, live machines, unknown copy outcome,
physical mobile and released behavior not exercised. No build/install/release.
No dedicated mobile management source found does not mean no mobile skill access.
No new source commit: card prepared against baseline above, left uncommitted with
the owner's concurrent work. User guide update belongs to implemented behavior.

## Markdown scrollbar dependency, 2026-10-27

Register/brief `temp/local/2026-10-27-markdown-scroll-audit/`, card
feature-markdown-preview. Skills parent document owns overflow-y:auto while
SkillDocumentPreview wraps a self-scrolling MarkdownPreview through an unstyled
SurfaceSelection. Percentage sizing makes this ambiguous; actual duplicate
overflow is not demonstrated. Choose one explicit document scroll contract for
Preview/Source/Edit, preserving frontmatter, selection, drafts/save and valid
code/table inner overflow. This is separate from retained FileEditor Source's
confirmed ruler visibility/pointer escape.111 related existing tests/15 suites
pass; audit only, actual Skills geometry/new UI/native acceptance pending.

## H3 Settings Skills implementation, 2026-10-28 (uncommitted)

SkillsPage retains visible collections during refresh and targets transfer
revalidation to its destination. Focus refresh is coalesced; cancelled pending
reads restart without clearing current rows. Discovery and policy errors remain
beside their machine with targeted Retry; a confirmed copy is not replaced by an
unrelated policy read failure. Transfer has a synchronous guard and rechecks
the dirty-draft restriction. Unconfirmed copy outcomes request a target read.

Unsaved draft text and its original comparison baseline use the existing
window-lifetime retained-state owner, so leaving Settings does not silently drop
edits or bypass disk-conflict comparison after returning. Split is a real paired
editor/read-only source and rendered draft with independent panes and narrow
stacking. Edit, original Preview/Source access and entry defaults are retained.
Preview forwards document/cwd identity for support assets. Document footer state
distinguishes loading/read failure/saving/dirty/known saved; read Retry preserves
drafts. Off policy is expressed once when its switch is present; invocation
restrictions and owner/provider gates remain distinct. Titles wrap visibly.

Test edilmedi under the nightly owner rule. SK-01..08 scope, remaining
consistency/native dependencies and morning acceptance are recorded in
`temp/local/2026-10-28-settings-pages-b/tooling.json`. No skill was enabled,
installed, copied, edited or deleted as a live operation by this implementation
session; no tests/server/captures, build/install or release ran.
