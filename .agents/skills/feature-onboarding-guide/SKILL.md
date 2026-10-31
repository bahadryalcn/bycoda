---
name: feature-onboarding-guide
description: Onboarding and Guide inventory for Quick setup, the topic Guide hub, per-topic quick tours and "Show me" spotlights, the first-run guided tour with its welcome offer and resume state, and the "What's new" feature highlights (registry, markers, tour) shown after an app update.
---

# Onboarding, Guide and guided tours

## Purpose and keywords

Help a person who has never used the app find the main controls and keep finding new ones
after updates, without changing any setting, permission or project. Keywords: onboarding,
Quick setup, Guide, usage guide, guide hub, quick tour, Show me, spotlight, joyride,
`data-usage-guide`, first-run tour, welcome offer, take the tour, resume tour, what's new,
feature highlights, "New" marker, release notes.

Boundaries: Quick setup content (workspace, appearance, agents, connections, projects) is
V3-024; the Guide hub content and per-topic tours are V3-023; this card adds the first-run tour
and highlights (V3-031) and records how the three share one tour layer.

Baseline: main 406a8546d plus the dirty V3 working tree (2026-10-31). Claims API unavailable;
`temp/local/2026-10-31-ui-refinements-3/CLAIMS.md` consulted. A card is not a reservation.

## Surface inventory

Search roots: `src/features/onboarding`, `src/app/shell` (WhatsNewDialog, MenuBar, Sidebar,
ProjectRail, RailAction, UsageFooter), `src/app/workspace` (`control/useGuideActions.ts`,
`surfaces/useSurfaceOpeners.ts`, `layout/WorkspaceDialogs.tsx`), `src/features/settings/ui/GeneralSettings.tsx`,
`src/features/sessions/ui` (Composer, AccessPicker, EmptySession), `tests/browser/onboarding.*`.

Models (`src/features/onboarding/model`):
- `onboarding.ts` – Quick setup completion (`bycoda.onboarding.v1`).
- `usageGuide.ts` – `OPEN_USAGE_GUIDE_EVENT` / `openUsageGuide()`.
- `guide.ts` – `GuideAction` openers (`runGuideAction`), blockers, seen/done progress, signals.
- `guideActivity.ts`, `guideTopics.ts`, `guideTours.ts` – topics, steps, per-topic tours.
- `usageGuideTargets.ts` – `data-usage-guide` target names and `findUsageGuideTarget`.
- `tourState.ts` – first-run tour record (`bycoda.tour.v1`: `completed | skipped | later | paused` +
  resume step id), `START_TOUR_EVENT` / `startTour(kind)`, `recordTourProgress`, `shouldOfferTour`.
- `tourSteps.ts` – `TourStepDef` and `firstRunTourSteps()` (10 cards: projects, new session,
  composer, model, access, sidebar tabs, changes, terminal, background tools, settings + Guide).
- `featureHighlights.ts` – the "What's new" registry (`featureHighlights()`, ships empty), state
  (`bycoda.highlights.v1`: baseline version + seen ids), `pendingHighlights`,
  `syncHighlightBaseline`, `markHighlightSeen`, `compareVersions`, `highlightTourSteps`.
- `useFeatureHighlights.ts` – `usePendingHighlights()`.

UI (`src/features/onboarding/ui`):
- `OnboardingHost.tsx` – owns what is on screen (Quick setup, Guide hub, topic tour, spotlight,
  guided tour, welcome offer) and the offer rules (waits for no modal overlay, no Quick setup, no
  guide; first check 2.5 s after mount, then every 1.5 s).
- `OnboardingDialog.tsx`, `OnboardingPreferences.tsx`, `OnboardingAgents.tsx`,
  `OnboardingCrewPreview.tsx`, `onboarding.css` – Quick setup.
- `GuideHub.tsx`, `GuideShortcuts.tsx`, `guideHub.css` – hub (+ "Take/Resume tour" and
  "What's new" entries).
- `UsageGuideDialog.tsx` – per-topic quick tours and single-step spotlights.
- `GuidedTour.tsx` – runner of the first-run and "What's new" tours (missing-target handling,
  Try it, Esc/arrow keys, outcome callbacks).
- `tourRunner.ts` – Joyride options/locale shared by every tour, `useTourArrowKeys`,
  `ensureTourTarget` (wait, reveal action, skip).
- `UsageGuideTooltip.tsx` – the card (`TourCard` compact variant for `data.compact` steps),
  `usageGuide.css`.
- `TourOffer.tsx` – welcome offer (shared `TransientNotice`).
- `FeatureHighlightMarkers.tsx`, `featureHighlights.css` – "New" dots.

