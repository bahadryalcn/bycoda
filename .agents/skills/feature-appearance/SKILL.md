---
name: feature-appearance
description: Appearance Settings inventory for theme/palette/accent, scale/contrast/fonts/code/terminal, collapsed rail and session view, native translucency/blur, global/project image effects, live scenes, motion/ambient crew, reset scope, persistence and preview truth.
---

# Appearance Settings

## H3 implementation, 2026-10-28 (uncommitted)

Appearance now consumes the shared Settings topic/row presentation without page-local
Group/Row skins. Six open topics have compact local navigation; search targets remain.
Translucency dependencies stay visible and the native blur-radius control is macOS-only,
with its saved value retained elsewhere. Background previews use the runtime chat-pane
image/effect/blur/scope treatment for Empty and Conversation, include original-image
loading/failure, and retain Change/Remove. Global image blur remains reachable without a
global image, including when only project images exist. Preview scope is labelled.
Existing theme/code samples are joined by real shared accent action/selection and bubble
samples and a terminal font/size/weight/spacing sample. These are representative previews,
not installed-font, native glass, terminal-grid or GPU acceptance.

`appearancePersistence.ts` reports per-setting failed durable writes and retries while
retaining an explicitly applied window fallback. Sibling writes supersede stale retries.
Fonts/density keep write-before-apply: unavailable reads retain last-known state, each
replacement requires a fresh read and merges only edited fields, and failed drafts remain
editable across read recovery/sibling refresh. Appearance topics show local retry feedback.
Live-scene/intensity and zoom writes use the same receipts. Excluded-file visibility
performs durable readback and same/sibling synchronization; tab animation consumes the
shared settings subscription. Existing defaults, palettes, scopes, reset subsets and
permission gates remain.

Source delivery: `temp/local/2026-10-28-settings-pages-a/appearance.json`, including every
APP-01..20, SEL-09 and WS-06 boundary. **test edilmedi** under the owner-directed overnight
RULES.md exception. No tests, browser/server, screenshots, compiler, build, install,
native operation or release ran in this worker. Morning acceptance must cover failure/
retry/read/sibling races, light/dark1280/800/narrow, keyboard/density/reduced motion,
project precedence and actual native/font/terminal behavior. Native image replacement,
worker crash settlement, shared session-list durability and installed-source inclusion
remain explicit open items. No feature claim/lock is established by this card.

## Purpose, scope and coordination

Make appearance choices understandable and manageable while preserving effective
and saved preferences. Keywords: Appearance, theme, palette, accent, typography,
scale/zoom, density, contrast, diff colors, terminal font, rail, translucency,
native glass/blur, image/background, live scene, motion, ambient crew, reset.

2026-10-27 main d8bf868fae841b8b391ce148487cd7d373ea9762. T2 audit/design only:
20 records (three V+S/seventeen S),24 state families. Three owner crops cover
lower topics; upper theme/reading/fonts additionally reviewed from source.
Root writes documents; three native read-only reviewers inspect theme/native,
backgrounds and layout/behavior. Claims API unavailable; available session/worktree
context consulted. Card is not a reservation. Preserve concurrent Sidebar/
ProjectRail/Button/native/mobile work; snapshot-only files are marked in evidence.
Current mobile Settings sheet sizing is separate concurrent work, not a delivered
or device-accepted change from this audit.

Search roots: src/features/settings, src/features/projects, src/features/sessions,
src/features/workspace, src/app/workspace, src/shared/ui, src/styles, src-tauri,
tests/browser, mobile/src. Search copy/IDs include AppearanceSection, Theme and
colors, sidebar-opacity, blur, main-pane-glass, main-pane-opacity, chat-background,
LiveBackground, decorativeMotion, collapsedProjectRail, crew theme, reset/defaults.

## Surface inventory

- Six open topics and image/live controls:
  `src/features/settings/ui/AppearanceSettings.tsx`, `AppearanceSettings.css`;
  `AppearancePreviews.tsx`, `AppearancePreviews.css` for theme/reading/fonts;
  `AppearanceBehaviorSettings.tsx`, `SessionListSettings.tsx` for motion/ambient
  crew/session display. SettingsView and model/settings own route/reveal/search.
