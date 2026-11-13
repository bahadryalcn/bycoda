import { useSyncExternalStore } from "react";
import { useLocale } from "../../../src/shared/i18n";
import {
  getHighlightsSnapshot,
  pendingHighlights,
  subscribeHighlights,
  type FeatureHighlight,
} from "../../../src/features/onboarding/model/featureHighlights";

/** Synthetic pending registry only for the maintained marker fixture; shipping registry stays unchanged. */
export function usePendingHighlights(): FeatureHighlight[] {
  useLocale();
  const snapshot = useSyncExternalStore(subscribeHighlights, getHighlightsSnapshot, () => "");
  if (!new URLSearchParams(location.search).has("highlight")) return pendingHighlights();
  return snapshot.includes("fixture-highlight")
    ? []
    : [
        {
          id: "fixture-highlight",
          sinceVersion: "0.0.1",
          target: "project-navigation",
          title: "Fixture highlight",
          body: "Synthetic feature highlight",
        },
      ];
}
