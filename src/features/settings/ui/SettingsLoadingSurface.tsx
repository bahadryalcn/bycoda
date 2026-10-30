import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { settingsSectionLabel, type SettingsSectionId } from "../model/settings";
import "./SettingsLoadingSurface.css";

/** A load this long is worth saying aloud; the dialog's own close action stays available. */
const SLOW_LOAD_MS = 10_000;

/**
 * Suspense fallback while the Settings chunk loads inside the dialog. It keeps the known section
 * title visible and mirrors the loaded frame so the swap does not move anything. The dialog owns
 * the close action and Escape. Indeterminate and fake-data free: shapes only, no values.
 */
export function SettingsLoadingSurface({ section }: { section: SettingsSectionId }) {
  useLocale();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="settings-loading" data-settings-loading>
      <div className="settings-loading-rail" aria-hidden="true">
        <div className="settings-loading-shapes">
          <Skeleton aria-hidden lines={6} />
        </div>
      </div>
      <div className="settings-loading-panel">
        <header className="settings-loading-header">
          <h1 className="settings-loading-title">{settingsSectionLabel(section)}</h1>
        </header>
        <div className="settings-loading-body">
          <div className="settings-loading-shapes">
            <Skeleton label={t("Loading Settings…")} lines={6} />
          </div>
          {slow ? (
            <p role="status" className="settings-loading-note">
              {t("{p0} is taking longer to load. You can return to the workspace.", {
                p0: t("Settings"),
              })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
