import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { settingsSectionLabel, type SettingsSectionId } from "../model/settings";
import { SettingsRowsSkeleton } from "./SettingsSkeleton";
import "./SettingsLoadingSurface.css";

/**
 * Suspense fallback while the Settings chunk loads inside the dialog: one centred card with the
 * known section title, the loading status and a skeleton of settings rows. A slow load explains
 * itself inside the same card; the dialog owns the close action and Escape. Shapes only, no values.
 */
export function SettingsLoadingSurface({ section }: { section: SettingsSectionId }) {
  useLocale();
  return (
    <div {...surfaceAttributes({ variant: "canvas" }, "settings-loading")} data-settings-loading>
      <SurfaceLoading
        heading={settingsSectionLabel(section)}
        title={t("Loading Settings…")}
        slowDescription={t("{p0} is taking longer to load. You can return to the workspace.", {
          p0: t("Settings"),
        })}
      >
        <SettingsRowsSkeleton rows={4} />
      </SurfaceLoading>
    </div>
  );
}
