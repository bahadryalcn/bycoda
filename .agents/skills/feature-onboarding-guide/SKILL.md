---
name: feature-onboarding-guide
description: "Change Quick setup, the Guide hub, guided tours and release highlights; add discoverable feature targets while preserving resumable progress and safe navigation."
---

# Onboarding, Guide and highlights

## When and scope

Use for onboarding, Guide, Show me spotlights, welcome/resume tours and What is new markers. Tours teach existing controls; they do not grant permission or configure a project implicitly.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/onboarding/ui/OnboardingHost.tsx`: ownership of setup, Guide, offer, spotlight and tour surfaces.
- `src/features/onboarding/model/`: guide actions/targets, tour state/steps and feature-highlight registry.
- `src/features/onboarding/ui/GuidedTour.tsx`, `tourRunner.ts`, `UsageGuideDialog.tsx`: shared tour runner and card behavior.
- `src/app/workspace/control/useGuideActions.ts`, `src/app/shell/WhatsNewDialog.tsx`, `src/features/settings/ui/GeneralSettings.tsx`: entry points.

## Preserve

- Use the existing Joyride/shared tour layer and overlay routing. Keep single Escape ownership and correct focus return.
- Offer the tour to users without a tour record, including existing users, only when setup/Guide/modal overlays permit. Keep Later/Skip/Done, pause/resume and completed-record semantics.
- Missing targets wait, optionally reveal via a permitted navigation action, then skip safely. A step must not create/change data except through its explicit Try it action.
- Fresh highlight state starts at the running version. Pending means baseline < sinceVersion <= current and unseen; markers do not change layout.
- Preserve onboarding/guide/tour/highlight storage keys, translations, accessible targets and reduced motion.

## Workflow

1. Trace the entry event through OnboardingHost, target discovery and the shared runner; check hidden/no-project targets.
2. For a highlight, edit `src/features/onboarding/model/featureHighlights.ts`: add `{ id, sinceVersion, target, title, body, reveal? }` for its shipping release.
3. Add the control data-usage-guide attribute and name in `usageGuideTargets.ts` (global controls in GLOBAL_TARGETS). Use literal t() calls and update all supported catalogs; reveal may only navigate.
4. Exercise fresh/existing/completed profiles, missing targets, Escape/resume and release-version boundaries; remove old highlight registry entries after a few releases.

## Focused checks

Run `pnpm exec vitest run src/features/onboarding src/app/shell/WhatsNewDialog.test.ts`; use `node scripts/i18n/check-locales.mjs` for string changes and the applicable normal TypeScript check for code changes.
Use `tests/browser/onboarding.spec.ts` for real targets, focus and missing-project paths. Check offer suppression, Later, pause/resume, repeated completed tours, highlight baseline/seen state and reduced motion.

## Read when needed

- [Onboarding guide](../../../docs/guides/onboarding.md) for user-facing entry points and behavior.
- [Surface map](references/surfaces.md) when changing tour state, targets or app entry points.
