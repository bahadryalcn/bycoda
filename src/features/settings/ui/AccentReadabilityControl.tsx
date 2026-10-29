import { t } from "../../../shared/i18n";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import {
  ACCENT_READABILITY_DEFAULT,
  type AccentReadability,
} from "../model/accentContrast";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
  saveAppearancePreferences,
} from "../model/appearancePreferences";
import { Row, Segmented } from "./settingsControls";

function loadAccentReadability() {
  return loadAppearancePreferences().accentReadability;
}

/** The appearance record also notifies sibling windows, so one subscription covers both. */
function subscribeAccentReadability(onChange: () => void) {
  window.addEventListener(APPEARANCE_PREFERENCES_EVENT, onChange);
  return () => window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, onChange);
}

/**
 * Accent readability: how strongly text on the accent colour must stand out.
 * Auto keeps at least 4.5:1 and strong at least 7:1; the saved accent itself is
 * never changed. The value lives in the shared appearance preferences, next to
 * the general Contrast slider, and Restore defaults resets it with the accent.
 */
export function AccentReadabilityControl() {
  const [value, setValue] = useStoredPreferenceState(
    loadAccentReadability,
    subscribeAccentReadability,
  );
  const onChange = (next: AccentReadability) => {
    setValue(next);
    try {
      saveAppearancePreferences({ ...loadAppearancePreferences(), accentReadability: next });
    } catch {
      // The shared save-failure registry owns the retry notice; the DOM keeps the last saved level.
    }
  };
  return (
    <Row
      id="accent-readability"
      label={t("Accent readability")}
      description={t(
        "Text and selection on the accent color keep at least this contrast. Strong aims for higher separation.",
      )}
    >
      <Segmented<AccentReadability>
        label={t("Accent readability")}
        value={value ?? ACCENT_READABILITY_DEFAULT}
        options={[
          { value: "auto", label: t("Auto") },
          { value: "strong", label: t("Strong") },
        ]}
        onChange={onChange}
      />
    </Row>
  );
}
