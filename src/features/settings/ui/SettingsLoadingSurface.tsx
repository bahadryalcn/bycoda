import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useLocale } from "../../../shared/i18n";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { settingsSectionLabel, type SettingsSectionId } from "../model/settings";
import { SettingsShellSkeleton } from "./SettingsSkeleton";
import "./SettingsLoadingSurface.css";

/**
 * Suspense fallback while the dialog loads Settings: a shapes-only copy of the Settings workbench
 * (category rail, title row, framed topic rows) so the loaded view replaces it in place. The one
 * busy status names the destination section; the dialog header owns the page identity, the close
 * action and Escape. The shared Skeleton keeps it invisible for the loading delay.
 */
export function SettingsLoadingSurface({ section }: { section: SettingsSectionId }) {
  useLocale();
  return (
    <div {...surfaceAttributes({ variant: "canvas" }, "settings-loading")} data-settings-loading>
      <Skeleton label={settingsSectionLabel(section)} placeholder={<SettingsShellSkeleton />} />
    </div>
  );
}
