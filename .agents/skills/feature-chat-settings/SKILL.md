---
name: feature-chat-settings
description: "Settings Chat inventory for conversation appearance, spelling, send/queue help, continuation and model-summary preferences, voice setup/recovery, translation/reprompt defaults, prompt-template menu/manager/explicit-save drafts and composer/SSH/Host/mobile boundaries. Read before Chat Settings redesign."
---

# Chat Settings and prompt library

## H3 Settings reference implementation, 2026-10-28

Owner conversation `55e5cc00-32d1-420a-ac03-bdb7f2a2af2d`, exact quote:

> Ayarlar referans düzenini kalan sayfalara uygula.

Uncommitted Settings-pages-B implementation: Chat uses ordered shared topics;
conversation/writing precede translation and Voice. Optional sending/advanced
help defaults closed locally and reveal still expands targets. The last legacy
equal-topic subgrid and Chat-specific Group/Row skins have been removed.
Continuation flags now subscribe to same/sibling changes with explicit write
outcomes; local failed choices retain Retry. Conversation pacing/spelling/model
options get local save recovery; Appearance receipts remain authoritative.

Prompt templates open from a compact disclosure into a searchable bounded list
and one selected editor. Name/body/trigger validation, IDs, limits, explicit Save,
draft-only deletion and external conflict checks are retained. Window-local drafts
survive closing/navigation. Unreadable/corrupt storage blocks writes and exposes
read retry; validation selects/focuses the offending editor. Translation/reprompt
distinguishes inherited value from reset and explains unsupported text actions.

H1 Voice files and H6 prompt/translation runtime authority are untouched; related
durable/read/runtime findings remain per-ID dependencies. Crews integration is
an owned Settings wrapper only; H2 owns its actual consumers.
Source identity, test edilmedi, single compiler result and morning scenarios:
`temp/local/2026-10-28-settings-pages-b/handoff.json`. No runtime, native,
installed, build or release acceptance is claimed.

Make everyday chat preferences readable and prompt management discoverable without
losing fields, drafts, execution boundaries or recovery. Keywords: Settings Chat,
conversation view, width, wrap, transcript layout, anchor, streaming, spelling,
resume at reset, auto continue, Extras summary, Voice companion, translation,
reprompt, Prompt templates, snippets, trigger, cursor, library, template menu.

## Scope, identity and concurrency

