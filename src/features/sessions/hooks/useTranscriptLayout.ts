import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import {
  loadTranscriptLayout,
  subscribeTranscriptLayout,
  type TranscriptLayout,
} from "../../settings/model/appearance";

/** Subscribes to transcript layout changes triggered by saveTranscriptLayout(). */
export function useTranscriptLayout(): TranscriptLayout {
  const [layout] = useStoredPreferenceState(loadTranscriptLayout, subscribeTranscriptLayout);
  return layout;
}
