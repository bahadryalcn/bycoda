import { useSyncExternalStore } from "react";
import { useLocale } from "../../../shared/i18n";
import {
  getHighlightsSnapshot,
  pendingHighlights,
  subscribeHighlights,
  type FeatureHighlight,
} from "./featureHighlights";

/** Highlights added since the user last looked; empty on a fresh install and after they are seen. */
export function usePendingHighlights(): FeatureHighlight[] {
  useLocale();
  useSyncExternalStore(subscribeHighlights, getHighlightsSnapshot, () => "");
  return pendingHighlights();
}
