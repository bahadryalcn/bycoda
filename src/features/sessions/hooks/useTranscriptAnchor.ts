import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import {
  loadTranscriptAnchor,
  subscribeTranscriptAnchor,
} from "../../settings/model/appearance";

/** Subscribes to prompt-to-top changes triggered by saveTranscriptAnchor(). */
export function useTranscriptAnchor(): boolean {
  const [anchor] = useStoredPreferenceState(loadTranscriptAnchor, subscribeTranscriptAnchor);
  return anchor;
}
