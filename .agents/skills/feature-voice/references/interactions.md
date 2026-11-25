# Voice interaction contracts

## Presentation and owner window

Style, compact mode and movement do not reconnect voice. Preserve overlay/focus,
keyboard placement, pointer identity, latest clamped release/cancel position, expanded
actions and reduced-motion/state readability. Floating `voice-overlay-<owner>` mirrors
owner audio/tools through snapshots and whitelisted commands, never workspace quit/tray/
reap/state. Owner close/reload closes it; overlay/native close docks and shows owner
without disconnecting. Floating stays in Voice options. Scoped subscriptions expose
failures and clean up under StrictMode.

The presented drawer view (`workspace.live_work.present`) is one typed snapshot per call:
a tree of catalog components (`model/voicePresentedCatalog.ts`, one spec per component, the
single source for validation, `workspace.live_work.catalog` discovery and the OpenUI library
in `ui/companion/presented/`). The tree is Zod-validated, compiled to an OpenUI program of
literals, `$field` variables and node references, and drawn with shared components; model
HTML or OpenUI source never reaches it, and earlier `blocks`/`content` calls map onto the
same components. Fields keep drafts while their ids survive an update; a Button's
`action.input` (and its target fields) may read fields with `{"$bind":"id"}`, resolved at
press into the descriptor `voicePresentedActions` re-validates against the live catalog with
current authority. Observed components (TestResult, WorkResults and the like) draw only what
the turn measured. Bound values keep their own type: period pickers hold `{start, end}` text
(local days, or local date-times with an exclusive end), lists and suggestion fields name rows
`rows`/`suggestions` so no option is chosen for the owner. `model/voicePresentedCoverage.ts`
places every shared catalog component as drawn by a presented component or omitted for one
reason (overlay, approval, authority, state, chrome), and a test keeps it equal to
`docs/reference/ui-components.md`. Links are plain https with no login and show their host;
JSON data is bounded and refuses credential keys. Add a component by adding its spec, view and
example together; the parity tests fail otherwise. Copy uses the shared CopyButton/clipboard, and the tool reports
completed only when that version is painted in the drawer. A new present replaces the view;
follow-up turns keep it, and call end clears it.

Compact/full/floating controls retain Stop work, speaker mute, microphone and Finish,
with mode selection in options. Disconnect, speaker mute, silence and Stop work differ.
Speaker mute cancels/prevents output-only briefings without replay. Opt-in Push to Talk
needs live connection/paused mic: hold captures, release submits then pauses; Escape/blur
cancel. Runtime end preserves pending transcripts.

## Persona, memory and rules

Persona is quoted style after core rules in every route, never authority/target/format.
Host setup replaces skip; identity/budget and provider/playback/microphone verification
keep separate gates. Retain persona backups. Memory/rules come from current owner speech
or Settings, never session/draft/tool content. Exact accepted corrections brand rules and
retain immutable pending intent through lost acknowledgements. Intercept accepted corrections
before model replies. Facts never downgrade rules;
model quotes cannot promote facts/rules. Forget needs exact owner intent/card/fresh version,
acknowledged only after store success. Disabled memory rejects all saves. Partial migration
retains backup/context; Host memory is canonical, Settings management routes to Room.

## History and privacy

Capture local/global or remote history bindings at onset. Remote lookup verifies captured
machine/environment/project, Assistant capability and exact thread without local Room cache
or project creation. Original closure, session proof and idempotency survive lookup/navigation/
retry; unavailable history stays pending. Remote focused-session tools never receive local
thread IDs. Reconnect seeds summary/text only, never tools. Thread grants are typed subjects,
never fabricated sessions; desktop/working-copy operations retain real focus.

Disclosure intersects frozen canonical contributors with live visible/unlocked projects.
Missing metadata is unknown; explicit empty contributors means global. Global summaries
provide no contributor proof and cannot seed reconnect. Recheck before/after async reads
and credentials. Scope loss discards context and closes capture in Ready, preserving pending
saves/review drafts. Fresh owner speech remains usable without historical context.

## Choices, jobs and tools

Review creates nothing before explicit Start. Freeze accepted payloads; retain partial/unknown
results. Choices grant neither approval nor external sends. Job/note actions require explicit
intent and captured/current scope intersection; deletion requires exact owner confirmation.
Clear Stop needs no extra dialog; no model stop-all. Tool observers retain owner-card waits,
uncertainty and late results; Stop waiting does not promise effect cancellation.

Session and Assistant-thread subjects remain distinct through authenticated relay. Desktop
operations retain per-app owner approval, snapshots, exact-operation approval, receipts, lock and physical-
input gates. Thread approval grants no generic native UI/working-copy access; no owner-settings/
Stop tools. [Voice management](../../feature-voice-management/SKILL.md) owns global application
tools; bridge cannot invent management sessions.

## Dictation and microphone permissions

Dictation uses composer draft/selection owner, preserving IME, attachments and cancellation;
no implicit send. Live previews replace only their own unedited range of the same run and never
reorder or overwrite final text. Cloud dictation (OpenAI/xAI/OpenRouter) goes through local-only
Host `voice.cloud.transcribe`; credentials stay on the Host and errors report status only. Companion/dictation default off independently. Legacy missing dictation
inherits prior companion choice. Recognition-only setup works with companion off, preserving
reply voice and Python/model paths; `natural:false` skips Host TTS dependencies. Switches
never capture; passive query may remain unknown. Explicit checks immediately close tracks,
including grants after cancel/unmount. Shared recovery distinguishes denial, missing/busy
device and secure-context errors across dictation/local/cloud. Settings, composer, setup and
companion share settings-launch feedback. Only allowlisted native macOS/Windows microphone
panes open; opening is no grant. Linux/browser recovery stays manual. Usage descriptions and
audio-input entitlement remain authoritative. Startup buffering preserves spoken order and
lease cancellation; warm recognizer is not active capture. Setup or changed runtime
settings unload the warm recognizer before proceeding.

## Setup preferences

Retain CPU/GPU/automatic and cloud/system/natural choices, omitted-default/runtime-key
compatibility, CPU fallback versus explicit GPU failure and truthful recovery. Current
settings own engine/model revisions and provider voices; performance grants no install/
replace authority. Professional preset preserves unrelated settings and manual-turn revisions.
Shared Assistant setup owns navigation/completion. Simulated platforms prove neither OS
prompts, capture, physical-device behavior nor installed inclusion.