App wiring: `WorkspaceDialogs.tsx` mounts `OnboardingHost`; `useGuideActions.ts` handles
`GUIDE_ACTION_EVENT`; `useSurfaceOpeners.ts` reveals the workspace on the Guide and tour events;
`MenuBar.tsx` (View → Usage guide, Take the tour); `GeneralSettings.tsx` (Getting started row:
Take/Resume tour, Open setup; Usage guide row); `WhatsNewDialog.tsx` ("Show me").
Targets (`data-usage-guide`): `ProjectRail.tsx` (project-navigation, project-add, group-pin,
rail-inbox/notes/automations/tasks/settings via `RailAction`, rail-tools), `Sidebar.tsx`
(changes, files-tab, sidebar-tabs, new-session), `UsageFooter.tsx` (terminal-toggle),
`Composer.tsx` (composer, model-controls, composer-plus, send-controls, queue, queue-button,
stop-button), `AccessPicker.tsx` (access-mode).
Native menu: `src-tauri/src/menu.rs` has "Usage guide" only; a "Take the tour" item there is
not added (see Known blockers).
Locale: flat English keys in `src/shared/i18n/locales/*.json`; new V3-031 strings are listed in
`temp/local/2026-10-31-ui-refinements-3/strings/v3-031.txt`.
Tests: `OnboardingDialog.test.ts`, `OnboardingHost.test.ts`, `GuideHub.test.ts`,
`UsageGuideDialog.test.ts`, `onboarding.test.ts`, `usageGuideTargets.test.ts`,
`app/shell/WhatsNewDialog.test.ts`, browser `tests/browser/onboarding.spec.ts`.

## Owner decisions

- 2026-10-31, TODO V3-031: “Uygulamaya ilk giriş yapan kullanıcılara yönlendirmeli fokuslu filan
  interactive tour istiyorum kimse anlamıyor çünkü baya özellik oluduğu için bununda vardı kodu
  sanırım ama daha iyi olması gerekiyor kütüphane filan kullanabilrisin.”
- 2026-10-31, TODO V3-031: “Hiç yapmamış kullanıcılarda görsün bu arada. Birde eğer yeni bir özellik
  filanda eklersek versiyon güncellemesi sonrası yenilikleri filanda işaretliyebelim”
- 2026-10-31, TODO V3-023: “guide hiç iyi interaktif ve anlaşılır durmuyor bunu da toparlamamız laızm”
- 2026-10-31, TODO V3-024: “Quick setup daha hiç iyi durmuyor bunlarında düzeltimesi gerekiyor kesinlikle”

## Behavior to preserve

- One tour layer: `react-joyride` 3.2.0 only (no new dependency), the shared card, the shared
  `data-usage-guide` targets; Esc is handled once by `overlay.ts` (Joyride's own Esc is off);
  focus is trapped by Joyride and returned by `useOverlay`.
- The welcome offer is shown once to every user without a tour record, existing users included;
  never over Quick setup, the Guide or any modal overlay; "Later", Skip and Done end it for good;
  Esc keeps the step for resume; re-running a finished tour never downgrades its record.
- Missing controls: wait, then a safe navigation action from `GuideAction` when its own gate
  passes, otherwise skip the step (progress shrinks). A tour step never creates or changes data
  beyond what its explicit Try it button does.
- Highlights: a fresh install (no record) starts from the running version and sees none; only
  entries with `baseline < sinceVersion <= current` and not yet seen are pending; markers never
  change layout and disappear on click/focus or when the tour showed them.
- Persistence keys: `bycoda.onboarding.v1`, `bycoda.guide.seen.v1`, `bycoda.guide.done.v1`,
  `bycoda.guide.activity.v1`, `bycoda.tour.v1`, `bycoda.highlights.v1`.
- Eight-locale `t()` strings, semantic color tokens only, reduced motion, accessible names.

## How to add a feature highlight

Edit `featureHighlights()` in `model/featureHighlights.ts` in the release that ships the
feature: `{ id, sinceVersion, target, title, body, reveal? }`.
`sinceVersion` is that release (not the version being developed on a user's machine today: the
running version counts as seen). `target` is the control's `data-usage-guide` name; add the
attribute to the control and the name to `usageGuideTargets.ts` (global controls go in
`GLOBAL_TARGETS`). Use literal `t()` calls for `title` and `body`, add the strings to the eight
catalogs, and drop old entries after a few releases. `reveal` is optional and must only navigate.

## Checks and visual scenarios

Focused: `pnpm vitest run src/features/onboarding src/app/shell/WhatsNewDialog.test.ts`,
`node scripts/i18n/check-locales.mjs`, `pnpm check:web` (or `:fast`).
Scenarios (UI evidence at 1280 and 800 px, light and dark, keyboard, reduced motion):
fresh profile with Quick setup open (no offer until it closes); existing profile (offer after
~2.5 s, "Later" never returns); tour with a project, without a project (Explorer/Changes/Terminal
cards skipped, progress "n / 7"), with the sidebar hidden (reveal), resize while a card is open,
Esc then "Resume tour", Try it on each card, last card opening the Guide; highlights: add a
temporary registry entry with a lower `baseline` in storage and check dot, click-to-dismiss,
What's new "Show me" and the Guide button.

## Known blockers

- No visual, test or typecheck evidence for V3-031 yet: the V3 round defers every check to the
  main agent (BRIEF-V3.md).
- The native menu (`src-tauri/src/menu.rs`) has no "Take the tour" item; macOS and the native
  Windows menu reach the tour through the Guide hub, Settings and the welcome offer only.
- `src/shared/i18n/locales` catalogs are shared with other sessions; V3-031 keys were appended
  idempotently by `temp/local/2026-10-31-ui-refinements-3/scratch-v3-031/add-locales.cjs`.

## Committed handoff references

None yet (uncommitted working tree). Refresh with the commit once the V3 round is delivered.

## Proposals (agent ideas, not decisions)

- Offer the highlights tour automatically once after an update instead of only dots plus the
  What's new entry.
- Add a native-menu "Take the tour" item and a command-palette entry.
- Mark Guide steps done when their Try it runs inside the first-run tour.
