import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useLocale } from "../../../shared/i18n";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { settingsSectionLabel, type SettingsSectionId } from "../model/settings";
import { SettingsGroupsSkeleton } from "./SettingsSkeleton";
import "./SettingsLoadingSurface.css";

/**
 * Suspense fallback while the dialog loads Settings. Its header owns the visible page identity.
 */
export function SettingsLoadingSurface({ section }: { section: SettingsSectionId }) {
  useLocale();
  return (
    <div {...surfaceAttributes({ variant: "canvas" }, "settings-loading")} data-settings-loading>
      <Skeleton label={settingsSectionLabel(section)} placeholder={<SettingsGroupsSkeleton rows={4} />} />
    </div>
  );
}