- Preference/DOM owner `src/features/settings/ui/useAppearanceSettings.tsx`;
  models `appearance.ts`, `appearancePreferences.ts`, `uiScale.ts`,
  `decorativeMotion.ts`, `liveBackground.ts`, `newThreadBackgroundEffects.ts`,
  `newThreadBackgroundEffects.worker.ts` under src/features/settings/model/.
- Shared Button/Slider/Select/SearchableSelect/TextField/ColorPickerPopover/
  Popover and existing overlay own controls. Custom accent external sync and
  validation already work. Semantic preview/theme roles remain under src/styles/;
  do not create local color recipes or a second preview theme.
- Native `set_window_glass_enabled`: `src-tauri/src/window.rs:438`, lib.rs896;
  `set_window_background_blur`: `src-tauri/src/lib.rs:268`, registered882.
  Radius work in this route is macOS-only. Light opaque policy is intentional;
  Linux lacks Window glass switch. No new Host RPC/tool is delivered here.
- Native image save/remove commands in `src-tauri/src/chat_background.rs`,
  registered `src-tauri/src/lib.rs:931`: save_chat_background,
  remove_chat_background, save_project_chat_background, remove_project_chat_background.
  Project owners `src/features/projects/model/chatBackground.ts`,
  `projectChatBackground.ts`, `src/features/projects/ui/ProjectBackgroundDialog.tsx`,
  `src/features/projects/ui/useProjectBackgroundEffect.ts`; SessionPane consumes
  global/project precedence and live layers. Preserve existing native gates.
- Live picker/renderers: `src/features/settings/ui/LiveBackgroundPicker.tsx`,
  `LiveBackgroundCanvas.tsx`, `LiveBackgroundCanvas.css`, `GradientBlurBackground.tsx`.
  Thirteen choices incl None, six image effects, scope/opacity/blur and intensity.
