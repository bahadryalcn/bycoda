# Onboarding source map

All code paths below are repository-root relative. Recheck current imports when
changing a surface; these are navigation points, not delivery evidence.

| Concern                                  | Source start                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Quick setup completion                   | `src/features/onboarding/model/onboarding.ts`                                                                                             |
| Guide actions/progress/topics            | `src/features/onboarding/model/guide.ts`, `guideActivity.ts`, `guideTopics.ts`, `guideTours.ts` in that directory                         |
| Spotlight open event/targets             | `src/features/onboarding/model/usageGuide.ts`, `usageGuideTargets.ts`                                                                     |
| First-run pause/resume/offer eligibility | `src/features/onboarding/model/tourState.ts`, `tourSteps.ts`                                                                              |
| Highlight registry/baseline/seen state   | `src/features/onboarding/model/featureHighlights.ts`, `useFeatureHighlights.ts`                                                           |
| Exclusive visible surface/offer gating   | `src/features/onboarding/ui/OnboardingHost.tsx`                                                                                           |
| Setup forms/hub/topic tour               | `src/features/onboarding/ui/OnboardingDialog.tsx`, `GuideHub.tsx`, `UsageGuideDialog.tsx`                                                 |
| Shared runner/card/offer                 | `src/features/onboarding/ui/GuidedTour.tsx`, `tourRunner.ts`, `UsageGuideTooltip.tsx`, `TourOffer.tsx`                                    |
| Workspace entry/event routing            | `src/app/workspace/layout/WorkspaceDialogs.tsx`, `control/useGuideActions.ts`, `surfaces/useSurfaceOpeners.ts` under `src/app/workspace/` |
| User entry points                        | `src/app/shell/MenuBar.tsx`, `WhatsNewDialog.tsx`, `src/features/settings/ui/GeneralSettings.tsx`                                         |
| Target-owning controls                   | `src/app/shell/ProjectRail.tsx`, `Sidebar.tsx`, `UsageFooter.tsx`, `src/features/sessions/ui/Composer.tsx`, `AccessPicker.tsx`            |
| Native menu                              | `src-tauri/src/menu.rs`; inspect actual entry availability rather than inferring it from the web menu                                     |

Preserve these keys unless a separately specified migration is required:
`bycoda.onboarding.v1`, `bycoda.guide.seen.v1`, `bycoda.guide.done.v1`,
`bycoda.guide.activity.v1`, `bycoda.tour.v1`, `bycoda.highlights.v1`.

Feature-highlight changes need boundary cases for no record, same/new version,
unseen/seen IDs and absent controls. A navigation reveal must use existing gated
GuideAction routing and must not change settings or create project data.