2026-10-27 T2 audit/design; Settings > Chat and dependent behavior, not a new
whole-transcript/composer redesign. Dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`.
History inspected: `cf3944cfb`, `3419af022`, `395e2b491`, `3f4a417c6`;
preference reviewer also checked `22afc558f`, `2732c2792`, `1a5d6a327`.
Two owner light screenshots opened, installed source inclusion UNKNOWN. Three
native read-only reviews plus parent;12 records (four V+S,eight S),18 families.
No product implementation. Live claim API unavailable; Git/worktree/session
context inspected. Card is not a lock. Preserve concurrent staged/unstaged source,
composer tips, shared UI, native/Voice, CI and other work; one writer per file.

Register/repair: `temp/local/2026-10-27-settings-chat-audit/AUDIT.md` and
REDESIGN.md. Evidence: `temp/verification/2026-10-27-settings-chat-audit/EVIDENCE.md`.
Settings/composer/workbench cards and main plan Q link here.

## Owner decisions

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact:

> Chat ekranıda böyle burası da daha güzel dizayn edilebilirdi hiç okumak istemiyorum buraları o kadar karışık o kadar gerkesiz yazı vs varki anlamıyorum. Prompts templates neden burda mesela bunuda menü yapabilirdik belki. Daha güzel bir menü Burayıda yeniden topalıyalım

Owner requests simplification and suggests template-menu placement. Particular
topic/tab order, overlay size, Save/Discard handling and default-open choices are
agent proposals; no actual setting, template/model/account, voice installation,
continuation default or execution permission was changed/selected here.

## Surface inventory

18-family ledger in AUDIT.md; search roots settings, sessions, voice, connections,
app recovery/control, shared UI, Host/native, mobile and browser fixtures.

| Area                          | Entry/state source                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings entry/search         | `src/features/settings/ui/SettingsView.tsx`, `SettingsSearch.tsx`, `settingsControls.tsx`; `src/features/settings/model/settings.ts`                                                                                                      |
| Chat layout/groups            | `src/features/settings/ui/ChatSettings.tsx`, `ChatSettings.css`, `BycodaSettings.css`; basic/advanced/help and templates placement                                                                                                        |
| Conversation display          | `src/features/settings/ui/ConversationDisplaySettings.tsx`, `useAppearanceSettings.ts`; `src/features/settings/model/appearance.ts`, `appearancePreferences.ts`                                                                           |
| Composer/recovery preferences | `src/features/settings/model/composerSpelling.ts`, `settings.ts`; `src/shared/lib/storedSetting.ts`; subscribed preferences and plain local toggle state                                                                                  |
| Recovery consumers            | `src/features/sessions/model/usageLimit.ts`, `turnRecovery.ts`; `src/app/model/appLifecycle.ts`; `src/app/workspace/derived/useWorkspaceUsage.ts`; `src/features/connections/model/remoteRecovery.ts`, `useRemoteRecovery.ts`             |
| Prompt editor/storage         | `src/features/settings/ui/TemplatesSettings.tsx`; `src/features/sessions/model/promptTemplates.ts`                                                                                                                                        |
| Prompt insertion/shared SSH   | `src/features/sessions/ui/Composer.tsx`; `src/features/connections/model/sshSnippets.ts`; template IDs/body/review fingerprint and no implicit send                                                                                       |
| Translation/reprompt          | `src/features/settings/ui/TranslationSettings.tsx`; `src/features/sessions/model/translationPreferences.ts`, `translation.ts`; `src/features/sessions/ui/TranslationResultDialog.tsx`                                                     |
| Voice panel/state             | `src/features/voice/ui/VoiceSettings.tsx`, `VoiceSettings.module.css`; `src/features/voice/model/localVoiceClient.ts`; voice settings and setup job/config identity                                                                       |
| Desktop preference controller | `src/features/sessions/model/desktopPreferencesControl.ts`; `src/app/workspace/control/useAppControlRequests.ts`; `src-tauri/src/control.rs`                                                                                              |
| Native/Host voice and RPC     | `src-tauri/src/remote.rs`; `host/server.ts`, `host/voice-setup.ts`; local-only setup/inspection, job state and active-voice gates                                                                                                         |
| Mobile                        | `mobile/src/features/management/templates/template-library.tsx`, `template-store.ts`, `template-model.ts`; `mobile/src/features/workspace/desktop-preferences.tsx`, `desktop-preferences-model.ts`; `mobile/src/state/chat-appearance.ts` |

Setting IDs to preserve through search/reveal: chat-width, code-word-wrap,
streaming-text-mode, transcript-layout, anchor-prompts, composer-spelling,
follow-up, resume-at-reset, auto-continue-interrupted, model-controls,
translation-model-default, reprompt-model-default, voice-companion,
prompt-templates. Verify exact current IDs when changing controls.

Desktop controller actions preferences.read/templateRead/patch/status implement
reviewed body read with expected revision and canonical templateCreate/Update/Delete
validation/save/verify. Host RPCs preferences.desktop.read,
preferences.desktop.template.read, preferences.desktop.patch/status require
preferences.desktop.v1; native generic-control allowlist and app dispatcher stay
involved. Metadata does not authorize unrestricted body reads. These control
surfaces currently handle templates/provider defaults, not general Chat flags.

Voice uses local target capabilities voice.local.v1 and voice.local.setup.v1;
inspect/setup/setupStatus and other voice.local.* RPCs enforce locality and
active-voice restrictions. Existing remote.rs setup/setupStatus allowlist fix is
prior concurrent source work; preserve it and docs/guides/voice.md. Do not
report it as unfixed or a new repair from this audit.

Locale families: Chat, Conversation view, Composer, Sending while working,
Advanced conversation settings, Continuation and model options, Resume at reset,
Automatically continue interrupted turns, Extras summary, Voice companion,
Translation and reprompt, Use default model, Prompt templates/Add/Save/Discard,
How to use templates, names/triggers/body/errors. Preserve t(), accessible names
and field descriptions; raw model validation errors need localized UI treatment.

## Findings and preservation

Current wide layout mixes30rem topic columns with full-width advanced/templates.
Chat's static send help and advanced group default open via shared AdvancedSettings;
local Chat changes should not alter shared defaults or Appearance visibility.
Most Row descriptions already live in info/screen-reader help. Template usage
help explicitly defaults closed; screenshot's expanded state is not a default bug.
Width, transcript Full/Chat, code-block wrap, anchor and pacing remain distinct.

Templates need a compact menu/entry plus a real searchable collection and selected
editor. Preserve all name/body/optional trigger fields,100/20k limits and stable
IDs. Store bycoda.promptTemplates, event bycoda:prompt-templates-change and storage
subscriptions preserve normalization/clean external updates/dirty conflicts.
Edits and delete persist only through Save; failed save retains draft/retry.
Draft lifetime across navigation/close/Escape is currently at risk; read/corrupt
storage looks empty and validation errors are raw/global. Repair these rather
than silently autosaving or turning menu delete into immediate persistence.

Composer slash and ;trigger+Space insert without send; {{cursor}} positions caret.
Keep normal draft/attachment/IME edit ownership and remove later placeholders.
SSH snippets share bodies; edits invalidate reviewed fingerprint and deletion
affects snippets. Preserve reviewed insertion/no implicit terminal send. Quick
Composer template integration is not established. Mobile phone templates use a
separate local AsyncStorage library, bycoda.mobile.prompt-templates.v1, with dirty/
pending sheet handling and separate Computer templates route; no automatic sync.

Resume/auto-continue toggles use one-time state instead of sibling subscriptions.
Persistence failure behavior is inconsistent: some saves swallow, some set local
state, read-based controls may revert silently, appearance saves throw. Preserve
choice/draft with explicit unsaved/error/retry. Automatic recovery still requires
known reset/idle/grace30s/cancel or eligible interruption/empty queue; remote adds
fresh watched-Host status/identity/readiness/one-shot claims. No broader resend
authority, especially held/unknown delivery, comes from simplifying settings.

Voice enabled is a preference, not runtime ready. Keep Natural/System and STT,
explicit Install/Locate, download context,20s timeout, stale-answer/dedupe and
newer-config guards. Matching background setup errors need restoration on return;
Locate dismissal/disable needs late-result ownership. Setup continues after leave,
no fictitious cancel. Preserve user paths/private runtime and native locality.

Translation/reprompt inherit independently and retain action account/model settings
and calling project/machine context. Make Inherited state distinct from Restore
default action. Inherited general provider may lack text-action support even
though explicit picker options are filtered; show local recovery without silent
provider/model/account substitution.

## Checks and acceptance

315 existing tests/15 files pass once; raw output has React act environment
warnings, not warning-free UI proof. Suites cover TemplatesSettings, promptTemplates,
sshSnippets, desktopPreferencesControl, VoiceSettings/localVoiceClient,
translationPreferences/translation, settingsControls/SettingsSearch/settings.flags,
composerSpelling, turnRecovery/usageLimit/remoteRecovery. Static six-file scan[].
No product/UI source was changed and none of these proves a new manager/layout.

Browser inventory: `tests/browser/settings.html`, `settings.tsx`,
`settings.e2e.ts`, `settings-layout.e2e.ts`, `settings-subviews.e2e.ts`,
`settings-organization.e2e.ts`, `playwright.settings.config.ts`,
`vite.settings.config.ts`; composer queue tests include trigger insertion.
Mobile template store/model/desktop-preferences/chat-appearance tests are separate
checks if their behavior changes. Existing browser suites were read, not run here.

Repair acceptance: all18 families reachable; actual light/dark1280/800 plus
narrow/zoom/long labels, keyboard/reader/reduced motion; manager deep links,
dirty-close/nav/conflict/storage failure and localized fields; slash/cursor/SSH
review gates; sibling continuation sync and save errors; remounted voice failure,
Locate close/disable/reopen, explicit setup and inherited model capability.
Use isolated native/Host/audio/mobile checks when affected. Update user guides
only after behavior exists. Direction diagram is proposal evidence only.

## Handoff and blockers

Audit/card ready for review; repair pending. No product source, template/preference/
SSH/voice/provider mutation, runtime/model download, native app launch, package
build/install/release, index/branch operation or commit. Named unverified checks
and repair owner are in EVIDENCE.md; actual build inclusion remains UNKNOWN.

## Proposals

Compact basic topics, locally collapsed optional help/advanced controls, template
menu leading to full manager, clear inherited/default actions and truthful local
state/recovery. Proposed manager surface/order/close handling is not a new owner
decision or implemented behavior.