- Scene artwork refresh 2026-10-30 (owner, this session: "Live backgrounddaki arka
  planlar çok iyi gözükmüyor ... profesyonel daha iyi görünümler istiyorum"): all twelve
  scenes redrawn in `src/features/settings/ui/live-background/` (reactBitsSurface,
  neuralTree, thoughtWeaver, dotGrid, codeRain, latentFace, asciiMask, asciiMaskArt).
  Colors stay content/accent tokens; low-contrast accents fall back to content. Idle
  stays still for 2D scenes (settles ~2 s after a reply); WebGL scenes idle at 12 fps.
  Uncommitted; captures `temp/verification/2026-10-29-live-bg/final/`.
  ASCII mask follow-up (owner, same session: "yapay zeka gibi futuristik birşey olmalı yüz
  hatlarını yada omuzu istemiyorum film gibi düşün"): the scene is now an AI core, an
  accent-lit lens with a bezel, orbit rings with hex readouts and a HUD scale. It sleeps dim
  at rest and pulses with the reply rhythm (former mouth poses). Scene ID, label and
  description are unchanged; the label "ASCII mask" no longer matches the artwork (proposal:
  rename it with a catalog update).
- Layout consumers: `src/features/sessions/model/sessionListDisplay.ts`,
  `src/features/sessions/ui/SessionFiltersMenu.tsx`,
  `src/app/workspace/layout/useWorkspaceChromeFlags.ts`,
  `src/app/shell/Sidebar.tsx`, `ProjectRail.tsx` (concurrent snapshots).
- Tab/ambient consumers: `src/features/workspace/hooks/useTabCloseMotion.ts`,
  `src/features/sessions/ui/CrewScene.tsx`, `CrewBackdrop.tsx`, `EmptySession.tsx`.
  Read feature-crews before changing visual crew; saved executable Crews are
  distinct from this ambient scene.
- Mobile is separately owned: `mobile/src/state/appearance.ts`,
  `mobile/src/state/chat-appearance.ts`, `mobile/src/ui/theme.ts`,
  `mobile/src/features/settings/settings-screen.tsx`, `chat-appearance-settings.tsx`.
  Desktop native glass/font/zoom are not phone controls or shared authority.
  Mobile sources located/reviewed for boundary, not exhaustively audited/device-tested.
- Copy families: theme/system/light/dark/palette/accent/custom colors, scale/
  density/contrast/diff/font/code/terminal, Layout/session display/drag dwell,
  Translucency/window/main-pane/opacity/blur, background Choose/Change/Remove/
  effects/scope/visibility, live scene/None/intensity, Motion/ambient crew and
  reset scopes. Background effect/picker/native errors need localization.
- Fresh checked16 suites: appearance, appearancePreferences, nativeGlass,
  uiScale, liveBackground(+perf), decorativeMotion(+perf,+native),
  newThreadBackgroundEffects, useAppearanceSettings, LiveBackgroundPicker,
  LiveBackgroundCanvas(+perf,+ambient) and sessionListDisplay colocated tests.
  Browser inventory: `tests/browser/settings.e2e.ts`, `settings-layout.e2e.ts`,
  `live-backgrounds.e2e.ts` and matching fixtures/configs. No browser run here.

## Owner decision

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, exact quote:

> appearance ekranı da daha güzel anlaşılır ve yönetilebilir olabilir çok iyi durumda değil burasıda

Requests the next staged audit/design step. No palette/default/reset policy,
automatic OS effect, asset conversion or animation change is selected. Historical
guidance to keep translucency directly discoverable is a preservation reminder;
current controls are already direct, intentionally disabled in light mode.

## Behavior to preserve

System/light/dark; six presets/custom accent; hue/saturation/lightness; zoom/CSS
fallback/generation; density/contrast/diff; four stable interface/code font lists;
sanitized terminal free entry/size/weight/spacing and code theme independence.
Current same/sibling theme/font/scale updates and custom-picker synchronization.

Direct translucency, retained dark-mode values, light opaque policy and native
platform capabilities; intentional tested CSS fallback plus generation/fade
ordering. No claim of native success from CSS class alone. Preserve values when
unsupported and clarify macOS-only blur radius.

Image Choose/Change/Remove/cancel/busy/error,25MiB/extension validation, global/
project precedence and project overrides. Six effects including original-asset
None/Haze, empty/all and separate opacities, shared blur. Worker message errors,
retry/revisions/cache pruning/object-URL cleanup; repair worker-level hangs and
native partial replacement. Live None default/migration/intensity and same/sibling
state; radio keys/prev-next, lazy still thumbnails, canvas idle/visibility/focus/
reduced-motion/GPU/cleanup and activity wake. Perf tests are not GPU acceptance.

Rail preference versus current/detached visibility, shared Sessions View state,
real drag dwell, tab motion preference and OS policy. Ambient crew theme/growth
with stored disabled choice and actual context semantics. Do not change saved
team execution. Reset scopes/exceptions remain deliberate until redesigned;
font write-before-apply protection differs from memory-fallback stores.

## Proposals, checks and handoff

Bounded topic/control/value/preview tracks and compact in-page topic navigation;
keep current open sections/search targets. Visible disabled capability/reason,
honest Empty/Conversation preview and project/global scope, explicit reset scope,
target-local durability/read/retry and native fallback truth. Repair missing/
decode/worker/partial image state, missing tab subscription and unavailable
whole-record preference replacement. No stale custom-accent defect established.

Full20-record/24-family checklist and brief:
`temp/local/2026-10-27-settings-appearance-audit/AUDIT.md`,
`temp/local/2026-10-27-settings-appearance-audit/REDESIGN.md`; main plan AA.
Evidence/logs/hashes and schematic previews:
`temp/verification/2026-10-27-settings-appearance-audit/`.

Fresh153 tests/16 suites pass, with existing Probe act warnings. Actual changed
UI1280/800 light/dark,390/long locale/zoom/keyboard/reader/forced colors/reduced
motion, native Windows/macOS/Linux blur/glass/zoom/images, installed fonts/
terminal, GPU/minimize/context and mobile/device acceptance remain UNVERIFIED:
audit-only, no app patch/native/device run. Implementer/platform owners own those
checks using isolated data, not real user preferences/assets.

Audit/design ready locally, uncommitted. Baseline is source identity, not a
delivered fix. Installed inclusion UNKNOWN. No app/theme/image/crew/OS/Host/index/
branch/build/install/release change. Update guides/commit evidence when behavior
changes; a card does not prove runtime or reserve concurrent work.

## Selection actions and accent consumers extension, 2026-10-27

Owner conversation0567326f-aade-4baa-89f3-b44c6256ae9e, verbatim:

> seçim yapıldığında filan bu şekilde gözüküyor bunlarıda daha iyi yapabiliriz. Apperance daki accent color filan çalıştığını düşünmüyorum bunlarında düzenlenmesi gerekiyor.

T2 audit extension:10 records (two V+S/eight S),14 families; two owner crops,
root plus two native read-only reviews. Register/brief
`temp/local/2026-10-27-selection-accent-audit/`; evidence under the matching
temp/verification path. Root main@d8bf868f, source0.6.94; installed chosen color,
scale and source inclusion unknown. Prior20 records/24 families remain separate.

The earlier validation/sibling-sync statement concerns picker state, not every
consumer. Picker/apply/persistence wiring exists and custom accent intentionally
does not replace palette accent/active globally. However, Appearance promises
composer Send and bubbles while normal Composer primary Send/steer branches omit
tone=accent and default neutral; Quick composer explicitly opts into accent.
Legacy primary-action CSS has no production class consumer. Repair intended
consumer scope without recoloring every primary button. Bubble tint is subtle;
its appearance is not evidence of failed save. Prior apply-before-swallowed-save
failure remains an existing record, not a new repaired state.

General DOM selection has no global custom-accent rule; composer selection,
CodeMirror, PDF, xterm, focus and checked/active roles differ. Neutral menu hover
is transient action feedback, not a selected radio preference. Propose an explicit
shared role matrix and representative live preview while preserving transparent
text layers, native/high contrast and status/diff meanings. No broader default
or system-accent policy is selected here. Current real user colors stay intact.

Shared selection menu also needs compact single-surface geometry, selection A→B
async ownership, action-specific errors and short-height/internal-scroll handling.
Six direct callers and11 SurfaceSelection routed files were inventoried. Preserve
all enabled actions, original-draft guards, Notes scope and no implicit send.
Source/mock/schematic evidence is not actual1280/800 light/dark/native color,
selection, contrast or installed acceptance. No app/color/preference/action/
Host/index/branch/build/install/release change delivered by this extension.

135 existing tests/13 suites pass, with retained native-invoke/remote/skill-policy
and React act diagnostics from fixtures. They do not measure actual color roles,
selection/contrast or installed behavior. Full check limits are in its evidence.

## VIS 2026-10-29: color scheme, accent readability, single preview

Delivered in source (uncommitted; fixture and unit evidence only, no installed-build check):

- Appearance "Theme and colors" is one "Color scheme" group: Mode, six palette tiles, accent row and the new Accent readability row, with a single "Reset colors" action (`AppearancePreviews.tsx`, `AppearanceSettings.tsx`).
- One live preview replaces the earlier duplicated samples. It uses published roles only: selection pair, accent solid/on-solid via the shared primary Button, surface and composer roles.
- Accent readability is `Auto | Strong` (`AccentReadabilityControl.tsx`, stored in the appearance preferences, applied as `data-accent-readability`). WCAG targets are 4.5:1 for Auto and 7:1 for Strong. The solid accent fill is never recoloured; only text, selection and on-solid foreground adapt.
- "Reset colors" also returns accent readability to Auto; its scope text names it. "Restore defaults" already did through `APPEARANCE_DEFAULTS`.
- Checks: `SettingsView.test.ts` indexed-setting render passes with the control mounted. Screenshot evidence is under `temp/verification/vis-integration/` (fixture evidence).
