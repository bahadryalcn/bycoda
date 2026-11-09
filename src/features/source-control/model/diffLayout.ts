import { subscribePreferenceChanges } from "../../../shared/lib/storedSetting";
import {
  DIFF_LAYOUT_CHANGE_EVENT,
  loadDiffLayout,
  saveDiffLayout,
  type DiffLayout,
} from "../../settings/public/settings";

const DIFF_LAYOUT_KEY = "bycoda.diffLayout";

export const loadDiffLayoutPreference = loadDiffLayout;

/** Keep the Settings writer and existing key/event contract authoritative. */
export function saveDiffLayoutPreference(value: DiffLayout): boolean {
  saveDiffLayout(value);
  try {
    // The legacy writer has no outcome. A default/fallback read alone cannot
    // prove that a failed write of Automatic was persisted successfully.
    return localStorage.getItem(DIFF_LAYOUT_KEY) === value;
  } catch {
    return false;
  }
}

export function subscribeDiffLayoutPreference(onChange: () => void) {
  return subscribePreferenceChanges([DIFF_LAYOUT_KEY], DIFF_LAYOUT_CHANGE_EVENT, onChange);
}
